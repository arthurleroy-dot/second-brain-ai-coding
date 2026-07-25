'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Tags, Trash2, X } from 'lucide-react';
import { Candidate } from '@/types';
import { entityTypeLabel } from '@/lib/ui';
import { useScrollRestoration } from '@/lib/use-scroll-restoration';
import { usePersistentState } from '@/lib/use-persistent-state';
import CandidateCard, { Entity, TypeInfo } from './CandidateCard';
import DeleteEntityModal from './DeleteEntityModal';

// Style des menus déroulants, aligné sur FilterBar (web/components/sources).
const selectClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700';

export default function EntitiesView() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Entity | null>(null);
  // Filtre du registre par type d'entité (slugs). Persistant entre navigations
  // SPA, comme la position de scroll.
  const [typeFilters, setTypeFilters] = usePersistentState<string[]>(
    'entities:type-filters',
    [],
  );
  const scrollRef = useScrollRestoration<HTMLDivElement>('entities:scroll');

  // Recharge le registre (entités + types) depuis le disque. Appelé après une
  // décision pour refléter aussitôt une création/fusion, sans attendre un refresh.
  const loadRegistry = useCallback(async () => {
    const e = await fetch('/api/entities')
      .then((r) => r.json())
      .catch(() => null);
    if (!e) return;
    setEntities(e.entities ?? []);
    setTypes(e.types ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/candidates').then((r) => r.json()),
      fetch('/api/entities').then((r) => r.json()),
    ])
      .then(([c, e]) => {
        if (cancelled) return;
        setCandidates(c.candidates ?? []);
        setEntities(e.entities ?? []);
        setTypes(e.types ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = candidates.filter((c) => c.status === 'pending');

  // Une fois la carte arbitrée (et son animation de sortie terminée) : on retire
  // le candidat de la liste (la carte disparaît sans refresh) ET on resynchronise
  // le registre du dessous (une création/fusion y apparaît aussitôt). Handler
  // stable → n'invalide pas l'effet de sortie de la carte.
  const handleResolved = useCallback(
    (normalized: string) => {
      setCandidates((prev) => prev.filter((c) => c.normalized !== normalized));
      void loadRegistry();
    },
    [loadRegistry],
  );

  // Types encore proposables (pas déjà filtrés) et nb d'entités par type.
  const availableTypes = types.filter((t) => !typeFilters.includes(t.slug));
  const countByType = (slug: string) =>
    entities.filter((e) => e.entity_type === slug).length;
  const addType = (slug: string) =>
    setTypeFilters((prev) => (slug && !prev.includes(slug) ? [...prev, slug] : prev));
  const removeType = (slug: string) =>
    setTypeFilters((prev) => prev.filter((s) => s !== slug));

  // Registre filtré : union des types sélectionnés (aucun = tout).
  const shown =
    typeFilters.length === 0
      ? entities
      : entities.filter((e) => typeFilters.includes(e.entity_type));

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-6">
      {loading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : (
        <>
      {/* En attente de décision */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Clock size={16} className="text-gray-400" /> En attente de décision
          <span className="text-xs font-normal text-gray-400">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400">
            Aucune entité en attente — tout est arbitré.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pending.map((c) => (
              <CandidateCard
                key={c.normalized}
                candidate={c}
                entities={entities}
                types={types}
                onResolved={handleResolved}
              />
            ))}
          </div>
        )}
      </section>

      {/* Registre des entités */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Tags size={16} className="text-gray-400" /> Registre
          <span className="text-xs font-normal text-gray-400">
            {typeFilters.length > 0 ? `${shown.length} / ${entities.length}` : entities.length}
          </span>
        </h2>
        {entities.length === 0 ? (
          <p className="text-sm text-gray-400">Aucune entité dans le registre.</p>
        ) : (
          <>
            {/* Filtre par type : un menu déroulant + une étiquette par type retenu */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {availableTypes.length > 0 && (
                <select
                  className={selectClass}
                  value=""
                  onChange={(e) => addType(e.target.value)}
                >
                  <option value="" disabled>
                    Filtrer par type…
                  </option>
                  {availableTypes.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.label} ({countByType(t.slug)})
                    </option>
                  ))}
                </select>
              )}
              {typeFilters.map((slug) => (
                <span
                  key={slug}
                  className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                >
                  {entityTypeLabel(slug)} · {countByType(slug)}
                  <button
                    type="button"
                    onClick={() => removeType(slug)}
                    aria-label={`Retirer ${entityTypeLabel(slug)}`}
                    className="rounded-full hover:bg-indigo-100"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {typeFilters.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTypeFilters([])}
                  className="text-xs text-gray-500 underline hover:text-gray-700"
                >
                  Réinitialiser
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune entité pour ce filtre.</p>
            ) : (
          <div className="space-y-1.5">
            {shown.map((e) => (
              <div
                key={e.slug}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white pr-2 hover:border-gray-300"
              >
                <Link
                  href={`/entities/${e.slug}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5"
                >
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                    {entityTypeLabel(e.entity_type)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                    {e.label}
                  </span>
                  {e.aliases.length > 0 && (
                    <span className="shrink-0 text-xs text-gray-400">
                      {e.aliases.length} alias
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => setDeleting(e)}
                  aria-label={`Supprimer ${e.label}`}
                  title="Supprimer l'entité"
                  className="shrink-0 rounded-md p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
            )}
          </>
        )}
      </section>
        </>
      )}

      {deleting && (
        <DeleteEntityModal
          slug={deleting.slug}
          label={deleting.label}
          onClose={() => setDeleting(null)}
          onDeleted={(slug) => setEntities((prev) => prev.filter((x) => x.slug !== slug))}
        />
      )}
    </div>
  );
}
