'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, Calendar, AlertTriangle, Layers } from 'lucide-react';
import { AuthorEntry, DateEntry, TypeEntry } from '@/types';
import { typeBadgeClass } from '@/lib/ui';

export default function ExploreView() {
  const router = useRouter();
  const [authors, setAuthors] = useState<AuthorEntry[]>([]);
  const [dates, setDates] = useState<DateEntry[]>([]);
  const [types, setTypes] = useState<TypeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/explore')
      .then((r) => r.json())
      .then((d) => {
        setAuthors(d.authors ?? []);
        setDates(d.dates ?? []);
        setTypes(d.types ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Regroupe les dates par année pour l'affichage
  const years = Array.from(new Set(dates.map((d) => d.year))).sort((a, b) =>
    b.localeCompare(a),
  );

  if (loading) return <div className="p-6 text-sm text-gray-400">Chargement…</div>;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Par type de ressource */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Layers size={16} className="text-gray-400" /> Par type de ressource
        </h2>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => router.push(`/sources?type=${encodeURIComponent(t.folder)}`)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-gray-300"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(t.type)}`}
              >
                {t.label}
              </span>
              <span className="text-xs text-gray-400">{t.source_count}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Par auteur */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <User size={16} className="text-gray-400" /> Par auteur
          </h2>
          <div className="space-y-1.5">
            {authors.map((a) => (
              <button
                key={a.slug}
                type="button"
                onClick={() => router.push(`/sources?author=${encodeURIComponent(a.name)}`)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-gray-300"
              >
                <span className={a.slug === 'unknown' ? 'text-orange-700' : 'text-gray-800'}>
                  {a.name}
                </span>
                <span className="text-xs text-gray-400">{a.source_count}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Par date */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Calendar size={16} className="text-gray-400" /> Par date
          </h2>
          <div className="space-y-4">
            {years.map((year) => (
              <div key={year}>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                  {year === 'unknown' ? 'Date inconnue' : year}
                </h3>
                <div className="space-y-1.5">
                  {dates
                    .filter((d) => d.year === year)
                    .map((d) => (
                      <button
                        key={`${d.year}-${d.month ?? 'u'}`}
                        type="button"
                        onClick={() =>
                          d.month
                            ? router.push(`/sources?date=${d.month}`)
                            : router.push('/sources?filter=needs_review')
                        }
                        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-gray-300"
                      >
                        <span className={`flex items-center gap-1.5 ${d.is_unknown ? 'text-orange-700' : 'text-gray-800'}`}>
                          {d.is_unknown && <AlertTriangle size={12} />}
                          {d.label}
                        </span>
                        <span className="text-xs text-gray-400">{d.source_count}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
