'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Source } from '@/types';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';
import DeleteSourceModal from '@/components/sources/DeleteSourceModal';

export default function SourceRow({
  source,
  onDeleted,
}: {
  source: Source;
  onDeleted?: (slug: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="group relative min-w-0">
      <Link href={`/sources/${source.slug}`} className="block min-w-0">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 pr-10 hover:border-gray-300">
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${typeBadgeClass(
              source.type,
            )}`}
          >
            {typeLabel(source.type)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900">{source.title}</div>
            <div className="text-xs text-gray-500">
              {source.author ?? 'auteur inconnu'} · {formatDate(source.date)}
              {source.topics.length > 0 && <> · {source.topics.join(', ')}</>}
            </div>
          </div>
          {source.url && (
            <ExternalLink
              size={14}
              className="shrink-0 text-gray-400"
              aria-label="Source externe disponible"
            />
          )}
        </div>
      </Link>

      {/* Suppression : bouton SIBLING du Link (hors navigation), révélé au survol. */}
      <button
        type="button"
        aria-label="Supprimer la ressource"
        title="Supprimer la ressource"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={15} />
      </button>

      {confirming && (
        <DeleteSourceModal
          slug={source.slug}
          title={source.title}
          onClose={() => setConfirming(false)}
          onDeleted={(slug) => onDeleted?.(slug)}
        />
      )}
    </div>
  );
}
