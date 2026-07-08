'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Entity {
  slug: string;
  label: string;
  entity_type: string;
  aliases: string[];
}
interface TypeInfo {
  slug: string;
  label: string;
}

// Map { type d'entité → noms sélectionnés }. Les noms sont slugifiés côté serveur.
export type LinksValue = Record<string, string[]>;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function cap(s: string): string {
  const t = s.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Sélecteur de liens TYPÉS. Le formulaire s'auto-étend : il lit les types
 * d'entités déjà présents dans le registre (via /api/entities) et propose leurs
 * entités en autocomplétion. On peut aussi créer un nouveau type de lien à la volée.
 */
export default function LinkPicker({
  value,
  onChange,
}: {
  value: LinksValue;
  onChange: (v: LinksValue) => void;
}) {
  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [extraTypes, setExtraTypes] = useState<string[]>([]);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/entities')
      .then((r) => r.json())
      .then((d) => {
        setTypes(d.types ?? []);
        setEntities(d.entities ?? []);
      })
      .catch(() => {});
  }, []);

  const typeLabel = useMemo(() => {
    const m = new Map(types.map((t) => [t.slug, t.label]));
    return (slug: string) => m.get(slug) ?? cap(slug);
  }, [types]);

  // Groupes affichés = registre ∪ types déjà dans value ∪ types ajoutés à la main.
  const shownTypes = useMemo(
    () => [...new Set([...types.map((t) => t.slug), ...Object.keys(value), ...extraTypes])],
    [types, value, extraTypes],
  );

  const entitiesOfType = (t: string) => entities.filter((e) => e.entity_type === t);

  const add = (type: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    const cur = value[type] ?? [];
    if (cur.some((x) => x.toLowerCase() === n.toLowerCase())) return;
    onChange({ ...value, [type]: [...cur, n] });
  };
  const remove = (type: string, name: string) => {
    const cur = (value[type] ?? []).filter((x) => x !== name);
    const next = { ...value };
    if (cur.length) next[type] = cur;
    else delete next[type];
    onChange(next);
  };
  const addType = () => {
    const slug = slugify(newType);
    if (slug && !shownTypes.includes(slug)) setExtraTypes((p) => [...p, slug]);
    setNewType('');
    setAddingType(false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">Liens (optionnel)</span>
        {!addingType ? (
          <button
            type="button"
            onClick={() => setAddingType(true)}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
          >
            <Plus size={12} /> type de lien
          </button>
        ) : (
          <span className="flex items-center gap-1">
            <input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addType())}
              placeholder="ex: client"
              autoFocus
              className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
            />
            <button type="button" onClick={addType} className="text-[11px] font-medium text-[#0F6E56]">
              ok
            </button>
          </span>
        )}
      </div>

      {shownTypes.length === 0 && (
        <p className="text-[11px] text-gray-400">
          Aucun type de lien encore. Laisse vide : l'agent détecte les entités connues.
        </p>
      )}

      {shownTypes.map((type) => {
        const selected = value[type] ?? [];
        const suggestions = entitiesOfType(type).filter(
          (e) => !selected.some((s) => s.toLowerCase() === e.label.toLowerCase() || s.toLowerCase() === e.slug),
        );
        return (
          <div key={type} className="space-y-1.5">
            <label className="block text-[11px] font-medium text-gray-500">{typeLabel(type)}</label>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selected.map((name) => (
                  <span
                    key={name}
                    className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                  >
                    {name}
                    <button type="button" onClick={() => remove(type, name)} aria-label={`Retirer ${name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              list={`ents-${type}`}
              value={drafts[type] ?? ''}
              onChange={(e) => setDrafts((p) => ({ ...p, [type]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(type, drafts[type] ?? '');
                  setDrafts((p) => ({ ...p, [type]: '' }));
                }
              }}
              placeholder={`Ajouter — Entrée pour valider`}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
            />
            <datalist id={`ents-${type}`}>
              {entitiesOfType(type).map((e) => (
                <option key={e.slug} value={e.label} />
              ))}
            </datalist>

            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {suggestions.slice(0, 8).map((e) => (
                  <button
                    key={e.slug}
                    type="button"
                    onClick={() => add(type, e.label)}
                    className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
                  >
                    + {e.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
