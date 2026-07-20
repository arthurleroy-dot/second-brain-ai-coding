'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Message as MessageType } from '@/types';
import Message from '@/components/chat/Message';
import InputBar from '@/components/chat/InputBar';
import ConversationHistory from '@/components/chat/ConversationHistory';
import StepTrail from '@/components/chat/StepTrail';
import {
  subscribe,
  getState,
  seedIfAbsent,
  hydrateFromDb,
  sendMessage,
  abortMessage,
  getEphemeralKey,
} from '@/lib/chat-stream-store';
import { setActiveConversationId } from '@/lib/active-conversation';

interface Props {
  conversationId: string | null;
  initialMessages?: MessageType[];
}

export default function ChatWindow({ conversationId, initialMessages = [] }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // « Collé en bas » : l'auto-scroll ne s'applique que si l'utilisateur est déjà
  // en bas (seuil 80px). Ref et non state : mis à jour à chaque événement scroll,
  // aucun rendu n'en dépend.
  const pinnedRef = useRef(true);

  // `adoptedId` : quand on part d'un `/chat` éphémère et qu'on crée la conversation
  // au premier message, on « adopte » l'uuid ici pour re-lier CETTE fenêtre (déjà
  // montée) à la clé de store uuid — sans démontage, donc sans flash ni perte du
  // flux en cours. Seedé depuis `conversationId` (déjà connu sur /chat/[id]).
  const [adoptedId, setAdoptedId] = useState<string | null>(conversationId);
  // Empêche un double-envoi pendant l'aller-retour de création (avant que
  // `loading` du store ne passe à vrai).
  const [sending, setSending] = useState(false);

  // Clé de store : l'id de la conversation persistée (adopté ou fourni), ou la clé
  // éphémère stable (module-level) pour le chat /chat sans id (non persisté).
  const storeKey = adoptedId ?? conversationId ?? getEphemeralKey();

  // S'abonne au store global : l'état (messages + flux) survit à la navigation
  // et continue d'être alimenté en arrière-plan même quand ce composant est
  // démonté. `getServerSnapshot` renvoie `undefined` → côté serveur et à
  // l'hydratation on rend `initialMessages` (pas de mismatch d'hydratation).
  const state = useSyncExternalStore(
    subscribe,
    () => getState(storeKey),
    () => undefined,
  );
  const messages = state?.messages ?? initialMessages;
  const loading = state?.loading ?? false;
  const streaming = state?.streaming ?? false;
  const steps = state?.steps ?? [];

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight });
  }, [messages, loading, steps.length]);

  // Au montage : on initialise le store depuis le SSR, puis on recharge l'état
  // réel depuis Supabase pour une conversation persistée. `hydrateFromDb`
  // n'écrase JAMAIS un flux en cours (cf. store) : si on revient pendant une
  // génération, on garde l'état live et on voit la réponse continuer.
  useEffect(() => {
    seedIfAbsent(storeKey, initialMessages);
    if (!conversationId) return; // chat éphémère : rien à recharger
    let cancelled = false;
    fetch(`/api/conversations/${conversationId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.conversation) {
          hydrateFromDb(storeKey, d.conversation.messages ?? []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // initialMessages volontairement hors deps : seul un changement de
    // conversation doit redéclencher le rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, storeKey]);

  // Mémorise la conversation courante comme « active » (cookie) dès que la
  // fenêtre est liée à un uuid réel : au retour « au chat », le serveur y
  // redirige au lieu de retomber sur un chat vide.
  useEffect(() => {
    const id = adoptedId ?? conversationId;
    if (id) setActiveConversationId(id);
  }, [adoptedId, conversationId]);

  const handleSend = async (text: string) => {
    // Envoyer un message recolle la vue en bas pour suivre la nouvelle réponse.
    pinnedRef.current = true;
    // Délégué au store : le streaming vit hors du composant et continue même si
    // on quitte la page.
    const existing = adoptedId ?? conversationId;
    if (existing) {
      void sendMessage(existing, existing, text, undefined);
      return;
    }

    // Chat éphémère (pas encore d'id) : on crée la conversation puis on l'adopte,
    // afin de persister dès le premier message ET de faire survivre le flux à la
    // navigation (clé de store = uuid stable).
    setSending(true);
    try {
      const res = await fetch('/api/conversations', { method: 'POST' });
      const data = await res.json().catch(() => null);
      const newId: string | null = data?.conversation?.id ?? null;
      if (!newId) {
        // Supabase indisponible → on reste sur le chat éphémère (non persisté) ;
        // la clé étant stable, l'état survit tout de même à la navigation interne.
        void sendMessage(getEphemeralKey(), null, text, undefined);
        return;
      }
      setActiveConversationId(newId);
      void sendMessage(newId, newId, text, undefined); // stream sous la clé uuid
      setAdoptedId(newId); // re-lie cette fenêtre à l'uuid, sans démontage
      window.history.replaceState(null, '', `/chat/${newId}`); // URL only (Next 14.2)
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <ConversationHistory currentId={adoptedId ?? conversationId} />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-6"
      >
        {messages.length === 0 && (
          <div className="mx-auto mt-16 max-w-md text-center text-sm text-gray-400">
            Pose une question sur le wiki AI Coding — par exemple
            «&nbsp;Que dit McKinsey sur le FinOps&nbsp;?&nbsp;» ou
            «&nbsp;Résume les tendances de l’agentic coding&nbsp;».
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {(loading || (streaming && steps.length > 0)) && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400">
              {steps.length === 0 ? 'Recherche dans le wiki…' : <StepTrail steps={steps} />}
            </div>
          </div>
        )}
      </div>

      <InputBar
        onSend={handleSend}
        onStop={() => abortMessage(storeKey)}
        isGenerating={loading || streaming}
        disabled={sending}
      />
    </div>
  );
}
