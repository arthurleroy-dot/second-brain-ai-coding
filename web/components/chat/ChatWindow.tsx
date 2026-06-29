'use client';

import { useEffect, useRef, useState } from 'react';
import { Message as MessageType } from '@/types';
import Message from '@/components/chat/Message';
import InputBar from '@/components/chat/InputBar';
import RightPanel from '@/components/chat/RightPanel';
import ConversationHistory from '@/components/chat/ConversationHistory';

interface Props {
  conversationId: string | null;
  initialMessages?: MessageType[];
}

let localIdCounter = 0;
function localId(): string {
  localIdCounter += 1;
  return `local-${localIdCounter}`;
}

export default function ChatWindow({ conversationId, initialMessages = [] }: Props) {
  const [messages, setMessages] = useState<MessageType[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const toggleFolder = (folder: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const handleSend = async (text: string) => {
    const userMsg: MessageType = {
      id: localId(),
      role: 'user',
      content: text,
      sources: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const firstFolder = [...selectedFolders][0];
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          filters: firstFolder ? { type: firstFolder } : undefined,
        }),
      });
      const data = await res.json();
      const assistantMsg: MessageType = {
        id: localId(),
        role: 'assistant',
        content: res.ok ? data.text : `⚠️ ${data.error ?? 'Erreur inconnue'}`,
        sources: res.ok ? data.sources ?? [] : [],
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: localId(),
          role: 'assistant',
          content: '⚠️ Erreur réseau pendant la requête.',
          sources: [],
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
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

        <InputBar onSend={handleSend} disabled={loading} />
      </div>

      <RightPanel selectedFolders={selectedFolders} onToggleFolder={toggleFolder} />
    </div>
  );
}
