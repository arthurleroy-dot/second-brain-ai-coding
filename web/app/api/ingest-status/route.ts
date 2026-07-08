import { NextRequest } from 'next/server';
import { fetchIngestManifest, hasActiveIngestRun, isGithubConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';

/**
 * Statut d'ingestion d'un fichier déposé dans /raw.
 * - "ingested" : présent dans wiki/_ingested.json (avec le slug de la ressource).
 * - "processing" : un run de l'Action est en cours/en file.
 * - "pending" : déposé, en attente (traitement auto + rattrapage nocturne).
 */
export async function GET(req: NextRequest) {
  const file = new URL(req.url).searchParams.get('file');
  if (!file) return Response.json({ error: 'Paramètre `file` manquant' }, { status: 400 });

  if (!isGithubConfigured()) {
    return Response.json({ state: 'pending', configured: false });
  }

  const manifest = await fetchIngestManifest();
  const entry = manifest?.[file];
  if (entry) {
    return Response.json({ state: 'ingested', slug: entry.slug });
  }

  const active = await hasActiveIngestRun();
  return Response.json({ state: active ? 'processing' : 'pending', configured: true });
}
