'use client';

import { Check, Loader2 } from 'lucide-react';
import { ChatStep } from '@/types';

/**
 * Checklist des étapes de navigation de l'agent, de haut en bas : spinner
 * discret pendant la lecture, pastille sombre cochée une fois la ressource lue.
 * Partagé entre la vue live (bulle de chargement de ChatWindow) et la trace
 * repliée sous la réponse (Message).
 */
export default function StepTrail({ steps }: { steps: ChatStep[] }) {
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
          </div>
        );
      })}
    </div>
  );
}
