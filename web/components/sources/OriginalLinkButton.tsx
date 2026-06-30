'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

/**
 * Bouton « Voir l'original » présent sur toutes les fiches.
 * - Si une URL est renseignée → ouvre l'article original dans un nouvel onglet.
 * - Sinon → affiche un message d'erreur (le déposant n'a pas renseigné le lien).
 */
export default function OriginalLinkButton({ url }: { url: string | null }) {
  const [showError, setShowError] = useState(false);

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
      >
        <ExternalLink size={15} /> Voir l'original
      </a>
    );
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setShowError(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
      >
        <ExternalLink size={15} /> Voir l'original
      </button>
      {showError && (
        <p className="mt-2 text-xs text-red-600">
          Le lien de l'article n'a pas été renseigné par la personne qui l'a déposé.
        </p>
      )}
    </div>
  );
}
