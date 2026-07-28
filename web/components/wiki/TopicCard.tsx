'use client';

import { useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';
import { WikiTopic } from '@/types';
import { typeLabel, typeBadgeClass } from '@/lib/ui';
import DeleteThemeModal from '@/components/wiki/DeleteThemeModal';

export default function TopicCard({
  topic,
  onDeleted,
}: {
  topic: WikiTopic;
  onDeleted?: (slug: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Compte par type PRÉSENT dans les sources du thème (slugs distincts), tri par
  // fréquence desc puis libellé — plus de liste figée.
  const counts = Array.from(new Set(topic.sources.map((s) => s.type)))
    .map((t) => ({ type: t, n: topic.sources.filter((s) => s.type === t).length }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n || typeLabel(a.type).localeCompare(typeLabel(b.type)));

  return (
    <div className="group relative">
      <a
        href={`/wiki/${topic.slug}`}
        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 pr-10 hover:border-gray-300 hover:shadow-sm"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">{topic.title}</h3>
        </div>
        <p className="text-xs text-gray-500">{topic.source_count} source(s)</p>
        <div className="flex flex-wrap gap-1">
          {counts.map((c) => (
            <span
              key={c.type}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeClass(c.type)}`}
            >
              {typeLabel(c.type)} × {c.n}
            </span>
          ))}
        </div>
      </a>

      {/* Suppression du thème : bouton SIBLING du <a> (hors navigation), révélé au survol. */}
      <button
        type="button"
        aria-label="Supprimer le thème"
        title="Supprimer le thème"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        className="absolute right-2 top-2 rounded-md p-1.5 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={15} />
      </button>

      {confirming && (
        <DeleteThemeModal
          slug={topic.slug}
          title={topic.title}
          sourceCount={topic.source_count}
          onClose={() => setConfirming(false)}
          onDeleted={(slug) => onDeleted?.(slug)}
        />
      )}
    </div>
  );
}
