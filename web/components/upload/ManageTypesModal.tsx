'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Lock, Trash2, Pencil, Check } from 'lucide-react';
import { OriginValue } from '@/types';

type TypeRow = {
  slug: string;
  label: string;
  source_count: number;
  builtin: boolean;
  origin: OriginValue;
};

/**
 * Mini-modale de GESTION des types de document (créer se fait dans le menu du
 * formulaire ; ici on RENOMME ou SUPPRIME un type inutilisé). Calquée sur
 * DeleteThemeModal (overlay + carte, fermeture Escape/clic overlay, état busy).
 *
 * Règle UNIQUE : un type est renommable ET supprimable tant qu'aucune ressource ne
 * le porte. Dès qu'≥1 ressource l'utilise → cadenas (slug figé, cardinale #5).
 * Une ligne par type = libellé + « × N » (source_count) + à droite :
 *  - en usage (≥1 ressource) → cadenas (non cliquable, title explicatif) ;
 *  - sinon → crayon (renommer, PATCH) + corbeille (supprimer, DELETE), chacun
 *    avec sa confirmation/saisie inline.
 * La fermeture déclenche `loadTypes()` côté UploadForm (via onClose).
 */
export default function ManageTypesModal({ onClose }: { onClose: () => void }) {
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // slug en cours de mutation
  const [confirming, setConfirming] = useState<string | null>(null); // slug en attente de confirmation (suppression)
  const [renaming, setRenaming] = useState<string | null>(null); // slug en cours de renommage
  const [renameName, setRenameName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/types')
      .then((r) => r.json())
      .then((d) => setTypes(d.types ?? []))
      .catch(() => setError('Chargement des types impossible'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Réinitialise toute action inline en cours (bascule confirmation ↔ renommage).
  const resetActions = () => {
    setConfirming(null);
    setRenaming(null);
    setRenameName('');
    setError(null);
  };

  async function remove(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      const res = await fetch(`/api/types/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Échec de la suppression');
        setBusy(null);
        setConfirming(null);
        return;
      }
      setTypes((prev) => prev.filter((t) => t.slug !== slug));
      setConfirming(null);
      setBusy(null);
    } catch {
      setError('Erreur réseau');
      setBusy(null);
      setConfirming(null);
    }
  }

  async function rename(oldSlug: string) {
    const name = renameName.trim();
    if (!name) return;
    setBusy(oldSlug);
    setError(null);
    try {
      const res = await fetch(`/api/types/${encodeURIComponent(oldSlug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'Échec du renommage');
        setBusy(null);
        return;
      }
      // Remplace la ligne (slug + libellé) sur place ; le tri re-passe par un load léger.
      setTypes((prev) =>
        prev
          .map((t) => (t.slug === oldSlug ? { ...t, slug: d.slug, label: d.label } : t))
          .sort((a, b) => a.label.localeCompare(b.label)),
      );
      setRenaming(null);
      setRenameName('');
      setBusy(null);
    } catch {
      setError('Erreur réseau');
      setBusy(null);
    }
  }

  // Change l'origine par défaut d'un type — PATCH { origin }. TOUJOURS autorisé (même
  // pour un type verrouillé en renommage/suppression) : ne touche pas au slug, n'affecte
  // QUE les futurs dépôts. Met à jour l'état local au succès.
  async function changeOrigin(slug: string, origin: OriginValue) {
    setBusy(slug);
    setError(null);
    try {
      const res = await fetch(`/api/types/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Échec du changement d'origine");
        setBusy(null);
        return;
      }
      setTypes((prev) => prev.map((t) => (t.slug === slug ? { ...t, origin } : t)));
      setBusy(null);
    } catch {
      setError('Erreur réseau');
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Gérer les types</h2>
          <button
            onClick={onClose}
            disabled={!!busy}
            aria-label="Fermer"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 text-xs text-gray-500">
          Un type est renommable et supprimable tant qu'aucune ressource ne l'utilise.
          Dès qu'au moins une ressource le porte, son nom est figé (cadenas).
        </p>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-400">Chargement…</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {types.map((t) => {
              const locked = t.source_count > 0;
              const isConfirming = confirming === t.slug;
              const isRenaming = renaming === t.slug;
              return (
                <li
                  key={t.slug}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2"
                >
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          rename(t.slug);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          resetActions();
                        }
                      }}
                      placeholder="Nouveau nom"
                      className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                  ) : (
                    <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
                      <span className="truncate">{t.label}</span>
                      <span className="shrink-0 text-xs text-gray-400">× {t.source_count}</span>
                    </span>
                  )}

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Origine par défaut — TOUJOURS active (même verrouillé) : n'affecte
                        que les futurs dépôts, ne touche pas au slug (cardinale #5). */}
                    <select
                      value={t.origin}
                      onChange={(e) => changeOrigin(t.slug, e.target.value as OriginValue)}
                      disabled={busy === t.slug}
                      aria-label={`Origine par défaut du type ${t.label}`}
                      title="Origine par défaut appliquée aux futurs dépôts de ce type"
                      className="rounded-md border border-gray-200 px-1.5 py-1 text-xs text-gray-600 disabled:opacity-50"
                    >
                      <option value="externe">Externe</option>
                      <option value="interne">Interne</option>
                    </select>

                    {locked ? (
                    <span
                      className="shrink-0 text-gray-300"
                      title={`${t.source_count} ressource(s) l'utilisent — nom figé`}
                      aria-label="Non modifiable"
                    >
                      <Lock size={15} />
                    </span>
                  ) : isRenaming ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => rename(t.slug)}
                        disabled={!renameName.trim() || busy === t.slug}
                        aria-label="Valider le renommage"
                        className="rounded-md bg-[#0F6E56] px-2 py-1 font-medium text-white hover:bg-[#0c5a47] disabled:opacity-50"
                      >
                        {busy === t.slug ? '…' : <Check size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={resetActions}
                        disabled={busy === t.slug}
                        className="rounded-md border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Annuler
                      </button>
                    </span>
                  ) : isConfirming ? (
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      <span className="text-gray-500">Supprimer ?</span>
                      <button
                        type="button"
                        onClick={() => remove(t.slug)}
                        disabled={busy === t.slug}
                        className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {busy === t.slug ? '…' : 'Supprimer'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        disabled={busy === t.slug}
                        className="rounded-md border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Annuler
                      </button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Renommer le type ${t.label}`}
                        title="Renommer ce type"
                        onClick={() => {
                          resetActions();
                          setRenaming(t.slug);
                          setRenameName(t.label);
                        }}
                        className="rounded-md p-1 text-gray-300 transition hover:bg-gray-100 hover:text-gray-600"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Supprimer le type ${t.label}`}
                        title="Supprimer ce type"
                        onClick={() => {
                          resetActions();
                          setConfirming(t.slug);
                        }}
                        className="rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            disabled={!!busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
