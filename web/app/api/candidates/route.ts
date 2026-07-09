import { listCandidates } from '@/lib/wiki-parser';

export const dynamic = 'force-dynamic';

/**
 * File des entités candidates (wiki/entities/_candidates.json) : entités
 * détectées à l'ingestion mais pas encore validées par un humain. Alimente la
 * page /entities (section « en attente ») et le badge de la barre du haut.
 */
export async function GET() {
  const candidates = await listCandidates();
  const pending = candidates.filter((c) => c.status === 'pending').length;
  return Response.json({ candidates, pending });
}
