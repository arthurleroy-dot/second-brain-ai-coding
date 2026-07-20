'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { entityTypeLabel } from '@/lib/ui';
import ConfirmDialog from '@/components/ConfirmDialog';

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
// Granularité par type de lien, déclarée à l'upload (indice pour l'agent d'ingestion).
export type Gran = 'auto' | 'resource' | 'chunk';

// Valeur sentinelle du menu déroulant pour « créer un nouveau type ».
const NEW_TYPE = '__new__';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Sélecteur de liens TYPÉS. Flux délibéré : on choisit d'abord un type de lien via un
 * menu déroulant (types du registre + création d'un nouveau type, confirmée), puis une
 * carte apparaît pour saisir les entités de ce type (autocomplétion des entités connues
 * + création libre) et régler leur granularité. Un « + » ajoute d'autres types.
 * Le registre s'auto-étend : les types déjà présents viennent de /api/entities.
 */
export default function LinkPicker({
  value,
  onChange,
  granularity,
  onGranularityChange,
}: {
  value: LinksValue;
  onChange: (v: LinksValue) => void;
  granularity: Record<string, Gran>;
  onGranularityChange: (v: Record<string, Gran>) => void;
}) {
  const [types, setTypes] = useState<TypeInfo[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  // Types créés à la volée cette session (persistés au registre seulement après ingestion).
  const [extraTypes, setExtraTypes] = useState<string[]>([]);
  // Types ayant une carte affichée — pilote le rendu (une carte peut être vide, et retirer
  // la dernière entité ne doit pas la fermer). Distinct de `value` (types non vides seuls).
  const [openTypes, setOpenTypes] = useState<string[]>(() => Object.keys(value));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // État du contrôle d'ajout en bas : replié / menu déroulant / saisie d'un nouveau type.
  const [addMode, setAddMode] = useState<'idle' | 'picking' | 'naming'>('idle');
  const [newType, setNewType] = useState('');
  // Slug d'un nouveau type en attente de confirmation (non-null → modale ouverte).
  const [pendingType, setPendingType] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/entities')
      .then((r) => r.json())
      .then((d) => {
        setTypes(d.types ?? []);
        setEntities(d.entities ?? []);
      })
      .catch(() => {});
  }, []);

  // Types proposables au menu déroulant = (registre ∪ créés) − déjà ouverts.
  const availableTypes = useMemo(() => {
    const open = new Set(openTypes);
    const all = [...new Set([...types.map((t) => t.slug), ...extraTypes])];
    return all.filter((s) => !open.has(s)).sort();
  }, [types, extraTypes, openTypes]);

  const entitiesOfType = (t: string) => entities.filter((e) => e.entity_type === t);

  const openCard = (type: string) => {
    setOpenTypes((p) => (p.includes(type) ? p : [...p, type]));
    setAddMode('idle');
  };

  const removeCard = (type: string) => {
    setOpenTypes((p) => p.filter((t) => t !== type));
    if (value[type]) {
      const next = { ...value };
      delete next[type];
      onChange(next);
    }
    if (granularity[type]) {
      const g = { ...granularity };
      delete g[type];
      onGranularityChange(g);
    }
  };

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
    else delete next[type]; // la carte reste ouverte via `openTypes`
    onChange(next);
  };

  // Choix dans le menu déroulant : type existant → carte ; sentinelle → saisie d'un nom.
  const onPick = (val: string) => {
    if (!val) return;
    if (val === NEW_TYPE) {
      setAddMode('naming');
      return;
    }
    openCard(val);
  };

  // Validation d'un nouveau type saisi : ouvre directement si déjà connu, sinon confirme.
  const submitNewType = () => {
    const slug = slugify(newType);
    if (!slug) return;
    const known = new Set([...types.map((t) => t.slug), ...extraTypes, ...openTypes]);
    if (known.has(slug)) {
      openCard(slug);
      setNewType('');
      return;
    }
    setPendingType(slug);
  };

  const confirmNewType = () => {
    const slug = pendingType!;
    setExtraTypes((p) => (p.includes(slug) ? p : [...p, slug]));
    openCard(slug);
    setPendingType(null);
    setNewType('');
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <span className="text-xs font-medium text-gray-600">Liens (optionnel)</span>

      {openTypes.length === 0 && (
        <p className="text-[11px] text-gray-400">
          Aucun type de lien. Ajoute-en un ci-dessous, ou laisse vide : l'agent détecte les
          entités connues.
        </p>
      )}

      {openTypes.map((type) => {
        const selected = value[type] ?? [];
        const suggestions = entitiesOfType(type).filter(
          (e) =>
            !selected.some(
              (s) => s.toLowerCase() === e.label.toLowerCase() || s.toLowerCase() === e.slug,
            ),
        );
        return (
          <div key={type} className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-2.5">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-medium text-gray-500">
                {entityTypeLabel(type)}
              </label>
              <button
                type="button"
                onClick={() => removeCard(type)}
                aria-label={`Retirer le type ${entityTypeLabel(type)}`}
                className="text-gray-300 hover:text-gray-600"
              >
                <X size={13} />
              </button>
            </div>

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
              placeholder="Ajouter une entité — Entrée pour valider"
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

            <label className="block text-[11px] text-gray-500">
              Granularité
              <select
                value={granularity[type] ?? 'auto'}
                onChange={(e) =>
                  onGranularityChange({ ...granularity, [type]: e.target.value as Gran })
                }
                className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1 text-[11px]"
              >
                <option value="auto">Auto (l'agent décide)</option>
                <option value="resource">Ressource entière</option>
                <option value="chunk">Sections concernées</option>
              </select>
            </label>
          </div>
        );
      })}

      {/* Contrôle d'ajout d'un type de lien */}
      {addMode === 'idle' && (
        <button
          type="button"
          onClick={() => setAddMode('picking')}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
        >
          <Plus size={12} /> Ajouter un type de lien
        </button>
      )}

      {addMode === 'picking' && (
        <div className="flex items-center gap-2">
          <select
            value=""
            autoFocus
            onChange={(e) => onPick(e.target.value)}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
          >
            <option value="" disabled>
              Choisir un type…
            </option>
            {availableTypes.map((slug) => (
              <option key={slug} value={slug}>
                {entityTypeLabel(slug)}
              </option>
            ))}
            <option value={NEW_TYPE}>➕ Créer un nouveau type…</option>
          </select>
          <button
            type="button"
            onClick={() => setAddMode('idle')}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            annuler
          </button>
        </div>
      )}

      {addMode === 'naming' && (
        <div className="flex items-center gap-2">
          <input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitNewType())}
            placeholder="ex : client"
            autoFocus
            className="w-32 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
          />
          <button type="button" onClick={submitNewType} className="text-[11px] font-medium text-[#0F6E56]">
            ok
          </button>
          <button
            type="button"
            onClick={() => {
              setAddMode('idle');
              setNewType('');
            }}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            annuler
          </button>
        </div>
      )}

      {pendingType && (
        <ConfirmDialog
          title="Créer un nouveau type de lien ?"
          message={`Créer le type de lien « ${entityTypeLabel(pendingType)} » ? Utilise un vocabulaire réutilisable par les autres — il sera proposé à tout le monde.`}
          confirmLabel="Créer le type"
          onConfirm={confirmNewType}
          onCancel={() => setPendingType(null)}
        />
      )}
    </div>
  );
}
