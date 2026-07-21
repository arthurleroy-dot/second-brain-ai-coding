import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import matter from 'gray-matter';
import { extractText, getDocumentProxy } from 'unpdf';
import { DATA_ROOT, RAW_ROOT, readRepoFile, applyFileOps, listWikiDir } from '@/lib/wiki-fs';
import { anthropic, CLAUDE_MODEL } from '@/lib/claude';
import { slugify } from '@/lib/wiki-parser';
import { typeLabel } from '@/lib/ui';
import { ResourceType } from '@/types';
import {
  parseResourceMeta,
  splitFrontmatter,
  withFrontmatter,
  setScalar,
  type FileOp,
} from '@/lib/wiki-mutate';
import { projectResource, type ProjectViews, type NewEntityDecl } from '@/lib/wiki-project';

/**
 * Moteur d'ingestion LOCAL — « IA + déterministe » (refonte 2026-07-21).
 *
 * L'IA (UN appel `anthropic.messages.create` par ressource, via la gateway LiteLLM
 * en x-api-key) ne produit QUE la page ressource `wiki/resources/<slug>.md` + un bloc
 * `<detected-new>`. Un moteur déterministe (`wiki-project.ts`) reconstruit ensuite
 * TOUTES les vues dérivées + le graphe + le manifeste. Plus d'agent Claude Code
 * (boucle multi-tours), plus de garde-fou `canUseTool` (l'IA n'écrit plus), plus
 * d'injection des docs entières : le coût passe de ~6,64 $ à quelques dizaines de ¢.
 *
 * PDF : texte extrait EN LOCAL (unpdf, gratuit), on n'envoie que le texte au modèle.
 * Prompt système identique d'une ressource à l'autre dans un run → cache hits.
 */

// Racine des assets de référence (le prompt système statique).
const REFERENCE_ROOT = process.env.REFERENCE_DOCS_ROOT ?? path.resolve(process.cwd(), '..');
const PROMPT_PATH = path.join(REFERENCE_ROOT, 'prompts', 'ingest-prompt.md');

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
  /** Coût total du run (USD) — estimation tarifs Sonnet, ou coût gateway si fourni. */
  costUsd?: number;
  /** Détail par fichier (USD). */
  perFile?: { file: string; costUsd: number }[];
}

function nowIso(): string {
  return new Date().toISOString();
}

// ————————————————————————————————————————————————————————————————
// État persistant (conservé tel quel)

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

// ————————————————————————————————————————————————————————————————
// Verrou (conservé tel quel)

export function acquireLock(): boolean {
  try {
    fsSync.mkdirSync(STATE_DIR, { recursive: true });
    const fd = fsSync.openSync(LOCK_PATH, 'wx');
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
    /* déjà retiré */
  }
}

export function lockHeld(): boolean {
  return fsSync.existsSync(LOCK_PATH);
}

// ————————————————————————————————————————————————————————————————
// Détection des sources en attente (conservé tel quel)

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

// ————————————————————————————————————————————————————————————————
// Filet : wiki:verify (conservé tel quel)

async function runWikiVerify(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const child = spawn(process.execPath, ['--import', 'tsx', path.join('scripts', 'wiki-verify.ts')], {
        cwd: process.cwd(),
        env: { ...process.env, WIKI_ROOT: path.join(DATA_ROOT, 'wiki'), RAW_ROOT },
      });
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

// ————————————————————————————————————————————————————————————————
// Registres connus (snapshot stable dans un run → prompt système cacheable)

export interface KnownEntity {
  slug: string;
  label: string;
  entity_type: string;
  aliases: string[];
}
export interface KnownTheme {
  slug: string;
  label: string;
  aliases: string[];
}
export interface Registries {
  entities: KnownEntity[];
  themes: KnownTheme[];
  entityTypes: Set<string>;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

export async function loadRegistries(): Promise<Registries> {
  const entities: KnownEntity[] = [];
  for (const file of await listWikiDir('entities')) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const raw = await readRepoFile(`wiki/entities/${file}`);
    if (raw === null) continue;
    const { data } = matter(raw);
    const slug = String(data.slug ?? path.basename(file, '.md')).trim();
    entities.push({
      slug,
      label: String(data.label ?? slug).trim(),
      entity_type: String(data.entity_type ?? 'entity').trim(),
      aliases: arr(data.aliases),
    });
  }
  const themes: KnownTheme[] = [];
  for (const file of await listWikiDir('themes')) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const raw = await readRepoFile(`wiki/themes/${file}`);
    if (raw === null) continue;
    const { data } = matter(raw);
    const slug = String(data.slug ?? path.basename(file, '.md')).trim();
    themes.push({ slug, label: String(data.label ?? slug).trim(), aliases: arr(data.aliases) });
  }
  return { entities, themes, entityTypes: new Set(entities.map((e) => e.entity_type)) };
}

