'use client';

import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

/**
 * Modale d'avertissement avant suppression déterministe d'une ressource.
 * Appelle DELETE /api/sources/<slug> (moteur wiki-mutate + commit atomique), puis
 * `onDeleted(slug)` au succès (retrait optimiste côté liste). Calquée sur le
 * pattern modale d'UploadModal + le pattern busy/error de CandidateCard.
 */
export default function DeleteSourceModal({
  slug,
  title,
  onClose,
  onDeleted,
}: {
  slug: string;
  title: string;
  onClose: () => void;
  onDeleted: (slug: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sources/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Échec de la suppression');
        setBusy(false);
        return;
      }
      onDeleted(slug);
      onClose();
    } catch {
      setError('Erreur réseau');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <AlertTriangle size={18} className="text-red-600" /> Supprimer la ressource
          </h2>
          <button onClick={onClose} disabled={busy} aria-label="Fermer" className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <p className="mb-1 text-sm text-gray-700">
          Êtes-vous sûr de vouloir supprimer cette ressource ? Elle ne sera plus accessible à personne.
        </p>
        <p className="mb-4 truncate rounded-md bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-600">
          {title}
        </p>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}
