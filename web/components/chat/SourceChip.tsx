'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText } from 'lucide-react';
import { Source } from '@/types';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';

const CHIP_CLASS =
  'inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-left text-xs hover:border-gray-300 hover:bg-gray-50';

export default function SourceChip({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);

  // Contenu commun aux deux rendus (lien interne ou repli modale).
  const inner = (
    <>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeClass(source.type)}`}>
        {typeLabel(source.type)}
      </span>
      <span className="truncate font-medium text-gray-800">{source.title}</span>
      <span className="shrink-0 text-gray-400">
        {source.author ?? 'auteur inconnu'} · {formatDate(source.date)}
      </span>
      {source.url ? (
        <ExternalLink size={11} className="shrink-0 text-gray-400" />
      ) : (
        <FileText size={11} className="shrink-0 text-gray-400" />
      )}
    </>
  );

  // Ressource hydratée (présente dans le wiki) → lien vers la fiche interne.
  // `file_path` n'est posé que pour les vraies ressources (cf. parseResource),
  // donc son absence signale une source citée mais introuvable : on garde alors
  // le repli modale pour ne jamais envoyer vers une page 404.
  if (source.file_path) {
    return (
      <Link href={`/sources/${source.slug}`} className={CHIP_CLASS} title={source.title}>
        {inner}
      </Link>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={CHIP_CLASS} title={source.title}>
        {inner}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">{source.title}</h3>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeClass(source.type)}`}>
                {typeLabel(source.type)}
              </span>
            </div>
            <dl className="space-y-1 text-xs text-gray-600">
              <div><span className="font-medium">Auteur :</span> {source.author ?? 'inconnu'}</div>
              <div><span className="font-medium">Date :</span> {formatDate(source.date)}</div>
              {source.topics.length > 0 && (
                <div><span className="font-medium">Topics :</span> {source.topics.join(', ')}</div>
              )}
            </dl>
            <p className="mt-3 text-xs text-gray-400">
              Aucune URL externe pour cette source. La fiche complète vit dans la base
              de connaissances.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
}
