'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Source } from '@/types';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';

export default function SourceRow({ source }: { source: Source }) {
  const inner = (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-gray-300">
      <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${typeBadgeClass(source.type)}`}>
        {typeLabel(source.type)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">{source.title}</div>
        <div className="text-xs text-gray-500">
          {source.author ?? 'auteur inconnu'} · {formatDate(source.date)}
          {source.topics.length > 0 && <> · {source.topics.join(', ')}</>}
        </div>
      </div>
      {source.needs_review && (
        <span
          title="À vérifier"
          className="flex shrink-0 items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700"
        >
          <AlertTriangle size={11} /> à vérifier
        </span>
      )}
      {source.url && <ExternalLink size={14} className="shrink-0 text-gray-400" />}
    </div>
  );

  if (source.url) {
    return (
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}
