'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatFilterState, Message as MessageType } from '@/types';
import Message from '@/components/chat/Message';
import InputBar from '@/components/chat/InputBar';
import RightPanel from '@/components/chat/RightPanel';
import ConversationHistory from '@/components/chat/ConversationHistory';
import {
  subscribe,
  getState,
  seedIfAbsent,
  hydrateFromDb,
  sendMessage,
} from '@/lib/chat-stream-store';

interface Props {
  conversationId: string | null;
  initialMessages?: MessageType[];
}

export default function ChatWindow({ conversationId, initialMessages = [] }: Props) {
  const [filters, setFilters] = useState<ChatFilterState>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Clé de store : l'id de la conversation persistée, ou une clé éphémère stable
  // (par montage) pour le chat /chat sans id (non persisté).
  const ephemeralKeyRef = useRef<string>('');
  if (!ephemeralKeyRef.current) {
    ephemeralKeyRef.current =
      conversationId ?? `ephemeral-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const storeKey = conversationId ?? ephemeralKeyRef.current;

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

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

  const handleSend = (text: string) => {
    // Délégué au store : le streaming vit hors du composant et continue même si
    // on quitte la page.
    const hasFilters =
      (filters.types?.length ?? 0) > 0 ||
      (filters.authors?.length ?? 0) > 0 ||
      !!filters.date;
    void sendMessage(storeKey, conversationId, text, hasFilters ? filters : undefined);
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
          <ConversationHistory currentId={conversationId} />
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
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
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400">
                Recherche dans le wiki…
              </div>
            </div>
          )}
        </div>

        <InputBar onSend={handleSend} disabled={loading || streaming} />
      </div>

      <RightPanel filters={filters} onChange={setFilters} />
    </div>
  );
}
