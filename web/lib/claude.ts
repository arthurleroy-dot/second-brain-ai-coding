import Anthropic from '@anthropic-ai/sdk';

// Accès IA via la gateway LiteLLM de l'entreprise (décision D2 amendée 2026-07-20 :
// clé de gateway partagée par les employés, PAS de clé Anthropic personnelle).
// - `apiKey`  : clé de la gateway. En dev, lue depuis web/.env.local ; dans l'app
//               Electron, injectée à l'exécution dans process.env depuis le stockage
//               chiffré (safeStorage) via l'écran de réglages (Phase 6).
// - `baseURL` : URL de la gateway (conservée — on n'appelle pas Anthropic en direct).
// Le SDK web (chat, lecture seule) s'authentifie en `x-api-key` ; c'est suffisant
// pour la gateway (cf. tasks/lessons.md 2026-07-09 — le token Bearer n'est requis
// que pour le CLI/SDK Agent de l'ingestion).
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});

// Modèle piloté par le réglage « modèle » de l'app (injecté dans l'env) ; défaut
// raisonnable routé par la gateway.
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