function renderRegistrySnapshot(reg: Registries): string {
  const themes = reg.themes
    .map((t) => `- ${t.slug} — ${t.label}${t.aliases.length ? ` (alias : ${t.aliases.join(', ')})` : ''}`)
    .join('\n');
  const entities = reg.entities
    .map((e) => `- ${e.slug} [${e.entity_type}] — ${e.label}${e.aliases.length ? ` (alias : ${e.aliases.join(', ')})` : ''}`)
    .join('\n');
  return (
    '# Registres connus (relie UNIQUEMENT à ces slugs, plus les déclarés du message)\n\n' +
    `## Thèmes connus\n${themes || '(aucun)'}\n\n` +
    `## Entités connues\n${entities || '(aucune)'}\n\n` +
    `## Types d'entités existants (n'en invente aucun)\n${[...reg.entityTypes].join(', ') || '(aucun)'}\n`
  );
}

// ————————————————————————————————————————————————————————————————
// Sidecar + confiance graduée (§R11 / docs/entities.md §4)

export interface Sidecar {
  links: Record<string, string[]>;
  entitiesGranularity: unknown;
  themes: string[];
  themesGranularity: string;
}

export function parseSidecar(sidecarText: string): Sidecar {
  const { data } = matter(sidecarText || '');
  const links: Record<string, string[]> = {};
  if (data.links && typeof data.links === 'object') {
    for (const [t, v] of Object.entries(data.links as Record<string, unknown>)) links[String(t)] = arr(v);
  }
  const themes = arr(data.themes).length ? arr(data.themes) : arr((data as any).topics);
  const tg = (data as any).themes_granularity;
  return {
    links,
    entitiesGranularity: (data as any).entities_granularity,
    themes,
    themesGranularity: typeof tg === 'string' ? tg : 'auto',
  };
}

export interface ResolvedEntity {
  slug: string;
  entity_type: string;
  label: string;
  aliases: string[];
  granularity: string;
  isNew: boolean;
}
export interface ResolvedTheme {
  slug: string;
  label: string;
  granularity: string;
  isNew: boolean;
}

function humanize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function granOf(g: unknown, type: string): string {
  if (typeof g === 'string') return g === 'resource' || g === 'chunk' ? g : 'auto';
  if (g && typeof g === 'object') {
    const v = (g as Record<string, unknown>)[type];
    return v === 'resource' || v === 'chunk' ? String(v) : 'auto';
  }
  return 'auto';
}

/**
 * Résout les entités/thèmes DÉCLARÉS au sidecar en slugs définitifs (§R11) :
 * - même type qu'une entité existante → s'y relie ; autre type → slug suffixé du type ;
 * - inconnue → nouvelle (page créée par la couche déterministe).
 */
