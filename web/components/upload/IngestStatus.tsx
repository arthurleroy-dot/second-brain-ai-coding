'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';

type State = 'pending' | 'processing' | 'ingested';

interface Props {
  file: string;
  onResolved?: (status: 'done', slug: string) => void;
}

/**
 * Suit l'ingestion d'un fichier déposé (commit dans /raw → Action → wiki/).
 * Poll toutes les 5 s l'API /api/ingest-status jusqu'à l'état "ingested".
 */
export default function IngestStatus({ file, onResolved }: Props) {
  const [state, setState] = useState<State>('pending');
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/ingest-status?file=${encodeURIComponent(file)}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (!active) return;
        if (data.state === 'ingested') {
          setState('ingested');
          setSlug(data.slug ?? null);
          onResolved?.('done', data.slug ?? '');
          return; // arrêt du polling
        }
        setState(data.state === 'processing' ? 'processing' : 'pending');
      } catch {
        /* réseau : on retentera */
      }
      timer = setTimeout(poll, 5000);
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (state === 'ingested') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-[#0F6E56]">
          <CheckCircle2 size={18} /> Ingéré dans le wiki.
        </div>
        {slug && (
          <Link
            href={`/sources/${slug}`}
            className="inline-block text-xs text-blue-600 hover:underline"
          >
            Voir la fiche →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-gray-700">
        {state === 'processing' ? (
          <>
            <Loader2 size={18} className="animate-spin" /> Ingestion en cours…
          </>
        ) : (
          <>
            <Clock size={18} className="text-gray-400" /> Déposé, en attente d'ingestion.
          </>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Le fichier a été committé dans <code>/raw</code>. Un agent l'ingère
        automatiquement (rattrapage chaque nuit si besoin). La fiche apparaîtra
        ici et sur le site quelques minutes après.
      </p>
    </div>
  );
}
