import { getGraph } from '@/lib/wiki-parser';

export const dynamic = 'force-dynamic';

// Le graphe (wiki/graph.json) est une vue dérivée générée à l'ingestion
// (git = source de vérité). La plateforme le lit seulement pour le visualiser.
export async function GET() {
  return Response.json(await getGraph());
}
