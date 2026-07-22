import { NextRequest } from 'next/server';
import { getSafeAiSettings, saveAiSettings } from '@/lib/ai-settings';

export const dynamic = 'force-dynamic';

// GET : forme SÛRE des réglages (jamais la clé en clair).
export async function GET() {
  return Response.json(getSafeAiSettings());
}

// POST : enregistre { apiKey?, baseUrl, model }. apiKey absent/vide → conserve la clé
// déjà en store (cf. saveAiSettings). Renvoie la forme sûre à jour — JAMAIS la clé.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  const b = (body ?? {}) as { apiKey?: unknown; baseUrl?: unknown; model?: unknown };
  await saveAiSettings({
    apiKey: typeof b.apiKey === 'string' ? b.apiKey : undefined,
    baseUrl: typeof b.baseUrl === 'string' ? b.baseUrl : '',
    model: typeof b.model === 'string' ? b.model : '',
  });
  return Response.json(getSafeAiSettings());
}
