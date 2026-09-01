import Anthropic from '@anthropic-ai/sdk';
import { getAiSettings, ANTHROPIC_DIRECT_URL } from '@/lib/ai-settings';

// Accès IA reconstruit À L'EXÉCUTION depuis le store de réglages (`@/lib/ai-settings`),
// plus au chargement du module : la saisie de l'écran `/reglages` prend donc effet à
// chaud, sans redémarrer le serveur. Le client SDK est mémorisé par signature (clé+URL)
// pour n'être reconstruit que lorsque l'un des deux change.
//
// L'app ne parle QUE le protocole « Messages » d'Anthropic (auth `x-api-key`) : soit
// Anthropic en direct, soit une passerelle compatible (gateway LiteLLM). Le triplet
// clé/adresse/modèle vient de getAiSettings() (store prime, env = secours dev).

let cached: { sig: string; client: Anthropic } | null = null;

export function getAnthropic(): Anthropic {
  const { apiKey, baseUrl } = getAiSettings();
  const sig = `${apiKey} ${baseUrl}`; // reconstruit seulement si clé/URL change
  if (!cached || cached.sig !== sig) {
    // baseURL TOUJOURS explicite : sinon le SDK relit process.env.ANTHROPIC_BASE_URL
    // (client.js:68) et la gateway du .env.local fuite dans le preset « Anthropic direct ».
    // apiKey toujours passé (même '') → l'env ne peut pas le shadow (client.js:75).
    cached = {
      sig,
      client: new Anthropic({ apiKey, baseURL: baseUrl || ANTHROPIC_DIRECT_URL }),
    };
  }
  return cached.client;
}

export function getModel(): string {
  return getAiSettings().model;
}

/** Modèle de la passe vision (défaut Haiku) — cf. ai-settings.visionModel. */
export function getVisionModel(): string {
  return getAiSettings().visionModel;
}

export function isClaudeConfigured(): boolean {
  return Boolean(getAiSettings().apiKey);
}
