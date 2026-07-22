import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAiSettings, ANTHROPIC_DIRECT_URL } from '@/lib/ai-settings';

export const dynamic = 'force-dynamic';

// POST { apiKey?, baseUrl, model } : teste un triplet SANS l'enregistrer, avec un
// client jetable. La clé peut être omise → on retombe sur la clé déjà en store (permet
// de tester une config enregistrée sans re-saisir le secret). baseUrl/model viennent du
// formulaire (toujours visibles). Appel minimal `messages.create max_tokens:1` : exerce
// le VRAI protocole Messages d'Anthropic et valide auth + résolution du modèle.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, status: 400, message: 'Corps JSON invalide' }, { status: 200 });
  }
  const b = (body ?? {}) as { apiKey?: unknown; baseUrl?: unknown; model?: unknown };

  const store = getAiSettings();
  const apiKey =
    (typeof b.apiKey === 'string' && b.apiKey.trim()) || store.apiKey;
  const baseUrl =
    (typeof b.baseUrl === 'string' ? b.baseUrl : '').trim() || ANTHROPIC_DIRECT_URL;
  const model =
    (typeof b.model === 'string' && b.model.trim()) || store.model;

  if (!apiKey) {
    return Response.json(
      { ok: false, status: 0, message: 'Aucune clé à tester (saisis une clé ou enregistre-en une).' },
      { status: 200 },
    );
  }

  const client = new Anthropic({ apiKey, baseURL: baseUrl });
  try {
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return Response.json({ ok: true });
  } catch (err: unknown) {
    const status =
      err instanceof Anthropic.APIError && typeof err.status === 'number' ? err.status : 0;
    let message: string;
    if (status === 401 || status === 403) {
      message = 'Clé invalide ou refusée par le service.';
    } else if (status === 429) {
      message = 'Quota/budget dépassé.';
    } else if (status === 404) {
      message =
        "Modèle inconnu ou adresse incorrecte (l'adresse n'expose peut-être pas l'API Messages d'Anthropic).";
    } else {
      const raw = err instanceof Error && err.message ? err.message : 'Échec de la connexion au service IA.';
      message = status ? `${raw} (statut ${status})` : raw;
    }
    return Response.json({ ok: false, status, message }, { status: 200 });
  }
}
