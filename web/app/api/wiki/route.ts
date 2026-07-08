import { listTopics } from '@/lib/wiki-query';

export const dynamic = 'force-dynamic';

// Les thèmes sont des vues dérivées générées par l'agent depuis les ressources
// (git = source de vérité). La plateforme les lit seulement, ne les crée pas.
export async function GET() {
  const topics = await listTopics();
  return Response.json({ topics });
}
