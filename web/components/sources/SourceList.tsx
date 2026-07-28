'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Source } from '@/types';
import { setSourcesQuery } from '@/lib/sources-nav-store';
import { useScrollRestoration } from '@/lib/use-scroll-restoration';
import SourceRow from '@/components/sources/SourceRow';
import FilterBar from '@/components/sources/FilterBar';

export default function SourceList() {
  const params = useSearchParams();
  const [all, setAll] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  // Conserve la position de défilement de la liste au va-et-vient de navigation.
  const scrollRef = useScrollRestoration<HTMLDivElement>('sources:scroll');

  useEffect(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => setAll(d.sources ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Mémorise la query courante pour que le lien « Sources » de la barre latérale
  // (vers /sources nu) restaure les filtres au retour. L'URL reste la seule source.
  const qs = params.toString();
  useEffect(() => {
    setSourcesQuery(qs);
  }, [qs]);

  const type = params.get('type');
  const author = params.get('author');
  const origin = params.get('origin');
  const date = params.get('date');
  const topic = params.get('topic');
  const entityParam = params.get('entity') ?? '';

  const filtered = useMemo(() => {
    const entities = entityParam.split(',').filter(Boolean);
    return all.filter((s) => {
      // La valeur du filtre `type` est désormais le slug kebab = `s.type`.
      if (type && s.type !== type) return false;
      if (author && s.author !== author) return false;
      if (origin && s.origin !== origin) return false;
      if (date && !(s.date ?? '').startsWith(date)) return false;
      if (topic && !s.topics.includes(topic)) return false;
      if (entities.length && !entities.every((e) => s.entities?.includes(e))) return false;
      return true;
    });
  }, [all, type, author, origin, date, topic, entityParam]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-gray-200 bg-white px-6 py-3">
        <FilterBar sources={all} />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-gray-400">Chargement…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400">Aucune source ne correspond aux filtres.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-gray-500">{filtered.length} source(s)</p>
            <div className="space-y-2">
              {filtered.map((s) => (
                <SourceRow
                  key={s.slug}
                  source={s}
                  onDeleted={(slug) => setAll((prev) => prev.filter((x) => x.slug !== slug))}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
