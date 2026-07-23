'use client';

import { Check, Loader2 } from 'lucide-react';
import { TrailStep } from '@/types';

/**
 * Checklist d'étapes, de haut en bas : spinner discret pendant l'exécution,
 * pastille sombre cochée une fois l'étape terminée. Composant PRÉSENTATIONNEL
 * pur, partagé entre le chat (navigation de l'agent) et le suivi d'ingestion
 * (phases du pipeline). Accepte n'importe quel `TrailStep` : le chat n'envoie
 * pas de `detail`, l'ingestion s'en sert pour l'animation « L'IA rédige… ».
 */
export default function StepTrail({ steps }: { steps: TrailStep[] }) {
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const done = s.status === 'done';
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                done ? 'bg-gray-900 text-white' : 'border border-gray-300'
              }`}
            >
              {done ? (
                <Check size={11} strokeWidth={3} />
              ) : (
                <Loader2 size={11} className="animate-spin text-gray-400" />
              )}
            </span>
            <span className={done ? 'text-gray-500' : 'text-gray-700'}>{s.label}</span>
            {/* Animation de l'étape en cours (ex. compteur de caractères rédigés) :
                texte muté + point qui pulse. Absent du chat (aucun `detail`). */}
            {!done && s.detail && (
              <span className="flex items-center gap-1 text-gray-400">
                <span className="h-1 w-1 animate-pulse rounded-full bg-gray-400" />
                {s.detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
