'use client';

import { useEffect, useState } from 'react';
import { WikiTopic } from '@/types';
import TopicCard from '@/components/wiki/TopicCard';

export default function TopicGrid() {
  const [topics, setTopics] = useState<WikiTopic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/wiki')
      .then((r) => r.json())
      .then((d) => setTopics(d.topics ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4">
        <p className="text-xs text-gray-500">{topics.length} thème(s)</p>
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
    </div>
  );
}
