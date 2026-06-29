'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { JobStatus } from '@/types';

interface Props {
  jobId: string;
  onResolved?: (status: 'done' | 'error', errorMessage: string | null) => void;
}

/**
 * Poll le statut d'un job de traitement toutes les 3 s jusqu'à un état terminal.
 */
export default function ProcessingStatus({ jobId, onResolved }: Props) {
  const [status, setStatus] = useState<JobStatus>('queued');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError('Supabase non configuré (clés NEXT_PUBLIC manquantes).');
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const { data } = await supabase!
        .from('processing_jobs')
        .select('status, error_message')
        .eq('id', jobId)
        .single();
      if (!active) return;

      if (data) {
        setStatus(data.status as JobStatus);
        setError(data.error_message ?? null);
        if (data.status === 'done' || data.status === 'error') {
          onResolved?.(data.status as 'done' | 'error', data.error_message ?? null);
          return; // arrêt du polling
        }
      }
      timer = setTimeout(poll, 3000);
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (status === 'done') {
    return (
      <div className="flex items-center gap-2 text-sm text-[#0F6E56]">
        <CheckCircle2 size={18} /> Ajouté à la base de connaissances.
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-start gap-2 text-sm text-red-600">
        <XCircle size={18} className="mt-0.5 shrink-0" />
        <span>Erreur de traitement : {error ?? 'inconnue'}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <Loader2 size={18} className="animate-spin" /> Traitement en cours…
      </div>
      <p className="text-xs text-gray-500">
        Claude lit et analyse le fichier. Tu peux continuer à utiliser l’app, on te
        notifie quand c’est prêt.
      </p>
    </div>
  );
}
