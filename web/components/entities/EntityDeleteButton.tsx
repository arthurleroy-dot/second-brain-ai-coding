'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import DeleteEntityModal from './DeleteEntityModal';

/**
 * Bouton « Supprimer » de la fiche entité (page serveur). Ouvre la même modale que
 * la liste, puis renvoie vers /entities au succès (avec refresh pour recharger les
 * données serveur : liste + graphe).
 */
export default function EntityDeleteButton({ slug, label }: { slug: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 size={15} /> Supprimer
      </button>
      {open && (
        <DeleteEntityModal
          slug={slug}
          label={label}
          onClose={() => setOpen(false)}
          onDeleted={() => {
            router.push('/entities');
            router.refresh();
          }}
        />
      )}
    </>
  );
}
