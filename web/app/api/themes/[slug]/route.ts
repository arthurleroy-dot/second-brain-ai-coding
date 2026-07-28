import { NextRequest } from 'next/server';
import { applyFileOps, readRepoFile } from '@/lib/wiki-fs';
import { listTopics } from '@/lib/wiki-query';
import { deleteTheme } from '@/lib/wiki-mutate';
import { rebuildDerivedIndexes } from '@/lib/ingest-local';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Supprime DÉTERMINISTIQUEMENT un thème VIDE du registre (miroir de la suppression
 * d'entité) : retire la fiche `wiki/themes/<slug>.md`, le nœud `theme:<slug>` + ses
 * arêtes du graphe, puis régénère `index.md` (section « Thèmes » recomptée, bullet
 * retiré). Geste EXPLICITE, restreint aux thèmes que plus AUCUNE ressource ne cite :
 * un thème encore cité serait recréé à la prochaine ingestion → refus (400).
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

  // Garde-fou existence + vacuité : listTopics() recompte la vérité depuis les
  // ressources (indépendant d'un resource_count périmé au frontmatter).
  const topic = (await listTopics()).find((t) => t.slug === slug);
  if (!topic) {
    return Response.json({ error: `Thème « ${slug} » introuvable` }, { status: 404 });
  }
  if (topic.source_count > 0) {
    return Response.json(
      {
        error: `Le thème n'est pas vide : ${topic.source_count} ressource(s) le citent encore.`,
      },
      { status: 400 },
    );
  }

  const ops = deleteTheme({ slug, graph });

  try {
    await applyFileOps(ops);
    // Régénère index.md + by-date EN ENTIER après suppression : bullet du thème
    // retiré, compteur « ## Thèmes (T) » à jour.
    await applyFileOps(await rebuildDerivedIndexes(new Date().toISOString().slice(0, 10)));
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
