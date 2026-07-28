'use client';

import { useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';
import { WikiTopic, ResourceType } from '@/types';
import { ALL_TYPES, typeLabel, typeBadgeClass } from '@/lib/ui';
import DeleteThemeModal from '@/components/wiki/DeleteThemeModal';

export default function TopicCard({
  topic,
  onDeleted,
}: {
  topic: WikiTopic;
  onDeleted?: (slug: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const counts = ALL_TYPES.map((t) => ({
    type: t,
    n: topic.sources.filter((s) => s.type === t).length,
  })).filter((c) => c.n > 0);
  const empty = topic.source_count === 0;

  return (
    <div className="group relative">
      <a
        href={`/wiki/${topic.slug}`}
        className={`flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm ${
          empty ? 'pr-10' : ''
        }`}
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
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeClass(c.type as ResourceType)}`}
            >
              {typeLabel(c.type as ResourceType)} × {c.n}
            </span>
          ))}
        </div>
      </a>

      {/* Suppression d'un thème VIDE : bouton SIBLING du <a> (hors navigation), révélé au survol. */}
      {empty && (
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
      )}

      {confirming && (
        <DeleteThemeModal
          slug={topic.slug}
          title={topic.title}
          onClose={() => setConfirming(false)}
          onDeleted={(slug) => onDeleted?.(slug)}
        />
      )}
    </div>
  );
}
