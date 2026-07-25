import { NextRequest } from 'next/server';
import { applyFileOps, readRepoFile, repoPathExists } from '@/lib/wiki-fs';
import { slugify } from '@/lib/wiki-parser';
import { typeLabel } from '@/lib/ui';
import { ResourceType } from '@/types';
import { deleteResource, parseResourceMeta, type DeleteViews } from '@/lib/wiki-mutate';
import { rebuildDerivedIndexes } from '@/lib/ingest-local';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

// source_type du wiki (avec tiret) → ResourceType (web) pour le libellé d'index.
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

/**
 * Supprime DÉTERMINISTIQUEMENT une ressource : retire la ressource canonique +
 * toutes ses références (thèmes, auteur, origine, by-date, entités, graphe,
 * index, types, manifeste) + les fichiers bruts (`raw/<source>` + sidecar).
 * Écriture locale via `applyFileOps` ; la clé du manifeste `_ingested.json` est
 * purgée dans le même lot, donc aucune ré-ingestion possible de la source.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }

  const resourceContent = await readRepoFile(`wiki/resources/${slug}.md`);
  if (resourceContent === null) {
    return Response.json({ error: `Ressource « ${slug} » introuvable` }, { status: 404 });
  }

  const meta = parseResourceMeta(resourceContent, slug);
  const authorSlug = meta.author ? slugify(meta.author) : null;
  const year = (meta.date ?? '').slice(0, 4);
  const ym = (meta.date ?? '').slice(0, 7);
  const isMonth = (meta.date ?? '').length >= 7;

  // Lecture des vues dépendantes (déduites du frontmatter — pas de scan global).
  const themes: Record<string, string> = {};
  await Promise.all(
    meta.topics.map(async (t) => {
      const c = await readRepoFile(`wiki/themes/${t}.md`);
      if (c !== null) themes[t] = c;
    }),
  );
  const entities: Record<string, string> = {};
  await Promise.all(
    meta.entities.map(async (e) => {
      const c = await readRepoFile(`wiki/entities/${e}.md`);
      if (c !== null) entities[e] = c;
    }),
  );

  const [
    authorContent,
    originContent,
    yearContent,
    monthContent,
    graph,
    manifest,
    index,
    types,
    metaExists,
  ] = await Promise.all([
    authorSlug ? readRepoFile(`wiki/authors/${authorSlug}.md`) : Promise.resolve(null),
    meta.origin ? readRepoFile(`wiki/origin/${meta.origin}.md`) : Promise.resolve(null),
    year ? readRepoFile(`wiki/by-date/${year}/${year}.md`) : Promise.resolve(null),
    isMonth ? readRepoFile(`wiki/by-date/${year}/${ym}/${ym}.md`) : Promise.resolve(null),
    readRepoFile('wiki/graph.json'),
    readRepoFile('wiki/_ingested.json'),
    readRepoFile('wiki/index.md'),
    readRepoFile('wiki/types.md'),
    meta.source_file
      ? repoPathExists(`raw/${meta.source_file}.meta.md`)
      : Promise.resolve(false),
  ]);

  if (graph === null || manifest === null || index === null) {
    return Response.json(
      { error: 'Lecture des fichiers d’index du wiki impossible (graph/manifest/index).' },
      { status: 502 },
    );
  }

  const views: DeleteViews = {
    themes,
    authorPath: authorSlug ? `wiki/authors/${authorSlug}.md` : null,
    authorContent,
    originPath: meta.origin ? `wiki/origin/${meta.origin}.md` : null,
    originContent,
    entities,
    yearPath: year ? `wiki/by-date/${year}/${year}.md` : null,
    yearContent,
    monthPath: isMonth ? `wiki/by-date/${year}/${ym}/${ym}.md` : null,
    monthContent,
    graph,
    manifest,
    index,
    types,
    metaExists,
  };

  const ops = deleteResource({
    slug,
    resourceContent,
    views,
    slugifyAuthor: slugify,
    typeLabel: wikiTypeLabel,
  });

  try {
    await applyFileOps(ops);
    // Régénère index.md + by-date EN ENTIER après suppression : lignes retirées,
    // compteurs à jour, pages by-date orphelines purgées.
    await applyFileOps(await rebuildDerivedIndexes(new Date().toISOString().slice(0, 10)));
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
