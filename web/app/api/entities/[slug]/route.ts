import { NextRequest } from 'next/server';
import { applyFileOps, readRepoFile } from '@/lib/wiki-fs';
import { slugify } from '@/lib/wiki-parser';
import { deleteEntity, entityReferencingResources } from '@/lib/wiki-mutate';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Supprime DÉTERMINISTIQUEMENT une entité du registre (miroir de la suppression de
 * ressource) : retire la fiche `wiki/entities/<slug>.md`, le nœud `entity:<slug>` +
 * ses arêtes du graphe, le lien dans chaque ressource citante, et purge défensivement
 * une candidate résiduelle. Geste EXPLICITE (jamais en cascade depuis une ressource).
 * Écriture locale via `applyFileOps`, en un seul lot.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }

  const entityContent = await readRepoFile(`wiki/entities/${slug}.md`);
  if (entityContent === null) {
    return Response.json({ error: `Entité « ${slug} » introuvable` }, { status: 404 });
  }

  const [graph, candidatesJson] = await Promise.all([
    readRepoFile('wiki/graph.json'),
    readRepoFile('wiki/entities/_candidates.json'),
  ]);
  if (graph === null) {
    return Response.json(
      { error: 'Lecture du graphe (graph.json) impossible.' },
      { status: 502 },
    );
  }

  // Ressources citantes : lues depuis les blocs `### [[../resources/<r>]]` des Mentions.
  const referencingResources: Record<string, string> = {};
  await Promise.all(
    entityReferencingResources(entityContent).map(async (r) => {
      const c = await readRepoFile(`wiki/resources/${r}.md`);
      if (c !== null) referencingResources[r] = c;
    }),
  );

  const ops = deleteEntity({
    slug,
    entityContent,
    graph,
    referencingResources,
    candidatesJson: candidatesJson ?? undefined,
    slugify,
  });

  try {
    await applyFileOps(ops);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
