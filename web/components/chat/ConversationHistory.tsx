'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Plus, X, Trash2 } from 'lucide-react';
import { Conversation } from '@/types';
import { clearActiveConversationId } from '@/lib/active-conversation';
import { resetEphemeralKey } from '@/lib/chat-stream-store';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function ConversationHistory({
  currentId,
}: {
  currentId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((d) => setConversations(d.conversations ?? []))
      .catch(() => {});
  }, [open]);

  const newConversation = () => {
    // Repart à neuf : on oublie la conversation active et on repurge la clé
    // éphémère, puis on va sur /chat vierge. La conversation n'est créée qu'au
    // premier message (création lazy dans ChatWindow) — pas de conversation vide
    // dans l'historique.
    clearActiveConversationId();
    resetEphemeralKey();
    router.push('/chat');
  };

  // Suppression d'un élément : retrait optimiste + rollback si l'API échoue. Si
  // on supprime la conversation affichée, on quitte le fil disparu.
  async function deleteOne(id: string) {
    const prev = conversations;
    setConversations((cs) => cs.filter((c) => c.id !== id)); // optimiste
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      if (id === currentId) {
        clearActiveConversationId();
        resetEphemeralKey();
        router.push('/chat'); // on ne reste pas sur une conversation supprimée
      }
    } catch {
      setConversations(prev); // rollback si l'API échoue
    }
  }

  async function clearAll() {
    setConfirmClear(false);
    const prev = conversations;
    setConversations([]); // optimiste
    try {
      const res = await fetch('/api/conversations', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      clearActiveConversationId();
      resetEphemeralKey();
      router.push('/chat');
    } catch {
      setConversations(prev);
    }
  }

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
              Aucune conversation enregistrée pour le moment.
            </p>
          ) : (
            <>
              <ul className="max-h-80 space-y-0.5 overflow-y-auto">
                {conversations.map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.push(`/chat/${c.id}`);
                      }}
                      className={`flex w-full flex-col rounded-lg px-2 py-1.5 pr-8 text-left hover:bg-gray-100 ${
                        c.id === currentId ? 'bg-gray-100' : ''
                      }`}
                    >
                      <span className="truncate text-xs font-medium text-gray-800">{c.title}</span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(c.updated_at).toLocaleDateString('fr-FR')}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Supprimer la conversation"
                      title="Supprimer la conversation"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteOne(c.id);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-1 border-t border-gray-100 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={13} /> Tout effacer
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Tout effacer"
          message="Supprimer définitivement toutes les conversations ? Cette action est irréversible."
          confirmLabel="Tout effacer"
          onConfirm={clearAll}
          onCancel={() => setConfirmClear(false)}
          danger
        />
      )}
    </div>
  );
}
