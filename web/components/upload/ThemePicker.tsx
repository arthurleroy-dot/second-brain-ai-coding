'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Gran } from './LinkPicker';
import { addName, mergeThemeDraft } from '@/lib/upload-drafts';

interface ThemeInfo {
  slug: string;
  label: string;
}

// Poignée impérative symétrique de LinkPickerHandle : `flush()` fusionne le
// brouillon de thème tapé mais non validé et retourne la liste à jour au submit.
export type ThemePickerHandle = { flush: () => string[] };

interface ThemePickerProps {
  value: string[];
  onChange: (v: string[]) => void;
  granularity: Gran;
  onGranularityChange: (v: Gran) => void;
}

/**
 * Sélecteur de thèmes à l'upload. Version aplatie de LinkPicker (les thèmes
 * n'ont pas de dimension `type`) : autocomplétion des thèmes existants (via
 * /api/themes) + saisie d'un nouveau thème à la volée, réutilisable ensuite.
 * Valeur = liste de noms (l'agent slugifie et crée/relie selon docs/entities.md).
 * Un bouton `+` (même UI que LinkPicker) ajoute un thème sans dépendre d'Entrée,
 * et la granularité (indice pour l'agent) vit DANS le cadre, comme pour les liens.
 */
const ThemePicker = forwardRef<ThemePickerHandle, ThemePickerProps>(function ThemePicker(
  { value, onChange, granularity, onGranularityChange },
  ref,
) {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => {});
  }, []);

  const add = (name: string) => {
    const next = addName(value, name); // trim + dédup casse-insensible (helper partagé)
    if (next === value) return; // vide ou doublon : rien à ajouter
    onChange(next);
  };
  const remove = (name: string) => onChange(value.filter((x) => x !== name));

  const commitDraft = () => {
    add(draft);
    setDraft('');
  };

  // Ramasse au submit le brouillon tapé mais non validé (cf. ThemePickerHandle).
  const flush = (): string[] => {
    const merged = mergeThemeDraft(value, draft);
    onChange(merged); // cohérence UI : le brouillon devient une puce
    setDraft('');
    return merged; // valeur synchrone consommée par submit()
  };
  useImperativeHandle(ref, () => ({ flush }), [value, draft]);

  // Thèmes existants non encore sélectionnés (proposés en chips rapides).
  const suggestions = themes.filter(
    (t) => !value.some((s) => s.toLowerCase() === t.label.toLowerCase() || s.toLowerCase() === t.slug),
  );

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <span className="text-xs font-medium text-gray-600">Thèmes (optionnel)</span>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
            >
              {name}
              <button type="button" onClick={() => remove(name)} aria-label={`Retirer ${name}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          list="theme-options"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder="Ajouter un thème — + ou Entrée pour valider"
          className="w-full rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
        />
        <button
          type="button"
          onClick={commitDraft}
          aria-label="Ajouter le thème"
          className="shrink-0 rounded-lg border border-gray-300 p-1.5 text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
        >
          <Plus size={14} />
        </button>
      </div>
      {draft.trim() && (
        <p className="text-[11px] text-gray-400">
          « {draft.trim()} » sera pris en compte au dépôt.
        </p>
      )}
      <datalist id="theme-options">
        {themes.map((t) => (
          <option key={t.slug} value={t.label} />
        ))}
      </datalist>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.slice(0, 10).map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => add(t.label)}
              className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
            >
              + {t.label}
            </button>
          ))}
        </div>
      )}

      {value.length > 0 && (
        <label className="block text-[11px] text-gray-500">
          Granularité
          <select
            value={granularity}
            onChange={(e) => onGranularityChange(e.target.value as Gran)}
            className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1 text-[11px]"
          >
            <option value="auto">Auto (l'agent décide)</option>
            <option value="resource">Ressource entière</option>
            <option value="chunk">Sections concernées</option>
          </select>
        </label>
      )}

      <p className="text-[11px] text-gray-400">
        Un thème inédit sera créé et réutilisable par les autres. Laisse vide :
        l'agent déduit les thèmes du contenu.
      </p>
    </div>
  );
});
ThemePicker.displayName = 'ThemePicker';

export default ThemePicker;