export function resolveDeclarations(sidecar: Sidecar, reg: Registries): { declaredEntities: ResolvedEntity[]; declaredThemes: ResolvedTheme[] } {
  const bySlug = new Map(reg.entities.map((e) => [e.slug, e]));
  const declaredEntities: ResolvedEntity[] = [];
  for (const [rawType, slugs] of Object.entries(sidecar.links)) {
    const type = slugify(rawType);
    if (!type) continue;
    const gran = granOf(sidecar.entitiesGranularity, type);
    for (const rawSlug of slugs) {
      const base = slugify(rawSlug);
      if (!base) continue;
      const existing = bySlug.get(base);
      if (existing && existing.entity_type === type) {
        declaredEntities.push({ slug: base, entity_type: type, label: existing.label, aliases: existing.aliases, granularity: gran, isNew: false });
      } else if (existing) {
        const suff = `${base}-${type}`;
        const ex2 = bySlug.get(suff);
        if (ex2 && ex2.entity_type === type) {
          declaredEntities.push({ slug: suff, entity_type: type, label: ex2.label, aliases: ex2.aliases, granularity: gran, isNew: false });
        } else {
          declaredEntities.push({ slug: suff, entity_type: type, label: humanize(base), aliases: [], granularity: gran, isNew: true });
        }
      } else {
        declaredEntities.push({ slug: base, entity_type: type, label: humanize(base), aliases: [], granularity: gran, isNew: true });
      }
    }
  }
  const themeBySlug = new Map(reg.themes.map((t) => [t.slug, t]));
  const declaredThemes: ResolvedTheme[] = [];
  for (const rawSlug of sidecar.themes) {
    const slug = slugify(rawSlug);
    if (!slug) continue;
    const ex = themeBySlug.get(slug);
    declaredThemes.push({ slug, label: ex ? ex.label : humanize(slug), granularity: sidecar.themesGranularity, isNew: !ex });
  }
  return { declaredEntities, declaredThemes };
}

// ————————————————————————————————————————————————————————————————
// Extraction texte (md/txt directs ; PDF via unpdf, en local, gratuit)

export async function extractSourceText(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const abs = path.join(RAW_ROOT, file);
  if (ext === '.md' || ext === '.txt') return fs.readFile(abs, 'utf-8');
  if (ext === '.pdf') {
    const buf = await fs.readFile(abs);
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  throw new Error(`Extension non prise en charge pour l'extraction texte : ${ext} (md/txt/pdf seulement).`);
}

async function readRawSidecar(file: string): Promise<string> {
  try {
    return await fs.readFile(path.join(RAW_ROOT, `${file}.meta.md`), 'utf-8');
  } catch {
    return '';
  }
}

// ————————————————————————————————————————————————————————————————
// Appel modèle (un échange par ressource) + parsing sortie délimitée

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}
export interface DetectedNew {
  entities: any[];
  themes: any[];
}
export interface GenResult {
  markdown: string;
  detectedNew: DetectedNew;
  usage: Usage;
  gatewayCost: number | null;
  rawText: string;
}

/** Barème Sonnet 4.5 (USD / 1M tokens) — cf. spec §R8. */
const RATE = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

export function estimateCost(u: Usage): number {
  const inTok = u.input_tokens ?? 0;
  const outTok = u.output_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  return (inTok * RATE.input + outTok * RATE.output + cw * RATE.cacheWrite + cr * RATE.cacheRead) / 1_000_000;
}

export function parseGeneration(text: string): { markdown: string; detectedNew: DetectedNew } {
  const res = text.match(/<resource>\s*([\s\S]*?)\s*<\/resource>/);
  let markdown = (res ? res[1] : text).trim();
  if (!markdown.endsWith('\n')) markdown += '\n';
  let detectedNew: DetectedNew = { entities: [], themes: [] };
  const det = text.match(/<detected-new>\s*([\s\S]*?)\s*<\/detected-new>/);
  if (det) {
    try {
      const p = JSON.parse(det[1].trim());
      detectedNew = { entities: Array.isArray(p.entities) ? p.entities : [], themes: Array.isArray(p.themes) ? p.themes : [] };
    } catch {
      /* JSON invalide : on ignore les détections (pas bloquant) */
    }
  }
  return { markdown, detectedNew };
}

