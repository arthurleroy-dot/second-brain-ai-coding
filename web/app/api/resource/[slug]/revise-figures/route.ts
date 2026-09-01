import { NextRequest } from 'next/server';
import { getDocumentProxy } from 'unpdf';
import { applyFileOps, readRepoFile, readRepoBinary } from '@/lib/wiki-fs';
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
import { extractPdfPerPage, visionTranscribePage } from '@/lib/vision-ingest';
import { renderPdfPageToPng } from '@/lib/pdf-render';
import { graftFigureBlock } from '@/lib/figure-block';
import { getVisionModel } from '@/lib/claude';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;
const wikiTypeLabel = (t: string) => typeLabel(t);

/** Pages du PDF ayant déjà un bloc figure (ancre `/api/raw-image/…?page=N` dans le corps). */
function figurePagesOf(md: string): number[] {
  const pages = [...md.matchAll(/\/api\/raw-image\/[^\s)]*[?&]page=(\d+)/g)].map((m) => Number(m[1]));
  return [...new Set(pages)].sort((a, b) => a - b);
}

/**
 * Métadonnées pour l'UI de rattrapage (cases à cocher) : nombre total de pages du PDF +
 * pages qui portent déjà un bloc figure. `totalPages: 0` = pas de PDF / illisible.
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
  const sourceFile = parseResourceMeta(content, slug).source_file;
  if (!sourceFile || !sourceFile.toLowerCase().endsWith('.pdf')) {
    return Response.json({ totalPages: 0, figurePages: [] });
  }
  const bytes = await readRepoBinary(`raw/${sourceFile}`);
  if (!bytes) return Response.json({ totalPages: 0, figurePages: figurePagesOf(content) });
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    return Response.json({ totalPages: pdf.numPages, figurePages: figurePagesOf(content) });
  } catch {
    return Response.json({ totalPages: 0, figurePages: figurePagesOf(content) });
  }
}

/**
 * RATTRAPAGE page par page (spec §D). `POST { pages: number[] }` : re-traite en VISION
 * (Haiku) UNIQUEMENT les pages demandées d'un PDF déjà ingéré, et greffe/remplace leur
 * bloc figure (ancre = l'URL image `?page=N`) dans `wiki/resources/<slug>.md`, puis
 * re-projette. Ciblé, rapide, à quelques centimes. Aucune autre section n'est touchée.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }
  // Un run d'ingestion écrit aussi graph.json/index : on sérialise pour éviter la course.
  if (lockHeld()) {
    return Response.json({ error: 'Ingestion en cours — réessaie dans un instant.' }, { status: 409 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  const requested = Array.isArray(payload?.pages)
    ? [...new Set(payload.pages.map((p: unknown) => Math.floor(Number(p))).filter((n: number) => Number.isFinite(n) && n >= 1))]
    : [];
  if (requested.length === 0) {
    return Response.json({ error: 'Aucune page valide (attendu { pages: [numéros ≥ 1] }).' }, { status: 400 });
  }

  const content = await readRepoFile(`wiki/resources/${slug}.md`);
  if (content === null) {
    return Response.json({ error: `Ressource « ${slug} » introuvable` }, { status: 404 });
  }
  const meta = parseResourceMeta(content, slug);
  const sourceFile = meta.source_file;
  if (!sourceFile || !sourceFile.toLowerCase().endsWith('.pdf')) {
    return Response.json({ error: 'Le rattrapage vision ne concerne que les ressources PDF.' }, { status: 400 });
  }

  const model = getVisionModel();
  let pdfData: { pages: string[]; pdf: any };
  try {
    pdfData = await extractPdfPerPage(sourceFile);
  } catch (e: any) {
    return Response.json({ error: `PDF illisible (${sourceFile}) : ${e?.message ?? e}` }, { status: 500 });
  }
  const totalPages = pdfData.pages.length;

  let md = content;
  let costUsd = 0;
  const revised: number[] = [];
  const warnings: string[] = [];

  for (const page of requested as number[]) {
    if (page > totalPages) {
      warnings.push(`page ${page} hors bornes (le PDF a ${totalPages} pages)`);
      continue;
    }
    try {
      const png = await renderPdfPageToPng(pdfData.pdf, page, 2);
      const { markdown, usage, gatewayCost } = await visionTranscribePage({
        pngBase64: png.toString('base64'),
        pageText: pdfData.pages[page - 1] ?? '',
        pageNumber: page,
        sourceFile,
        model,
      });
      costUsd += gatewayCost ?? estimateCostFor(model, usage);
      if (markdown.trim()) {
        md = graftFigureBlock(md, page, markdown);
        revised.push(page);
      } else {
        warnings.push(`page ${page} : la vision n'a produit aucun bloc figure (rien de visuel exploitable ?)`);
      }
    } catch (e: any) {
      warnings.push(`page ${page} : échec vision (${e?.message ?? e})`);
    }
  }

  if (revised.length === 0) {
    // Rien de greffé → pas de ré-écriture (fiche inchangée).
    return Response.json({ ok: true, revised, warnings, costUsd: Number(costUsd.toFixed(6)) });
  }

  // Re-projection : le frontmatter (topics/entités/auteur/date/type) est INCHANGÉ (les
  // blocs figure greffés n'ajoutent pas d'annotations), donc pas de « retract » — un simple
  // projectResource re-dérive les vues + graphe + manifeste depuis le .md à jour.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const reg = await loadRegistries();
    const { views } = await loadProjectViews(md, reg, today, [], []);
    const ops = projectResource({ slug, resourceContent: md, views, slugifyAuthor: slugify, typeLabel: wikiTypeLabel, today });
    await applyFileOps(ops);
    await applyFileOps(await rebuildDerivedIndexes(today));
    return Response.json({ ok: true, slug, revised, warnings, costUsd: Number(costUsd.toFixed(6)) });
  } catch (e: any) {
    return Response.json({ error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` }, { status: 500 });
  }
}
