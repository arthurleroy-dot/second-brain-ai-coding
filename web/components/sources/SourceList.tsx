'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Source } from '@/types';
import { TYPE_TO_FOLDER } from '@/lib/ui';
import { ResourceType } from '@/types';
import SourceRow from '@/components/sources/SourceRow';
import FilterBar from '@/components/sources/FilterBar';

export default function SourceList() {
  const params = useSearchParams();
  const [all, setAll] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => setAll(d.sources ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const type = params.get('type');
  const author = params.get('author');
  const date = params.get('date');
  const filter = params.get('filter');
  const topic = params.get('topic');

  const filtered = useMemo(() => {
    return all.filter((s) => {
      if (type && TYPE_TO_FOLDER[s.type as ResourceType] !== type && s.type !== type)
        return false;
      if (author && s.author !== author) return false;
      if (date && !(s.date ?? '').startsWith(date)) return false;
      if (topic && !s.topics.includes(topic)) return false;
      if (filter === 'needs_review' && !s.needs_review) return false;
      return true;
    });
  }, [all, type, author, date, topic, filter]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-gray-200 bg-white px-6 py-3">
        <FilterBar sources={all} />
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-gray-400">Chargement…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400">Aucune source ne correspond aux filtres.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-gray-500">{filtered.length} source(s)</p>
            <div className="space-y-2">
              {filtered.map((s) => (
                <SourceRow key={s.id ?? s.slug} source={s} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
