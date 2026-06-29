import Anthropic from '@anthropic-ai/sdk';

// La clé est une clé LiteLLM ; on pointe le client vers le proxy via baseURL.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