/** L'UNIQUE appel payant — isolé pour être injectable/mockable (cf. tests). */
async function callModel(system: string, user: string): Promise<GenResult> {
  const { data, response } = await anthropic.messages
    .create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    })
    .withResponse();
  const rawText = (data.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const { markdown, detectedNew } = parseGeneration(rawText);
  const gwRaw = response.headers.get('x-litellm-response-cost');
  const gatewayCost = gwRaw && Number.isFinite(parseFloat(gwRaw)) ? parseFloat(gwRaw) : null;
  return { markdown, detectedNew, usage: data.usage as Usage, gatewayCost, rawText };
}

// ————————————————————————————————————————————————————————————————
// Confiance graduée : candidates (détectés-inconnus)

const WIKI_TYPE_TO_RT: Record<string, ResourceType> = {
  article: 'article',
  'report-pdf': 'report_pdf',
  tweet: 'tweet',
  interview: 'interview',
  presentation: 'presentation',
  'meeting-notes': 'meeting_note',
  transcript: 'transcript',
  'personal-notes': 'personal_note',
};
const wikiTypeLabel = (t: string) => typeLabel(WIKI_TYPE_TO_RT[t] ?? 'unknown');

function normalizeForm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

interface CandDoc {
  version: number;
  generated: string;
  candidates: any[];
}
function parseCandidates(json: string | null, today: string): CandDoc {
  if (json) {
    try {
      const d = JSON.parse(json);
      return { version: d.version ?? 1, generated: d.generated ?? today, candidates: Array.isArray(d.candidates) ? d.candidates : [] };
    } catch {
      /* illisible : on repart d'un doc vide */
    }
  }
  return { version: 1, generated: today, candidates: [] };
}

function mergeCandidate(doc: CandDoc, item: any, resourceSlug: string, today: string, withTypes: string[] | null): void {
  const name = String(item?.name ?? '').trim();
  if (!name) return;
  const normalized = normalizeForm(name);
  if (!normalized) return;
  const seen = { resource: resourceSlug, section: item?.section ?? null, context: String(item?.context ?? '').slice(0, 200) };
  const existing = doc.candidates.find((c) => String(c?.normalized) === normalized);
  if (existing) {
    if (!Array.isArray(existing.variants)) existing.variants = [];
    if (!existing.variants.includes(name)) existing.variants.push(name);
    if (!Array.isArray(existing.seen_in)) existing.seen_in = [];
    existing.seen_in.push(seen);
    if (withTypes) {
      if (!Array.isArray(existing.suggested_types)) existing.suggested_types = [];
      for (const t of withTypes) if (!existing.suggested_types.includes(t)) existing.suggested_types.push(t);
    }
    existing.updated_at = today;
    return;
  }
  const base: any = {
    name,
    normalized,
    variants: [name],
    note: null,
    seen_in: [seen],
    suggested_aliases: [],
    status: 'pending',
    decision: withTypes ? { target_slug: null, entity_type: null, slug: null } : { target_slug: null, slug: null },
    updated_at: today,
  };
  if (withTypes) base.suggested_types = withTypes;
  doc.candidates.push(base);
}

