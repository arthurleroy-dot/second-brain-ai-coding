'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Download, Loader2 } from 'lucide-react';

/**
 * Visualiseur de pages PDF SÉLECTIONNABLES (rattrapage vision, spec §D — v2 « cases sur les
 * pages »). Remplace le visualiseur PDF natif (colonne gauche de la fiche) par une colonne
 * d'IMAGES de pages (route `/api/raw-image?page=N`), chacune avec une case à cocher POSÉE sur
 * la page. L'utilisateur clique une page pour la sélectionner, en regardant son contenu, puis
 * « Re-traiter » relance la lecture vision (Haiku) sur les pages cochées et greffe leurs blocs
 * figure ; `router.refresh()` recharge la transcription (colonne droite). Point orange = page
 * qui a déjà un bloc figure.
 */
export default function ReviseFigures({
  slug,
  sourceFile,
  downloadUrl,
}: {
  slug: string;
  sourceFile: string;
  downloadUrl?: string | null;
}) {
  const router = useRouter();
  const endpoint = `/api/resource/${encodeURIComponent(slug)}/revise-figures`;
  const imgUrl = (n: number) => `/api/raw-image/${encodeURIComponent(sourceFile)}?page=${n}&scale=2`;

  const [meta, setMeta] = useState<{ totalPages: number; figurePages: number[] } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { method: 'GET' });
      const data = await res.json();
      if (res.ok) setMeta({ totalPages: data.totalPages ?? 0, figurePages: data.figurePages ?? [] });
    } catch {
      /* silencieux */
    }
  }, [endpoint]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const toggle = (n: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  async function onSubmit() {
    const pages = [...selected].sort((a, b) => a - b);
    if (pages.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: 'err', text: data?.error ?? `Échec (HTTP ${res.status}).` });
      } else {
        const done = (data.revised ?? []) as number[];
        const warns = (data.warnings ?? []) as string[];
        const cost = typeof data.costUsd === 'number' ? ` · ~$${data.costUsd.toFixed(3)}` : '';
        setMsg({
          kind: done.length ? 'ok' : 'err',
          text: [
            done.length ? `Page(s) ${done.join(', ')} re-traitée(s)${cost}.` : `Aucune page modifiée${cost}.`,
            ...warns,
          ].join(' '),
        });
        if (done.length) {
          setSelected(new Set());
          await loadMeta();
          router.refresh();
        }
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: `Erreur réseau : ${e?.message ?? e}` });
    } finally {
      setBusy(false);
    }
  }

  const total = meta?.totalPages ?? 0;
  const figureSet = new Set(meta?.figurePages ?? []);

  return (
    <div className="flex h-full flex-col">
      {/* Barre d'action collante : bouton toujours atteignable en scrollant les pages. */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white/95 px-3 py-2 backdrop-blur">
        <span className="text-[11px] text-gray-500">
          {total > 0 ? 'Coche les pages à re-lire en vision' : 'Pages'}
        </span>
        <button
          onClick={onSubmit}
          disabled={busy || selected.size === 0}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {busy ? 'En cours…' : `Re-traiter${selected.size ? ` ${selected.size}` : ''}`}
        </button>
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <Download size={13} /> PDF
          </a>
        )}
      </div>
      {msg && (
        <p
          className={`border-b border-gray-100 px-3 py-1.5 text-[11px] leading-snug ${
            msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* Colonne de pages en images, chacune cliquable pour (dé)cocher. */}
      <div className="flex-1 overflow-y-auto bg-gray-100 p-3">
        {meta === null ? (
          <p className="text-[11px] text-gray-400">Chargement des pages…</p>
        ) : total === 0 ? (
          <p className="text-[11px] text-gray-400">Aperçu par page indisponible pour cette source.</p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
              const on = selected.has(n);
              const hasFig = figureSet.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => !busy && toggle(n)}
                  aria-pressed={on}
                  className={`relative block w-full overflow-hidden rounded-lg border bg-white text-left shadow-sm transition ${
                    on ? 'border-gray-900 ring-2 ring-gray-900' : 'border-gray-200 hover:border-gray-400'
                  } ${busy ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  {/* Case à cocher POSÉE sur la page (coin haut-gauche). */}
                  <span
                    className={`pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium shadow ${
                      on ? 'bg-gray-900 text-white' : 'bg-white/95 text-gray-700 ring-1 ring-gray-300'
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
                        on ? 'border-white bg-white' : 'border-gray-400 bg-white'
                      }`}
                    >
                      {on && <Check size={11} className="text-gray-900" strokeWidth={3} />}
                    </span>
                    Page {n}
                    {hasFig && (
                      <span
                        title="figure déjà présente"
                        className={`ml-0.5 h-1.5 w-1.5 rounded-full ${on ? 'bg-orange-300' : 'bg-orange-500'}`}
                      />
                    )}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgUrl(n)}
                    alt={`Page ${n}`}
                    loading="lazy"
                    className="block w-full"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
