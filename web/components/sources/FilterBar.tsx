'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Source } from '@/types';
import { ALL_TYPES, TYPE_TO_FOLDER, typeLabel } from '@/lib/ui';

export default function FilterBar({ sources }: { sources: Source[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const authors = Array.from(
    new Set(sources.map((s) => s.author).filter(Boolean) as string[]),
  ).sort();
  const dates = Array.from(
    new Set(sources.map((s) => (s.date ? s.date.slice(0, 7) : null)).filter(Boolean) as string[]),
  ).sort((a, b) => b.localeCompare(a));

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/sources?${next.toString()}`);
  };

  const selectClass =
    'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectClass}
        value={params.get('type') ?? ''}
        onChange={(e) => setParam('type', e.target.value)}
      >
        <option value="">Tous les types</option>
        {ALL_TYPES.map((t) => (
          <option key={t} value={TYPE_TO_FOLDER[t]}>
            {typeLabel(t)}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('author') ?? ''}
        onChange={(e) => setParam('author', e.target.value)}
      >
        <option value="">Tous les auteurs</option>
        {authors.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('date') ?? ''}
        onChange={(e) => setParam('date', e.target.value)}
      >
        <option value="">Toutes les dates</option>
        {dates.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      {params.get('filter') === 'needs_review' && (
        <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
          Filtre : à vérifier
        </span>
      )}

      {(params.toString() !== '') && (
        <button
          type="button"
          onClick={() => router.push('/sources')}
          className="text-xs text-gray-500 underline hover:text-gray-700"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
