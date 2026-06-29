'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Plus } from 'lucide-react';
import { Conversation } from '@/types';

export default function ConversationHistory({
  currentId,
}: {
  currentId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations ?? []))
      .catch(() => {});
  }, [open]);

  const newConversation = async () => {
    const res = await fetch('/api/conversations', { method: 'POST' });
    const data = await res.json();
    if (data?.conversation?.id) {
      router.push(`/chat/${data.conversation.id}`);
    } else {
      // Supabase non configuré : on reste sur un chat éphémère.
      setEnabled(false);
      router.push('/chat');
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
      >
        <History size={14} />
        Historique
      </button>
      <button
        type="button"
        onClick={newConversation}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
      >
        <Plus size={14} />
        Nouvelle discussion
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-40 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-400">
              {enabled
                ? 'Aucune conversation enregistrée (Supabase requis pour l’historique).'
                : 'Historique indisponible.'}
            </p>
          ) : (
            <ul className="max-h-80 space-y-0.5 overflow-y-auto">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(`/chat/${c.id}`);
                    }}
                    className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-gray-100 ${
                      c.id === currentId ? 'bg-gray-100' : ''
                    }`}
                  >
                    <span className="truncate text-xs font-medium text-gray-800">{c.title}</span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(c.updated_at).toLocaleDateString('fr-FR')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
