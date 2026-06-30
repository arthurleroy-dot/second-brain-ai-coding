'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { Source } from '@/types';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';

export default function SourceRow({
  source,
  onDeleted,
}: {
  source: Source;
  onDeleted?: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetId = source.id ?? source.slug;

  const handleDelete = async () => {
    if (!source.id) {
      setError('Suppression impossible : identifiant manquant.');
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sources/${source.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Échec de la suppression.');
        setDeleting(false);
        return;
      }
      onDeleted?.(source.id);
    } catch {
      setError('Erreur réseau pendant la suppression.');
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Supprimer cette ressource"
        aria-label="Supprimer cette ressource"
        className="shrink-0 rounded-full p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-600"
      >
        <X size={16} />
      </button>

      <Link href={`/sources/${targetId}`} className="block min-w-0 flex-1">
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
          {source.url && (
            <ExternalLink size={14} className="shrink-0 text-gray-400" aria-label="Source externe disponible" />
          )}
        </div>
      </Link>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900">Supprimer cette ressource ?</h2>
            <p className="mt-2 text-sm text-gray-600">
              <span className="font-medium text-gray-800">{source.title}</span> sera
              définitivement supprimée et ne sera plus accessible pour personne. Cette
              action est irréversible.
            </p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