/** Construit les ops sur `_candidates.json` (entités + thèmes) pour les détectés-inconnus. */
export async function buildCandidateOps(
  detected: DetectedNew,
  resourceSlug: string,
  reg: Registries,
  declaredEntities: ResolvedEntity[],
  declaredThemes: ResolvedTheme[],
  today: string,
): Promise<FileOp[]> {
  const ops: FileOp[] = [];

  const knownEntForms = new Set(reg.entities.flatMap((e) => [e.label, ...e.aliases].map(normalizeForm)));
  const declEntSlugs = new Set(declaredEntities.map((d) => d.slug));
  const eDet = (detected.entities ?? []).filter((d: any) => {
    const name = String(d?.name ?? '');
    if (!name) return false;
    return !knownEntForms.has(normalizeForm(name)) && !declEntSlugs.has(slugify(name));
  });
  if (eDet.length) {
    const doc = parseCandidates(await readRepoFile('wiki/entities/_candidates.json'), today);
    doc.generated = today;
    for (const d of eDet) {
      const types = d?.entity_type && reg.entityTypes.has(String(d.entity_type)) ? [String(d.entity_type)] : [];
      mergeCandidate(doc, d, resourceSlug, today, types);
    }
    ops.push({ path: 'wiki/entities/_candidates.json', content: JSON.stringify(doc, null, 2) + '\n' });
  }

  const knownThemeForms = new Set(reg.themes.flatMap((t) => [t.label, ...t.aliases].map(normalizeForm)));
  const declThemeSlugs = new Set(declaredThemes.map((d) => d.slug));
  const tDet = (detected.themes ?? []).filter((d: any) => {
    const name = String(d?.name ?? '');
    if (!name) return false;
    return !knownThemeForms.has(normalizeForm(name)) && !declThemeSlugs.has(slugify(name));
  });
  if (tDet.length) {
    const doc = parseCandidates(await readRepoFile('wiki/themes/_candidates.json'), today);
    doc.generated = today;
    for (const d of tDet) mergeCandidate(doc, d, resourceSlug, today, null);
    ops.push({ path: 'wiki/themes/_candidates.json', content: JSON.stringify(doc, null, 2) + '\n' });
  }

  return ops;
}

// ————————————————————————————————————————————————————————————————
// Tuyauterie déterministe : sortie IA → FileOps (testable sans appel payant)

function fmArray(fm: string, key: string): string[] {
  const m = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, 'm'));
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Force `source_file` au nom réel du fichier /raw (robustesse du manifeste). */
function forceSourceFile(markdown: string, file: string): string {
  const { fm, rest } = splitFrontmatter(markdown);
  let nf = setScalar(fm, 'source_file', JSON.stringify(file));
  if (!/^source_file:/m.test(nf)) nf = `${nf}\nsource_file: ${JSON.stringify(file)}`;
  return withFrontmatter(nf, rest);
}

export interface IngestOneInput {
  file: string;
  markdown: string;
  detectedNew: DetectedNew;
  declaredEntities: ResolvedEntity[];
  declaredThemes: ResolvedTheme[];
  registries: Registries;
  today: string;
}

/**
 * Cœur déterministe : à partir de la page ressource produite par l'IA, lit les vues
 * fraîches sur disque, applique la confiance graduée (§R11), et renvoie la liste des
 * `FileOp` (projection + candidates). N'écrit rien (l'appelant applique).
 */
