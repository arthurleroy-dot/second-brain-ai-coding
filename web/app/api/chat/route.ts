import { NextRequest } from 'next/server';
import { anthropic, CLAUDE_MODEL, isClaudeConfigured } from '@/lib/claude';
import {
  describeChatFilters,
  getRelevantContext,
  parseResponse,
  listSources,
} from '@/lib/wiki-query';
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

  // 1. Historique complet de la conversation (ordre chronologique, sans limite)
  const history = conversation_id
    ? await getConversationHistory(conversation_id)
    : [];

  // Texte de détection d'entités : intégralité de la conversation (historique +
  // message courant) concaténée, et non seulement le dernier message.
  const conversationText = [...history.map((m) => m.content), message].join(
    '\n',
  );

  // 2. Contexte wiki pertinent (Supabase, source de vérité unique)
  const { context: wikiContext } = await getRelevantContext(
    message,
    filters,
    conversationText,
  );

  // 3. System prompt
  const filterDesc = describeChatFilters(filters);
  const filterBlock = filterDesc
    ? `\nFILTRES ACTIFS : ${filterDesc}.
Le contenu ci-dessus a DÉJÀ été restreint à ces filtres. Tu dois répondre
UNIQUEMENT à partir de ce contenu. N'évoque, ne cite et ne prends en compte
AUCUNE ressource qui ne respecte pas ces filtres, même si tu en as connaissance.
`
    : '';

  const systemPrompt = `Tu es un assistant qui répond aux questions sur une base de connaissances sur l'AI Coding.

Voici le contenu pertinent de la base pour cette question :
${wikiContext || '(aucun contenu pertinent trouvé)'}
${filterBlock}
RÈGLES DE RÉPONSE :
- Cite toujours tes sources avec le format JSON suivant à la TOUTE FIN de ta réponse, sur une ligne dédiée :
  SOURCES: [{"slug":"...", "title":"...", "type":"...", "author":"...", "date":"..."}]
- N'inclus dans SOURCES que des ressources réellement présentes dans le contenu ci-dessus.
- Si tu ne trouves pas d'information pertinente, dis-le clairement et renvoie SOURCES: []
- Réponds en français.
- Sois concis et factuel.`;

  // 4. Messages envoyés à Claude : intégralité de l'historique en ordre
  // chronologique + message courant, sans aucune limite de nombre de messages.
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  // 5. Persistance IMMÉDIATE du message utilisateur, AVANT tout appel à Claude.
  // Indispensable avec le streaming : si le client quitte la page (navigation)
  // ou si le flux est interrompu/erroné, le `start()` du stream ci-dessous est
  // annulé et son code de persistance final ne s'exécute jamais. En sauvegardant
  // ici, la question survit toujours et l'historique se recharge correctement.
  await saveMessage(conversation_id ?? null, 'user', message, []);
  await renameConversationIfDefault(conversation_id ?? null, message);

  // 6. Appel Claude en streaming (via proxy LiteLLM).
  // On diffuse le texte au fur et à mesure ; le bloc `SOURCES: [...]` final est
  // retiré du flux pendant le streaming et n'est parsé qu'une fois terminé.
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Émission tolérante à la déconnexion : si le client a quitté la page
      // pendant le streaming, `enqueue` lève une erreur. On la capture pour ne
      // PAS interrompre la boucle de consommation du flux Claude : on continue
      // jusqu'au bout afin que `saveMessage('assistant')` s'exécute et que la
      // conversation reste complète en base (le message user est déjà persisté).
      let clientGone = false;
      const send = (obj: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          clientGone = true;
        }
      };

      let rawText = '';
      let emittedLen = 0;
      let finalized = false;

      // Parse + hydrate les sources + persiste le message assistant, puis émet
      // l'événement `done`. Idempotent (flag `finalized`) et appelable aussi bien
      // à la fin normale du flux QUE dans le `catch` : le proxy LiteLLM termine
      // parfois le SSE en « Premature close » alors que tout le texte a déjà été
      // reçu — dans ce cas on persiste quand même la réponse complète au lieu de
      // la perdre. Ne fait rien si aucun texte n'a été reçu (vraie erreur amont).
      const finalize = async (): Promise<boolean> => {
        if (finalized) return true;
        if (!rawText.trim()) return false;
        finalized = true;

        const { text, sources: citedSources } = parseResponse(rawText);

        // Hydrate les sources citées avec les vraies métadonnées (id, url,
        // topics…) en faisant correspondre par slug (puis par titre en repli).
        const allSources = await listSources();
        const sources = citedSources.map((c) => {
          const match =
            allSources.find((s) => s.slug === c.slug) ||
            allSources.find(
              (s) => s.title.toLowerCase() === (c.title ?? '').toLowerCase(),
            );
          return match ?? c;
        });

        // Persistance du message assistant (le message utilisateur a déjà été
        // persisté avant le streaming, étape 5).
        await saveMessage(conversation_id ?? null, 'assistant', text, sources);

        // Événement final : texte propre canonique + sources hydratées.
        send({ type: 'done', text, sources });
        return true;
      };

      try {
        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
          system: systemPrompt,
          messages: messages as any,
        });

        for await (const event of claudeStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            rawText += event.delta.text;
            // Ne diffuse que la portion sûre (avant un éventuel marqueur SOURCES,
            // y compris un préfixe partiel en fin de buffer).
            const safe = emittableLength(rawText);
            if (safe > emittedLen) {
              send({ type: 'delta', text: rawText.slice(emittedLen, safe) });
              emittedLen = safe;
            }
          }
        }

        // 7. Stream terminé proprement → finalise (persiste + done).
        await finalize();
      } catch (e: any) {
        // Le flux a levé une exception (souvent « Premature close » du proxy en
        // fin de génération). Si du texte a déjà été reçu, on le persiste malgré
        // l'erreur ; sinon, on remonte l'erreur au client.
        const recovered = await finalize().catch(() => false);
        if (!recovered) {
          send({
            type: 'error',
            error: `Erreur API Claude : ${e?.message ?? 'inconnue'}`,
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // déjà fermé (client déconnecté) : rien à faire
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

/**
 * Longueur de `full` que l'on peut diffuser sans risquer d'exposer le marqueur
 * `SOURCES:` (ou un préfixe partiel arrivé en fin de chunk).
 */
function emittableLength(full: string): number {
  const idx = full.search(/SOURCES\s*:/i);
  if (idx !== -1) return idx;

  // Le marqueur peut être coupé entre deux chunks : on retient la fin du buffer
  // si elle correspond à un préfixe de « SOURCES: ».
  const marker = 'SOURCES:';
  const maxHold = Math.min(marker.length - 1, full.length);
  for (let hold = maxHold; hold > 0; hold--) {
    const tail = full.slice(full.length - hold).toUpperCase();
    if (marker.startsWith(tail)) return full.length - hold;
  }
  return full.length;
}
