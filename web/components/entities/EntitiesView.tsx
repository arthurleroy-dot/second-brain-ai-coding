'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Tags, Trash2 } from 'lucide-react';
import { Candidate } from '@/types';
import { entityTypeLabel } from '@/lib/ui';
import { useScrollRestoration } from '@/lib/use-scroll-restoration';
import CandidateCard, { Entity, TypeInfo } from './CandidateCard';
import DeleteEntityModal from './DeleteEntityModal';

export default function EntitiesView() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Entity | null>(null);
  const scrollRef = useScrollRestoration<HTMLDivElement>('entities:scroll');

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
              />
            ))}
          </div>
        )}
      </section>

      {/* Registre des entités */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Tags size={16} className="text-gray-400" /> Registre
          <span className="text-xs font-normal text-gray-400">{entities.length}</span>
        </h2>
        {entities.length === 0 ? (
          <p className="text-sm text-gray-400">Aucune entité dans le registre.</p>
        ) : (
          <div className="space-y-1.5">
            {entities.map((e) => (
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
