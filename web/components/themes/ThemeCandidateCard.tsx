'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GitMerge, Plus, X, Check } from 'lucide-react';
import { ThemeCandidate, ThemeEntry } from '@/types';

const WIKI_THEME_HREF = (slug: string) => `/wiki/${slug}`;

/**
 * Carte de décision d'un thème candidat. Clone allégé de CandidateCard (entités) :
 * pas de dimension `type`, donc « Créer » ne demande qu'un nom. Actions :
 * fusionner (alias d'un thème existant) / créer / rejeter.
 */
export default function ThemeCandidateCard({
  candidate,
  themes,
  onResolved,
}: {
  candidate: ThemeCandidate;
  themes: ThemeEntry[];
  onResolved: (normalized: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'merge' | 'create'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Sortie animée après une décision : on laisse ~1 s le bandeau vert visible,
  // puis on fond la carte, puis on prévient le parent qui la retire de la liste.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t1 = setTimeout(() => setLeaving(true), 1000);
    const t2 = setTimeout(() => onResolved(candidate.normalized), 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [done, onResolved, candidate.normalized]);

  // Fusion : cible pré-remplie avec la meilleure ressemblance si dispo.
  const [mergeTarget, setMergeTarget] = useState(
    candidate.suggested_aliases[0]?.slug ?? '',
  );
  // Création : nom pré-rempli avec la forme détectée (le serveur le slugifie).
  const [createName, setCreateName] = useState(candidate.name);

  async function resolve(action: string, extra: Record<string, string> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/theme-candidates/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalized: candidate.normalized, action, ...extra }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? 'Échec de la décision');
        setBusy(false);
        return;
      }
      const label =
        action === 'merge_alias'
          ? 'Fusion appliquée'
          : action === 'create'
            ? 'Création appliquée'
            : 'Rejet appliqué';
      setDone(`${label} — mise à jour du wiki immédiate.`);
    } catch {
      setError('Erreur réseau');
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all duration-300 ${
        leaving ? 'scale-95 opacity-0 pointer-events-none' : ''
      }`}
    >
      {/* Nom + variantes */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{candidate.name}</h3>
        {candidate.variants
          .filter((v) => v !== candidate.name)
          .map((v) => (
            <span key={v} className="text-xs text-gray-400">
              alias vu : {v}
            </span>
          ))}
      </div>

      {candidate.note && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          {candidate.note}
        </p>
      )}

      {/* Ressemble à */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-gray-400">Ressemble à :</span>
        {candidate.suggested_aliases.length > 0 ? (
          candidate.suggested_aliases.map((a) => (
            <Link
              key={a.slug}
              href={WIKI_THEME_HREF(a.slug)}
              className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {a.label}
              <span className="ml-1 text-gray-400">{Math.round(a.score * 100)}%</span>
            </Link>
          ))
        ) : (
          <span className="text-gray-400">aucune correspondance</span>
        )}
      </div>

      {/* Vu dans */}
      <div className="space-y-1.5">
        {candidate.seen_in.map((s, i) => (
          <Link
            key={`${s.resource}-${i}`}
            href={`/sources/${s.resource}${s.section ? `#${s.section}` : ''}`}
            className="block rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-200"
            title={s.context}
          >
            <span className="font-medium text-gray-700">{s.resource}</span>
            <span className="line-clamp-2"> — {s.context}</span>
          </Link>
        ))}
      </div>

      {/* Décision */}
      {done ? (
        <p className="flex items-center gap-1.5 rounded-md bg-[#E1F5EE] px-2.5 py-1.5 text-xs font-medium text-[#0F6E56]">
          <Check size={13} /> {done}
        </p>
      ) : (
        <div className="border-t border-gray-100 pt-3">
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

          {mode === 'idle' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('merge')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 disabled:opacity-50"
              >
                <GitMerge size={13} /> Fusionner
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('create')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 disabled:opacity-50"
              >
                <Plus size={13} /> Créer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => resolve('reject')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:border-red-200 hover:text-red-600 disabled:opacity-50"
              >
                <X size={13} /> Rejeter
              </button>
            </div>
          )}

          {mode === 'merge' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Alias de :</span>
              <select
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
              >
                <option value="">— choisir un thème —</option>
                {themes.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !mergeTarget}
                onClick={() => resolve('merge_alias', { target_slug: mergeTarget })}
                className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? '…' : 'Confirmer'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('idle')}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Annuler
              </button>
            </div>
          )}

          {mode === 'create' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Nom du thème :</span>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="nom du thème"
                className="w-44 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                disabled={busy || !createName.trim()}
                onClick={() => resolve('create', { slug: createName.trim() })}
                className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? '…' : 'Confirmer'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('idle')}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Annuler
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