export async function ingestOne(input: IngestOneInput): Promise<{ ops: FileOp[]; slug: string; warnings: string[] }> {
  const { file, today, registries: reg } = input;
  const markdown = forceSourceFile(input.markdown, file);
  const { fm } = splitFrontmatter(markdown);
  const meta = parseResourceMeta(markdown, '');
  const slug = meta.slug;
  const warnings: string[] = [];

  const feTopics = fmArray(fm, 'topics');
  const feEntities = fmArray(fm, 'entities');

  const knownEntSlugs = new Set(reg.entities.map((e) => e.slug));
  const knownThemeSlugs = new Set(reg.themes.map((t) => t.slug));
  const declEntMap = new Map(input.declaredEntities.map((d) => [d.slug, d]));
  const declThemeMap = new Map(input.declaredThemes.map((d) => [d.slug, d]));

  // Entités (frontmatter ∪ chunk) : lecture fraîche + détermination des créations.
  const entities: Record<string, string | null> = {};
  const newEntities: Record<string, NewEntityDecl> = {};
  for (const e of meta.entities) {
    const existing = await readRepoFile(`wiki/entities/${e}.md`);
    entities[e] = existing;
    if (existing === null) {
      const d = declEntMap.get(e);
      if (d) newEntities[e] = { entity_type: d.entity_type, label: d.label, aliases: d.aliases };
      else {
        newEntities[e] = { entity_type: 'concept', label: humanize(e), aliases: [] };
        if (!knownEntSlugs.has(e)) warnings.push(`entité liée « ${e} » ni connue ni déclarée (page créée par défaut en 'concept')`);
      }
    }
  }

  // Thèmes (frontmatter ∪ chunk) : lecture fraîche + labels.
  const themes: Record<string, string | null> = {};
  const themeLabels: Record<string, string> = {};
  for (const t of meta.topics) {
    themes[t] = await readRepoFile(`wiki/themes/${t}.md`);
    const known = reg.themes.find((x) => x.slug === t);
    themeLabels[t] = known ? known.label : declThemeMap.get(t)?.label ?? humanize(t);
    if (themes[t] === null && !known && !declThemeMap.has(t))
      warnings.push(`thème lié « ${t} » ni connu ni déclaré (page créée par défaut)`);
  }

  const aslug = meta.author ? slugify(meta.author) : null;
  const date = meta.date ?? '';
  const year = date.slice(0, 4);
  const ym = date.slice(0, 7);
  const isMonth = date.length >= 7;

  const [authorContent, originContent, yearContent, monthContent, graph, manifest, index, types] = await Promise.all([
    aslug ? readRepoFile(`wiki/authors/${aslug}.md`) : Promise.resolve(null),
    meta.origin ? readRepoFile(`wiki/origin/${meta.origin}.md`) : Promise.resolve(null),
    year ? readRepoFile(`wiki/by-date/${year}/${year}.md`) : Promise.resolve(null),
    isMonth ? readRepoFile(`wiki/by-date/${year}/${ym}/${ym}.md`) : Promise.resolve(null),
    readRepoFile('wiki/graph.json'),
    readRepoFile('wiki/_ingested.json'),
    readRepoFile('wiki/index.md'),
    readRepoFile('wiki/types.md'),
  ]);
  if (graph === null || manifest === null || index === null) {
    throw new Error('Fichiers d’index du wiki illisibles (graph/manifest/index).');
  }

  const views: ProjectViews = {
    themes,
    themeLabels,
    authorPath: aslug ? `wiki/authors/${aslug}.md` : null,
    authorContent,
    originPath: meta.origin ? `wiki/origin/${meta.origin}.md` : null,
    originContent,
    entities,
    newEntities,
    yearPath: year ? `wiki/by-date/${year}/${year}.md` : null,
    yearContent,
    monthPath: isMonth ? `wiki/by-date/${year}/${ym}/${ym}.md` : null,
    monthContent,
    graph,
    manifest,
    index,
    types,
  };

  const projOps = projectResource({ slug, resourceContent: markdown, views, slugifyAuthor: slugify, typeLabel: wikiTypeLabel, today });
  const candOps = await buildCandidateOps(input.detectedNew, slug, reg, input.declaredEntities, input.declaredThemes, today);
  void knownThemeSlugs; // (réservé — la complétude des thèmes est jugée par wiki:verify)
  return { ops: [...projOps, ...candOps], slug, warnings };
}

// ————————————————————————————————————————————————————————————————
// Construction du message utilisateur

function buildUserMessage(
  raw: string,
  sidecarText: string,
  file: string,
  declaredEntities: ResolvedEntity[],
  declaredThemes: ResolvedTheme[],
  today: string,
): string {
  const parts: string[] = [`Fichier source (source_file) : ${file}`, `Date du jour : ${today}`];
  parts.push(
    declaredEntities.length
      ? 'Entités DÉCLARÉES (relie-les EXACTEMENT à ces slugs) :\n' +
          declaredEntities.map((d) => `- ${d.slug} [${d.entity_type}] — granularité : ${d.granularity}`).join('\n')
      : 'Entités déclarées : aucune.',
  );
  parts.push(
    declaredThemes.length
      ? 'Thèmes DÉCLARÉS (relie-les EXACTEMENT à ces slugs) :\n' +
          declaredThemes.map((d) => `- ${d.slug} — granularité : ${d.granularity}`).join('\n')
      : 'Thèmes déclarés : aucun.',
  );
  if (sidecarText.trim()) parts.push(`Métadonnées (sidecar — FAIT AUTORITÉ) :\n\`\`\`\n${sidecarText.trim()}\n\`\`\``);
  parts.push(`Contenu brut de la source :\n\`\`\`\n${raw}\n\`\`\``);
  parts.push('Produis maintenant le bloc <resource>…</resource> puis le bloc <detected-new>…</detected-new>, et RIEN d’autre.');
  return parts.join('\n\n');
}

