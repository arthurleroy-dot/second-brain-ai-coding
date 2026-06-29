'use client';

import { BookOpen } from 'lucide-react';
import { WikiTopic, ResourceType } from '@/types';
import { ALL_TYPES, typeLabel, typeBadgeClass } from '@/lib/ui';

export default function TopicCard({ topic }: { topic: WikiTopic }) {
  const counts = ALL_TYPES.map((t) => ({
    type: t,
    n: topic.sources.filter((s) => s.type === t).length,
  })).filter((c) => c.n > 0);

  return (
    <a
      href={`/sources?topic=${topic.slug}`}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
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
  );
}
