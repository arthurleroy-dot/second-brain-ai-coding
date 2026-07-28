'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Source } from '@/types';
import { ALL_ORIGINS, originLabel, typeLabel } from '@/lib/ui';

// Formes minimales renvoyées par /api/themes et /api/entities (types locaux :
// on évite d'importer les interfaces définies dans le module serveur wiki-parser).
type ThemeOpt = { slug: string; label: string };
type EntityType = { slug: string; label: string };
type EntityOpt = { slug: string; label: string; entity_type: string };

export default function FilterBar({ sources }: { sources: Source[] }) {
  const router = useRouter();
  const params = useSearchParams();

  // Registres (tout le registre, pas seulement ce qui est présent sur les sources).
  const [themes, setThemes] = useState<ThemeOpt[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [entities, setEntities] = useState<EntityOpt[]>([]);

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => {});
    fetch('/api/entities')
      .then((r) => r.json())
      .then((d) => {
        setEntityTypes(d.types ?? []);
        setEntities(d.entities ?? []);
      })
      .catch(() => {});
  }, []);

  // slug d'entité → son type (pour piloter les menus par type).
  const entityById = useMemo(() => {
    const m = new Map<string, EntityOpt>();
    for (const e of entities) m.set(e.slug, e);
    return m;
  }, [entities]);

  // Types DÉRIVÉS des ressources présentes (comme authors/dates) — un type non
  // utilisé n'apparaît pas (règle « filtres = réalité » ; `tweet` disparaît).
  // La valeur du filtre = le slug kebab lui-même.
  const types = Array.from(new Set(sources.map((s) => s.type).filter(Boolean) as string[]))
    .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));

  const authors = Array.from(
    new Set(sources.map((s) => s.author).filter(Boolean) as string[]),
  ).sort();
  const dates = Array.from(
    new Set(sources.map((s) => (s.date ? s.date.slice(0, 7) : null)).filter(Boolean) as string[]),
  ).sort((a, b) => b.localeCompare(a));

  // Les options sont des `AAAA-MM`, mais un nœud date-année du graphe filtre sur
  // `AAAA` seul. On injecte la valeur courante si elle manque, sinon le menu
  // resterait vide (non auto-rempli) alors que la liste, elle, est bien filtrée.
  const currentDate = params.get('date') ?? '';
  const dateOptions =
    currentDate && !dates.includes(currentDate)
      ? [...dates, currentDate].sort((a, b) => b.localeCompare(a))
      : dates;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/sources?${next.toString()}`);
  };

  // Entités sélectionnées (liste plate de slugs, un par type via les menus).
  const selectedEntities = (params.get('entity') ?? '').split(',').filter(Boolean);

  // Valeur courante du menu d'un type = le slug sélectionné de ce type (ou '').
  const entityValueForType = (typeSlug: string) =>
    selectedEntities.find((slug) => entityById.get(slug)?.entity_type === typeSlug) ?? '';

  // Sélectionne (ou déselectionne) une entité pour un type : on remplace celle du
  // même type, on garde les autres. Le param `entity` reste type-agnostique.
  const setEntity = (typeSlug: string, entitySlug: string) => {
    const kept = selectedEntities.filter((slug) => entityById.get(slug)?.entity_type !== typeSlug);
    const nextList = entitySlug ? [...kept, entitySlug] : kept;
    const next = new URLSearchParams(params.toString());
    if (nextList.length) next.set('entity', nextList.join(','));
    else next.delete('entity');
    router.push(`/sources?${next.toString()}`);
  };

  const selectClass =
    'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectClass}
        value={params.get('type') ?? ''}
        onChange={(e) => setParam('type', e.target.value)}
      >
        <option value="">Tous les types</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {typeLabel(t)}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('author') ?? ''}
        onChange={(e) => setParam('author', e.target.value)}
      >
        <option value="">Tous les auteurs</option>
        {authors.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('origin') ?? ''}
        onChange={(e) => setParam('origin', e.target.value)}
      >
        <option value="">Toutes les origines</option>
        {ALL_ORIGINS.map((o) => (
          <option key={o} value={o}>
            {originLabel(o)}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('date') ?? ''}
        onChange={(e) => setParam('date', e.target.value)}
      >
        <option value="">Toutes les dates</option>
        {dateOptions.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('topic') ?? ''}
        onChange={(e) => setParam('topic', e.target.value)}
      >
        <option value="">Tous les thèmes</option>
        {themes.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Un menu par type de lien (Outil, Client, …) — ajouté automatiquement dès
          qu'un nouveau type apparaît dans le registre des entités. */}
      {entityTypes.map((t) => {
        const opts = entities.filter((e) => e.entity_type === t.slug);
        if (opts.length === 0) return null;
        return (
          <select
            key={t.slug}
            className={selectClass}
            value={entityValueForType(t.slug)}
            onChange={(e) => setEntity(t.slug, e.target.value)}
          >
            <option value="">Tous · {t.label}</option>
            {opts.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.label}
              </option>
            ))}
          </select>
        );
      })}

      {(params.toString() !== '') && (
        <button
          type="button"
          onClick={() => router.push('/sources')}
          className="text-xs text-gray-500 underline hover:text-gray-700"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
