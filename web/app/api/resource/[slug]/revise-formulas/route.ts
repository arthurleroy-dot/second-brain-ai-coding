import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { applyFileOps, readRepoFile } from '@/lib/wiki-fs';
import { parseResourceMeta } from '@/lib/wiki-mutate';
import { projectResource } from '@/lib/wiki-project';
import { slugify } from '@/lib/wiki-parser';
import { typeLabel } from '@/lib/ui';
import {
  loadRegistries,
  loadProjectViews,
  rebuildDerivedIndexes,
  estimateCostFor,
  lockHeld,
} from '@/lib/ingest-local';
import { listFormulaBlocks, graftFormulaBlock } from '@/lib/formula-block';
import { getAnthropic, getModel } from '@/lib/claude';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;
const wikiTypeLabel = (t: string) => typeLabel(t);

// Prompt système statique (chargé une fois, mémoïsé) — même mécanisme que la passe vision.
const REFERENCE_ROOT = process.env.REFERENCE_DOCS_ROOT ?? path.resolve(process.cwd(), '..');
const PROMPT_PATH = path.join(REFERENCE_ROOT, 'prompts', 'revise-formula-prompt.md');
let _prompt: string | null = null;
async function loadPrompt(): Promise<string> {
  if (_prompt == null) _prompt = await fs.readFile(PROMPT_PATH, 'utf-8');
  return _prompt;
}

/** Nettoie la sortie IA : retire un éventuel bloc de code englobant et des `$$` ajoutés. */
function cleanLatex(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1].trim();
  s = s.replace(/^\$\$\s*/, '').replace(/\s*\$\$$/, '').trim();
  return s;
}

/**
 * Liste les blocs formule d'une ressource (pour l'UI de révision) : ancre = l'index
 * d'apparition dans le corps. `{ formulas: { index, latex }[] }`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }
  const content = await readRepoFile(`wiki/resources/${slug}.md`);
  if (content === null) {
    return Response.json({ error: `Ressource « ${slug} » introuvable` }, { status: 404 });
  }
  return Response.json({ formulas: listFormulaBlocks(content) });
}

/**
 * RÉVISION IA d'UNE formule (spec §3.3). `POST { index, instruction }` : re-génère le
 * LaTeX du bloc formule d'index `index` en suivant une **consigne en langage naturel**
 * (le levier — un simple re-run redonnerait la même erreur), greffe chirurgicalement le
 * nouveau LaTeX (conserve `$$` + marqueur) puis re-projette. Le frontmatter est INCHANGÉ
 * (pas de « retract ») : on ne touche que le LaTeX intérieur d'un bloc déjà annoté.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }
  // Une ingestion en cours écrit aussi graph.json/index : on sérialise pour éviter la course.
  if (lockHeld()) {
    return Response.json({ error: 'Ingestion en cours — réessaie dans un instant.' }, { status: 409 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  const index = Math.floor(Number(payload?.index));
  const instruction = String(payload?.instruction ?? '').trim();
  if (!Number.isInteger(index) || index < 0) {
    return Response.json({ error: 'Index invalide (attendu un entier ≥ 0).' }, { status: 400 });
  }
  if (!instruction) {
    return Response.json({ error: 'Consigne de correction vide.' }, { status: 400 });
  }

  const content = await readRepoFile(`wiki/resources/${slug}.md`);
  if (content === null) {
    return Response.json({ error: `Ressource « ${slug} » introuvable` }, { status: 404 });
  }
  const formulas = listFormulaBlocks(content);
  const current = formulas[index];
  if (!current) {
    return Response.json({ error: `Aucune formule à l'index ${index} (la ressource en a ${formulas.length}).` }, { status: 400 });
  }

  // Texte source brut (contexte). Un PDF donnerait du binaire illisible → on l'ignore
  // (les formules d'un PDF passent par la passe figure, hors périmètre ici).
  const sourceFile = parseResourceMeta(content, slug).source_file;
  let rawText = '';
  if (sourceFile && !sourceFile.toLowerCase().endsWith('.pdf')) {
    rawText = (await readRepoFile(`raw/${sourceFile}`)) ?? '';
  }

  // Appel IA (modèle TEXTE d'ingestion), non-streaming → en-tête coût gateway fiable.
  let newLatex = '';
  let costUsd = 0;
  try {
    const system = await loadPrompt();
    const user = [
      `LaTeX actuel :\n${current.latex}`,
      `Consigne de l'utilisateur :\n${instruction}`,
      rawText ? `Texte source (contexte) :\n${rawText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');

    const model = getModel();
    const { data, response } = await getAnthropic()
      .messages.create({
        model,
        max_tokens: 4000,
        system: [{ type: 'text', text: system }],
        messages: [{ role: 'user', content: user }],
        stream: false,
      })
      .withResponse();

    newLatex = cleanLatex(
      (data.content as any[])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(''),
    );
    const gwRaw = response.headers.get('x-litellm-response-cost');
    const gatewayCost = gwRaw && Number.isFinite(parseFloat(gwRaw)) ? parseFloat(gwRaw) : null;
    costUsd = gatewayCost ?? estimateCostFor(model, data.usage as any);
  } catch (e: any) {
    return Response.json({ error: `Appel IA échoué : ${e?.message ?? e}` }, { status: 502 });
  }

  if (!newLatex) {
    return Response.json({ error: "L'IA n'a produit aucun LaTeX exploitable." }, { status: 502 });
  }

  const md = graftFormulaBlock(content, index, newLatex);
  if (md === content) {
    // Rien n'a changé (le nouveau LaTeX est identique) → pas de ré-écriture.
    return Response.json({ ok: true, changed: false, index, costUsd: Number(costUsd.toFixed(6)) });
  }

  // Re-projection déterministe : le frontmatter (topics/entités/date/type) est INCHANGÉ
  // (on ne touche que le LaTeX d'un bloc déjà présent dans une section déjà annotée) →
  // pas de « retract », un simple projectResource re-dérive les vues + graphe + manifeste.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const reg = await loadRegistries();
    const { views } = await loadProjectViews(md, reg, today, [], []);
    const ops = projectResource({ slug, resourceContent: md, views, slugifyAuthor: slugify, typeLabel: wikiTypeLabel, today });
    await applyFileOps(ops);
    await applyFileOps(await rebuildDerivedIndexes(today));
    return Response.json({ ok: true, changed: true, index, costUsd: Number(costUsd.toFixed(6)) });
  } catch (e: any) {
    return Response.json({ error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` }, { status: 500 });
  }
}
