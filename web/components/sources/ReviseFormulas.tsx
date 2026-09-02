'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sigma } from 'lucide-react';
import Markdown from '@/components/Markdown';

interface FormulaBlock {
  index: number;
  latex: string;
}

/**
 * Panneau de RÉVISION IA des formules d'une ressource (spec §3.4). Au montage, liste les
 * blocs formule (`GET`). **Si aucune formule, ne rend RIEN** (pas de panneau parasite).
 * Sinon, pour chaque formule : un aperçu KaTeX (même rendu que la page), un champ où
 * l'utilisateur décrit la correction **en français**, et « Re-générer » → l'IA re-produit
 * cette formule (`POST { index, instruction }`). La consigne est le levier : un re-run sans
 * consigne redonnerait la même erreur. Aucun LaTeX à taper à la main.
 */
export default function ReviseFormulas({ slug }: { slug: string }) {
  const router = useRouter();
  const endpoint = `/api/resource/${encodeURIComponent(slug)}/revise-formulas`;

  const [formulas, setFormulas] = useState<FormulaBlock[] | null>(null);
  const [instructions, setInstructions] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { method: 'GET' });
      const data = await res.json();
      if (res.ok) setFormulas(Array.isArray(data.formulas) ? data.formulas : []);
      else setFormulas([]);
    } catch {
      setFormulas([]);
    }
  }, [endpoint]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function onRegenerate(index: number) {
    const instruction = (instructions[index] ?? '').trim();
    if (!instruction || busy !== null) return;
    setBusy(index);
    setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: 'err', text: data?.error ?? `Échec (HTTP ${res.status}).` });
      } else {
        const cost = typeof data.costUsd === 'number' ? ` · ~$${data.costUsd.toFixed(3)}` : '';
        if (data.changed) {
          setMsg({ kind: 'ok', text: `Formule ${index + 1} régénérée${cost}.` });
          setInstructions((prev) => ({ ...prev, [index]: '' }));
          await loadList();
          router.refresh(); // recharge la page ressource → nouvelle formule rendue
        } else {
          setMsg({ kind: 'ok', text: `Aucun changement (formule identique)${cost}.` });
        }
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: `Erreur réseau : ${e?.message ?? e}` });
    } finally {
      setBusy(null);
    }
  }

  // Auto-masquage : aucune formule (ou pas encore chargé) → aucun panneau.
  if (formulas === null || formulas.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sigma size={15} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-800">Réviser les formules</h2>
        <span className="text-[11px] text-gray-400">
          {formulas.length} formule{formulas.length > 1 ? 's' : ''} reconstruite
          {formulas.length > 1 ? 's' : ''}
        </span>
      </div>

      {msg && (
        <p
          className={`mb-3 rounded-md px-2.5 py-1.5 text-[11px] leading-snug ${
            msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {formulas.map((f) => {
          const isBusy = busy === f.index;
          const instr = instructions[f.index] ?? '';
          return (
            <div key={f.index} className="rounded-lg border border-gray-200 bg-white p-3">
              {/* Aperçu rendu (KaTeX) — identique à la page ressource. */}
              <div className="mb-2 overflow-x-auto rounded-md bg-gray-50 px-3 py-2">
                <Markdown variant="prose" content={`$$\n${f.latex}\n$$`} />
              </div>
              <textarea
                value={instr}
                onChange={(e) =>
                  setInstructions((prev) => ({ ...prev, [f.index]: e.target.value }))
                }
                placeholder="Décris la correction… (ex. « la 2ᵉ ligne devrait être 4 5 6 »)"
                rows={2}
                disabled={isBusy}
                className="w-full resize-y rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none disabled:opacity-50"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => onRegenerate(f.index)}
                  disabled={isBusy || busy !== null || !instr.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
                >
                  {isBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                  {isBusy ? 'Régénération…' : 'Re-générer'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
