'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';

type State = 'pending' | 'processing' | 'ingested';

interface Props {
  file: string;
  onResolved?: (status: 'done', slug: string) => void;
}

/** Formate un coût USD : cents pour les petits montants (« ≈ 18 ¢ »), sinon « ≈ $0,42 ». */
function formatCost(usd: number): string {
  if (usd >= 1) return `≈ $${usd.toFixed(2)}`;
  const cents = usd * 100;
  const rounded = cents < 10 ? Math.round(cents * 10) / 10 : Math.round(cents);
  return `≈ ${String(rounded).replace('.', ',')} ¢`;
}

/**
 * Suit l'ingestion LOCALE d'un fichier déposé (dépôt dans /raw → ingestion in-process
 * → wiki/). Poll toutes les 5 s l'API /api/ingest-status jusqu'à l'état "ingested",
 * puis affiche le coût (estimation USD, tarifs Sonnet — ou coût gateway si fourni).
 */
export default function IngestStatus({ file, onResolved }: Props) {
  const [state, setState] = useState<State>('pending');
  const [slug, setSlug] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);

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
          const c = typeof data.fileCostUsd === 'number' ? data.fileCostUsd : data.costUsd;
          setCost(typeof c === 'number' ? c : null);
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
          {cost != null && <span className="text-gray-500">— coût {formatCost(cost)}</span>}
        </div>
        {cost != null && (
          <p className="text-xs text-gray-400">Estimation en USD (tarifs Sonnet), ou coût réel de la gateway s'il est fourni.</p>
        )}
        {slug && (
          <Link href={`/sources/${slug}`} className="inline-block text-xs text-blue-600 hover:underline">
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
        Le fichier a été déposé dans <code>/raw</code>. L'ingestion locale le traite
        automatiquement ; la fiche apparaîtra ici et dans le wiki dans un instant.
      </p>
    </div>
  );
}
