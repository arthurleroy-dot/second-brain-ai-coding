import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { DATA_ROOT, RAW_ROOT } from '@/lib/wiki-fs';
import { CLAUDE_MODEL } from '@/lib/claude';

/**
 * Moteur d'ingestion LOCAL — remplace la GitHub Action + `claude -p`.
 * L'agent (`@anthropic-ai/claude-agent-sdk`, moteur embarqué) tourne avec
 * `cwd = DATA_ROOT` et n'écrit QUE sous `wiki/` (garde-fou déterministe `canUseTool`).
 * Les règles du projet (`CLAUDE.md` + `docs/*`) sont INJECTÉES dans le prompt (elles
 * ne sont pas dans le dossier de données — décision D5) : mon code les lit depuis le
 * bundle de référence et les concatène, les docs restant la source unique.
 *
 * ⚠️ NON OPTIMISÉ (coûteux) — l'optimisation « quelques centimes » fait l'objet d'une
 * spec dédiée (cf. encadré Phase 4 de la spec + mémoire projet).
 */

// Racine des assets de référence (prompt + docs injectées). En dev : racine du dépôt
// (un cran au-dessus de /web). Dans l'app packagée : dossier bundle en lecture seule.
const REFERENCE_ROOT = process.env.REFERENCE_DOCS_ROOT ?? path.resolve(process.cwd(), '..');
const PROMPT_PATH = path.join(REFERENCE_ROOT, 'prompts', 'ingest-prompt.md');
const INJECTED_DOCS = [
  'CLAUDE.md',
  path.join('docs', 'ingestion.md'),
  path.join('docs', 'wiki-spec.md'),
  path.join('docs', 'entities.md'),
];

const STATE_DIR = path.join(DATA_ROOT, '.data');
const STATE_PATH = path.join(STATE_DIR, 'ingest-state.json');
const LOCK_PATH = path.join(STATE_DIR, 'ingest.lock');
const LOG_PATH = path.join(STATE_DIR, 'ingest.log');

export interface IngestState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt?: string;
  finishedAt?: string;
  pending?: string[];
  slug?: string;
  error?: string;
  logTail?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- État persistant ----

export async function readIngestState(): Promise<IngestState> {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf-8')) as IngestState;
  } catch {
    return { status: 'idle' };
  }
}

