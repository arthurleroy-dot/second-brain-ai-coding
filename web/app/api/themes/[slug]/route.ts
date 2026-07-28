import { NextRequest } from 'next/server';
import { applyFileOps, readRepoFile } from '@/lib/wiki-fs';
import { listTopics } from '@/lib/wiki-query';
import { slugify } from '@/lib/wiki-parser';
import { deleteTheme } from '@/lib/wiki-mutate';
import { rebuildDerivedIndexes } from '@/lib/ingest-local';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Supprime DÉTERMINISTIQUEMENT un thème du registre (miroir de la suppression d'entité) :
 * retire la fiche `wiki/themes/<slug>.md`, le nœud `theme:<slug>` + ses arêtes du graphe,
 * puis strippe le thème de TOUTES les ressources qui le citent (frontmatter `topics:`,
 * annotations chunk, blockquote de nav) et de la colonne « Topics » des pages auteur.
 * Enfin régénère `index.md` + `by-date/` via `rebuildDerivedIndexes` (compteurs recomptés,
 * bullet retiré). Geste EXPLICITE ; seule garde : le thème doit exister (404 sinon).
 * Écriture locale via `applyFileOps`.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }

  const graph = await readRepoFile('wiki/graph.json');
  if (graph === null) {
    return Response.json({ error: 'Lecture du graphe (graph.json) impossible.' }, { status: 502 });
  }

  // Garde-fou existence : listTopics() recompte la vérité depuis les ressources et fournit
  // aussi la liste EXACTE des ressources citantes (frontmatter ∪ chunk) à nettoyer.
  const topic = (await listTopics()).find((t) => t.slug === slug);
  if (!topic) {
    return Response.json({ error: `Thème « ${slug} » introuvable` }, { status: 404 });
  }

  // Contenus des ressources citantes.
  const referencingResources: Record<string, string> = {};
  await Promise.all(
    topic.sources.map(async (s) => {
      const c = await readRepoFile(`wiki/resources/${s.slug}.md`);
      if (c !== null) referencingResources[s.slug] = c;
    }),
  );

  // Pages auteur distinctes parmi les ressources citantes (colonne Topics à nettoyer).
  const authorSlugs = [
    ...new Set(topic.sources.map((s) => s.author).filter(Boolean).map((a) => slugify(a!))),
  ];
  const authorPages: Record<string, string> = {};
  await Promise.all(
    authorSlugs.map(async (a) => {
      const c = await readRepoFile(`wiki/authors/${a}.md`);
      if (c !== null) authorPages[a] = c;
    }),
  );

  const ops = deleteTheme({ slug, graph, referencingResources, authorPages, slugify });

  try {
    // Phase 1 : strip des ressources + suppression fiche/graphe. DOIT précéder la phase 2
    // (rebuildDerivedIndexes relit les ressources sur disque pour recompter index + by-date).
    await applyFileOps(ops);
    await applyFileOps(await rebuildDerivedIndexes(new Date().toISOString().slice(0, 10)));
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
