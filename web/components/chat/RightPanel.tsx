'use client';

import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { Source, ResourceType } from '@/types';
import { ALL_TYPES, TYPE_TO_FOLDER, typeLabel, typeBadgeClass } from '@/lib/ui';
import { useUpload } from '@/components/UploadProvider';

interface Props {
  selectedFolders: Set<string>;
  onToggleFolder: (folder: string) => void;
}

export default function RightPanel({ selectedFolders, onToggleFolder }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const { openPicker, uploading, lastResult } = useUpload();

  useEffect(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
      .catch(() => {});
  }, [lastResult]);

  const countByType = (t: ResourceType) =>
    sources.filter((s) => s.type === t).length;

  const recent = sources.slice(0, 5);

  return (
    <aside className="flex w-[190px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-white p-3 text-xs">
      <div>
        <h3 className="mb-2 font-semibold text-gray-700">Filtrer par type</h3>
        <ul className="space-y-1">
          {ALL_TYPES.map((t) => {
            const folder = TYPE_TO_FOLDER[t];
            const count = countByType(t);
            return (
              <li key={t}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedFolders.has(folder)}
                    onChange={() => onToggleFolder(folder)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="flex-1 text-gray-700">{typeLabel(t)}</span>
                  <span className="text-gray-400">{count}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 font-semibold text-gray-700">Sources récentes</h3>
        <ul className="space-y-2">
          {recent.map((s) => (
            <li key={s.slug} className="leading-tight">
              <span className={`mr-1 rounded px-1 py-0.5 text-[9px] font-medium ${typeBadgeClass(s.type)}`}>
                {typeLabel(s.type)}
              </span>
              <span className="text-gray-700">{s.title}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="text-gray-400">Aucune source.</li>}
        </ul>
      </div>

      <button
        type="button"
        onClick={openPicker}
        disabled={uploading}
        className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        <Upload size={14} />
        {uploading ? 'Envoi…' : 'Déposer une source'}
      </button>
      {lastResult && (
        <p className={`text-[10px] ${lastResult.ok ? 'text-green-600' : 'text-red-600'}`}>
          {lastResult.message}
        </p>
      )}
    </aside>
  );
}
