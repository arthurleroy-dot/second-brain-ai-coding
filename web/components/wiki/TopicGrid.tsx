'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { WikiTopic } from '@/types';
import TopicCard from '@/components/wiki/TopicCard';

export default function TopicGrid() {
  const [topics, setTopics] = useState<WikiTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/wiki')
      .then((r) => r.json())
      .then((d) => setTopics(d.topics ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const createTopic = async () => {
    setError(null);
    const res = await fetch('/api/wiki', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (res.ok) {
      setModalOpen(false);
      setTitle('');
      load();
    } else {
      setError(data.error ?? 'Échec de la création');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-gray-500">{topics.length} thème(s)</p>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
        >
          <Plus size={14} /> Nouveau thème
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((t) => (
            <TopicCard key={t.slug} topic={t} />
          ))}
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Nouveau thème</h3>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nom du thème (ex: Tests automatisés)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-400"
              autoFocus
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <p className="mt-2 text-[11px] text-gray-400">
              Crée une ébauche dans by-topic/. L’enrichissement sera fait par l’agent mainteneur.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={createTopic}
                disabled={!title.trim()}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
