'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Modale de confirmation générique, purement client (aucun fetch). Calquée sur le
 * pattern d'overlay de sources/DeleteSourceModal (fond assombri, carte blanche,
 * Escape / clic hors carte pour annuler). Sert p. ex. à confirmer la création d'un
 * nouveau type de lien à l'upload (vocabulaire réutilisable par les autres).
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onCancel}
            aria-label="Fermer"
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-700">{message}</p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-[#0F6E56] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c5a47]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
