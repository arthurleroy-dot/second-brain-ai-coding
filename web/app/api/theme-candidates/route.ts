import { listThemeCandidates } from '@/lib/wiki-parser';

export const dynamic = 'force-dynamic';

/**
 * File des thèmes candidats (wiki/themes/_candidates.json) : thèmes détectés à
 * l'ingestion mais pas encore validés par un humain. Alimente la page /themes
 * (section « en attente ») et le badge de la barre du haut. Miroir de
 * /api/candidates.
 */
export async function GET() {
  const candidates = await listThemeCandidates();
  const pending = candidates.filter((c) => c.status === 'pending').length;
  return Response.json({ candidates, pending });
}
