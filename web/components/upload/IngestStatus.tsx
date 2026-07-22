'use client';

import Link from 'next/link';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';

interface Props {
  state: 'pending' | 'processing' | 'ingested' | 'error';
  slug: string | null;
  cost: number | null; // USD
  error: string | null;
}

/** Formate un coût USD : cents pour les petits montants (« ≈ 18 ¢ »), sinon « ≈ $0,42 ». */
function formatCost(usd: number): string {
  if (usd >= 1) return `≈ $${usd.toFixed(2)}`;
  const cents = usd * 100;
  const rounded = cents < 10 ? Math.round(cents * 10) / 10 : Math.round(cents);
  return `≈ ${String(rounded).replace('.', ',')} ¢`;
}

/**
 * Affiche l'état d'ingestion d'un fichier déposé — composant PRÉSENTATIONNEL pur.
 * Le suivi (polling de /api/ingest-status) et l'état vivent dans le store module
 * `ingest-view-store` (source unique de vérité, survit à la navigation) ; ce
 * composant ne fait que rendre l'état que lui passe UploadForm.
 */
export default function IngestStatus({ state, slug, cost, error }: Props) {
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

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600">
        <XCircle size={18} /> Échec de l'ingestion.
        {error && <span className="text-gray-500">— {error}</span>}
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
