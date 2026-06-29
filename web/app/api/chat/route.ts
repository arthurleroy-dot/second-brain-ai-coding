import { NextRequest } from 'next/server';
import { anthropic, CLAUDE_MODEL, isClaudeConfigured } from '@/lib/claude';
import { getRelevantContext, parseResponse, listSources } from '@/lib/wiki-query';
import {
  getConversationHistory,
  renameConversationIfDefault,
  saveMessage,
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { message, conversation_id, filters } = await req.json();

  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'Message manquant' }, { status: 400 });
  }

  if (!isClaudeConfigured()) {
    return Response.json(
      {
        error:
          "Clé API non configurée. Renseigne ANTHROPIC_API_KEY (et ANTHROPIC_BASE_URL) dans .env.local.",
      },
      { status: 503 },
    );
  }

  // 1. Contexte wiki pertinent (Supabase, source de vérité unique)
  const { context: wikiContext } = await getRelevantContext(message, filters);

  // 2. System prompt
  const systemPrompt = `Tu es un assistant qui répond aux questions sur une base de connaissances sur l'AI Coding.

Voici le contenu pertinent de la base pour cette question :
${wikiContext || '(aucun contenu pertinent trouvé)'}

RÈGLES DE RÉPONSE :
- Cite toujours tes sources avec le format JSON suivant à la TOUTE FIN de ta réponse, sur une ligne dédiée :
  SOURCES: [{"slug":"...", "title":"...", "type":"...", "author":"...", "date":"..."}]
- N'inclus dans SOURCES que des ressources réellement présentes dans le contenu ci-dessus.
- Si tu ne trouves pas d'information pertinente, dis-le clairement et renvoie SOURCES: []
- Réponds en français.
- Sois concis et factuel.`;

  // 3. Historique + message courant
  const history = conversation_id
    ? await getConversationHistory(conversation_id)
    : [];
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  // 4. Appel Claude (via proxy LiteLLM)
  let rawText = '';
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages as any,
    });
    rawText = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();
  } catch (e: any) {
    return Response.json(
      { error: `Erreur API Claude : ${e?.message ?? 'inconnue'}` },
      { status: 502 },
    );
  }

  // 5. Parse réponse → texte propre + sources
  const { text, sources: citedSources } = parseResponse(rawText);

  // Hydrate les sources citées avec les vraies métadonnées (id, url, topics…)
  // en faisant correspondre par slug (puis par titre en repli).
  const allSources = await listSources();
  const sources = citedSources.map((c) => {
    const match =
      allSources.find((s) => s.slug === c.slug) ||
      allSources.find(
        (s) => s.title.toLowerCase() === (c.title ?? '').toLowerCase(),
      );
    return match ?? c;
  });

  // 6. Persistance (dégradée si Supabase absent)
  await saveMessage(conversation_id ?? null, 'user', message, []);
  await saveMessage(conversation_id ?? null, 'assistant', text, sources);
  await renameConversationIfDefault(conversation_id ?? null, message);

  return Response.json({ text, sources });
}
