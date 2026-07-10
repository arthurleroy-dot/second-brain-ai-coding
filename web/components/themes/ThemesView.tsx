'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Layers } from 'lucide-react';
import { ThemeCandidate, ThemeEntry } from '@/types';
import ThemeCandidateCard from './ThemeCandidateCard';

/**
 * Gestion des thèmes. Miroir de EntitiesView : « en attente de décision »
 * (thèmes candidats) au-dessus, registre de tous les thèmes en dessous.
 */
export default function ThemesView() {
  const [candidates, setCandidates] = useState<ThemeCandidate[]>([]);
  const [themes, setThemes] = useState<ThemeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/theme-candidates').then((r) => r.json()),
      fetch('/api/themes').then((r) => r.json()),
    ])
      .then(([c, t]) => {
        if (cancelled) return;
        setCandidates(c.candidates ?? []);
        setThemes(t.themes ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = candidates.filter((c) => c.status === 'pending');

  if (loading) return <div className="p-6 text-sm text-gray-400">Chargement…</div>;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* En attente de décision */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Clock size={16} className="text-gray-400" /> En attente de décision
          <span className="text-xs font-normal text-gray-400">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400">
            Aucun thème en attente — tout est arbitré.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pending.map((c) => (
              <ThemeCandidateCard key={c.normalized} candidate={c} themes={themes} />
            ))}
          </div>
        )}
      </section>

      {/* Registre des thèmes */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Layers size={16} className="text-gray-400" /> Registre
          <span className="text-xs font-normal text-gray-400">{themes.length}</span>
        </h2>
        {themes.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun thème dans le registre.</p>
        ) : (
          <div className="space-y-1.5">
            {themes.map((t) => (
              <Link
                key={t.slug}
                href={`/wiki/${t.slug}`}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 hover:border-gray-300"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                  {t.label}
                </span>
                {t.aliases.length > 0 && (
                  <span className="shrink-0 text-xs text-gray-400">
                    {t.aliases.length} alias
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