export async function writeIngestState(s: IngestState): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const tmp = path.join(STATE_DIR, `.ingest-state.json.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), 'utf-8');
  await fs.rename(tmp, STATE_PATH);
}

// ---- Verrou (sérialise les ingestions concurrentes) ----

/** Acquiert le verrou de façon atomique (O_EXCL). false si déjà tenu. */
export function acquireLock(): boolean {
  try {
    fsSync.mkdirSync(STATE_DIR, { recursive: true });
    const fd = fsSync.openSync(LOCK_PATH, 'wx'); // wx = O_CREAT|O_EXCL : échoue si existe
    fsSync.writeSync(fd, `${process.pid} ${nowIso()}\n`);
    fsSync.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(): void {
  try {
    fsSync.unlinkSync(LOCK_PATH);
  } catch {
    // déjà retiré : rien
  }
}

export function lockHeld(): boolean {
  return fsSync.existsSync(LOCK_PATH);
}

// ---- Détection des sources en attente ----

/**
 * Fichiers de `raw/` pas encore ingérés : contenu de `raw/` moins README,
 * moins les sidecars `*.meta.md`, moins les clés déjà présentes dans
 * `wiki/_ingested.json`. 100 % TypeScript (remplace `find | comm | jq`).
 */
export async function detectPending(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(RAW_ROOT);
  } catch {
    return [];
  }
  let ingested: Record<string, unknown> = {};
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(DATA_ROOT, 'wiki', '_ingested.json'), 'utf-8'));
    ingested = manifest?.files ?? {};
  } catch {
    ingested = {};
  }
  return entries
    .filter((n) => n !== 'README.md')
    .filter((n) => !n.endsWith('.meta.md'))
    .filter((n) => !(n in ingested))
    .sort();
}

// ---- Filet : wiki:verify (best-effort, non bloquant) ----

async function runWikiVerify(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', path.join('scripts', 'wiki-verify.ts')],
        {
          cwd: process.cwd(), // dossier /web (là où tourne `next start`)
          env: { ...process.env, WIKI_ROOT: path.join(DATA_ROOT, 'wiki'), RAW_ROOT },
        },
      );
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (out += d.toString()));
      child.on('close', () => resolve(out.trim().slice(-1000)));
      child.on('error', (e) => resolve(`wiki:verify non exécuté : ${e.message}`));
    } catch (e: any) {
      resolve(`wiki:verify non exécuté : ${e?.message ?? 'inconnu'}`);
    }
  });
}

// ---- Construction du prompt (règles injectées) ----

async function buildIngestPrompt(pending: string[]): Promise<string> {
  const base = await fs.readFile(PROMPT_PATH, 'utf-8');
  const parts: string[] = [base];
  parts.push('\n\n===== RÈGLES DU PROJET (injectées — réfère-toi à ces copies) =====\n');
  for (const rel of INJECTED_DOCS) {
    try {
      const content = await fs.readFile(path.join(REFERENCE_ROOT, rel), 'utf-8');
      parts.push(`\n\n----- ${rel} -----\n\n${content}`);
    } catch {
      parts.push(`\n\n----- ${rel} (introuvable) -----\n`);
    }
  }
  parts.push('\n\n===== FICHIERS DE raw/ À INGÉRER POUR CE RUN (eux seuls) =====\n');
  for (const f of pending) parts.push(`- ${f}\n`);
  parts.push(`\nUtilise run: "local" dans _ingested.json. Date du jour : ${nowIso().slice(0, 10)}.\n`);
  return parts.join('');
}

// ---- Ingestion ----

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Lance une ingestion : verrou → détection → agent SDK (écriture scopée wiki/) →
 * wiki:verify (filet) → état. No-op si le verrou est déjà tenu (une ingestion tourne).
 */
export async function runIngestion(): Promise<void> {
  if (!acquireLock()) return; // déjà en cours : on ne double pas

  const wikiPrefix = path.join(DATA_ROOT, 'wiki') + path.sep;
  try {
    const pending = await detectPending();
    if (pending.length === 0) {
      await writeIngestState({ status: 'done', finishedAt: nowIso(), pending: [] });
      return;
    }

    await writeIngestState({ status: 'running', startedAt: nowIso(), pending });

    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    const baseUrl = process.env.ANTHROPIC_BASE_URL || undefined;
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-home-'));
    const prompt = await buildIngestPrompt(pending);

    const logChunks: string[] = [];
    const log = (s: string) => {
      logChunks.push(s);
      fsSync.appendFileSync(LOG_PATH, s + '\n');
    };
    // Réinitialise le log du run.
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(LOG_PATH, `# Ingestion ${nowIso()} — ${pending.length} fichier(s)\n`);

    const q = query({
      prompt,
      options: {
        cwd: DATA_ROOT,
        model: CLAUDE_MODEL,
        // Read-only bare-listés (auto-approuvés) ; les outils d'écriture NE SONT PAS
        // listés → ils passent par canUseTool (sinon le callback serait court-circuité).
        allowedTools: ['Read', 'Glob', 'Grep', 'TodoWrite'],
        disallowedTools: ['Bash', 'WebFetch', 'WebSearch', 'Task'],
        permissionMode: 'default',
        settingSources: [], // n'hérite d'aucun réglage utilisateur/projet
        canUseTool: async (toolName, input) => {
          if (WRITE_TOOLS.has(toolName)) {
            const raw = String((input as any).file_path ?? (input as any).notebook_path ?? '');
            const resolved = path.resolve(DATA_ROOT, raw);
            if (resolved.startsWith(wikiPrefix)) {
              return { behavior: 'allow', updatedInput: input };
            }
            return { behavior: 'deny', message: 'Écriture refusée : seuls les fichiers sous wiki/ sont autorisés.' };
          }
          return { behavior: 'deny', message: `Outil ${toolName} non autorisé pour l'ingestion.` };
        },
        env: {
          // Gateway LiteLLM : le SDK Agent s'authentifie en Bearer (ANTHROPIC_AUTH_TOKEN),
          // pas en x-api-key seule (cf. tasks/lessons.md 2026-07-09).
          ANTHROPIC_AUTH_TOKEN: apiKey,
          ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}),
          CLAUDE_CONFIG_DIR: path.join(fakeHome, '.claude-config'),
          HOME: fakeHome,
          PATH: process.env.PATH ?? '/usr/bin:/bin',
        },
      },
    });

    let resultSubtype = '';
    for await (const message of q) {
      if (message.type === 'assistant') {
        for (const block of (message as any).message?.content ?? []) {
          if (block.type === 'text' && block.text.trim()) log(`[texte] ${block.text.trim().slice(0, 300)}`);
          if (block.type === 'tool_use') log(`[outil] ${block.name} ${JSON.stringify(block.input).slice(0, 160)}`);
        }
      } else if (message.type === 'result') {
        resultSubtype = (message as any).subtype ?? '';
        log(`[result] ${resultSubtype} | coût $${(message as any).total_cost_usd ?? '?'}`);
      }
    }

    // Filet déterministe (non bloquant).
    const verifyTail = await runWikiVerify();

    // Slug ingéré (le premier des pending, relu depuis le manifeste).
    let slug: string | undefined;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(DATA_ROOT, 'wiki', '_ingested.json'), 'utf-8'));
      slug = manifest?.files?.[pending[0]]?.slug;
    } catch {
      /* ignore */
    }

    if (resultSubtype === 'success') {
      await writeIngestState({
        status: 'done',
        finishedAt: nowIso(),
        pending,
        slug,
        logTail: verifyTail,
      });
    } else {
      await writeIngestState({
        status: 'error',
        finishedAt: nowIso(),
        pending,
        error: `Ingestion non aboutie (result: ${resultSubtype || 'inconnu'})`,
        logTail: verifyTail,
      });
    }
  } catch (e: any) {
    await writeIngestState({
      status: 'error',
      finishedAt: nowIso(),
      error: e?.message ?? 'erreur inconnue',
      logTail: logTailSafe(),
    });
  } finally {
    releaseLock();
  }
}

function logTailSafe(): string {
  try {
    return fsSync.readFileSync(LOG_PATH, 'utf-8').trim().slice(-1000);
  } catch {
    return '';
  }
}