// ————————————————————————————————————————————————————————————————
// Ingestion (orchestration du run)

export async function runIngestion(): Promise<void> {
  if (!acquireLock()) return; // déjà en cours

  try {
    const pending = await detectPending();
    if (pending.length === 0) {
      await writeIngestState({ status: 'done', finishedAt: nowIso(), pending: [] });
      return;
    }
    await writeIngestState({ status: 'running', startedAt: nowIso(), pending });

    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(LOG_PATH, `# Ingestion ${nowIso()} — ${pending.length} fichier(s)\n`);
    const log = (s: string) => {
      try {
        fsSync.appendFileSync(LOG_PATH, s + '\n');
      } catch {
        /* best-effort */
      }
    };

    const today = nowIso().slice(0, 10);
    const registries = await loadRegistries();
    const staticPrompt = await fs.readFile(PROMPT_PATH, 'utf-8');
    // Système = prompt statique + snapshot registres (identique dans le run → cache hits).
    const system = `${staticPrompt}\n\n${renderRegistrySnapshot(registries)}`;

    const perFile: { file: string; costUsd: number }[] = [];
    let totalCost = 0;
    let lastSlug: string | undefined;
    const errors: string[] = [];

    for (const file of pending) {
      try {
        const raw = await extractSourceText(file);
        if (!raw.trim()) throw new Error(`Extraction vide pour ${file}`);
        const sidecarText = await readRawSidecar(file);
        const sidecar = parseSidecar(sidecarText);
        const { declaredEntities, declaredThemes } = resolveDeclarations(sidecar, registries);
        const user = buildUserMessage(raw, sidecarText, file, declaredEntities, declaredThemes, today);

        const gen = await callModel(system, user);
        const cost = gen.gatewayCost ?? estimateCost(gen.usage);
        totalCost += cost;
        perFile.push({ file, costUsd: Number(cost.toFixed(6)) });
        log(
          `[${file}] in=${gen.usage.input_tokens} out=${gen.usage.output_tokens} ` +
            `cache_read=${gen.usage.cache_read_input_tokens ?? 0} cache_write=${gen.usage.cache_creation_input_tokens ?? 0} ` +
            `→ coût ${gen.gatewayCost != null ? 'gateway' : 'estimé'} $${cost.toFixed(4)}`,
        );

        const { ops, slug, warnings } = await ingestOne({
          file,
          markdown: gen.markdown,
          detectedNew: gen.detectedNew,
          declaredEntities,
          declaredThemes,
          registries,
          today,
        });
        await applyFileOps(ops);
        lastSlug = slug;
        for (const w of warnings) log(`[${file}] ⚠ ${w}`);
        log(`[${file}] projeté → ${slug} (${ops.length} écritures)`);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        errors.push(`${file} : ${msg}`);
        log(`[${file}] ERREUR : ${msg}`);
      }
    }

    const verifyTail = await runWikiVerify();
    const costUsd = Number(totalCost.toFixed(6));

    if (perFile.length === 0) {
      await writeIngestState({
        status: 'error',
        finishedAt: nowIso(),
        pending,
        error: errors.join(' | ') || 'Aucune ressource ingérée',
        logTail: verifyTail,
      });
    } else {
      await writeIngestState({
        status: 'done',
        finishedAt: nowIso(),
        pending,
        slug: lastSlug,
        costUsd,
        perFile,
        logTail: verifyTail,
        ...(errors.length ? { error: errors.join(' | ') } : {}),
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
