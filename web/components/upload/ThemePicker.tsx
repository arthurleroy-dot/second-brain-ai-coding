'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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

// Normalisation légère pour le filtrage : minuscule + suppression des diacritiques
// (accents), SANS slugifier — on garde espaces/ponctuation pour un `includes` naturel.
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Sélecteur de thèmes à l'upload. Champ de recherche + liste déroulante maison
 * (combobox) des thèmes existants (via /api/themes) : clic sur une ligne = ajout
 * immédiat en puce ; « + »/Entrée = création d'un thème inédit tapé. Valeur =
 * liste de noms (l'agent slugifie et crée/relie selon docs/entities.md).
 */
const ThemePicker = forwardRef<ThemePickerHandle, ThemePickerProps>(function ThemePicker(
  { value, onChange, granularity, onGranularityChange },
  ref,
) {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => {});
  }, []);

  // Ferme la liste au clic hors du composant. Le clic sur une ligne ou le « + »,
  // internes au conteneur, ne ferme donc pas → ajouts multiples enchaînables.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const add = (name: string) => {
    const next = addName(value, name); // trim + dédup casse-insensible (helper partagé)
    if (next === value) return; // vide ou doublon : rien à ajouter
    onChange(next);
  };
  const remove = (name: string) => onChange(value.filter((x) => x !== name));

  // « + » / Entrée : crée (ou re-sélectionne) le thème TAPÉ, puis vide le champ.
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

  // Thèmes existants non encore sélectionnés, filtrés par le texte tapé (insensible
  // à la casse ET aux accents). Pas de cap : la liste scrolle.
  const q = norm(draft);
  const options = themes.filter(
    (t) =>
      !value.some((s) => s.toLowerCase() === t.label.toLowerCase() || s.toLowerCase() === t.slug) &&
      (q === '' || norm(t.label).includes(q)),
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

      <div ref={boxRef} className="relative">
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setDraft(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="Ajouter un thème — + ou Entrée pour créer"
            className="w-full rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
          />
          <button
            type="button"
            onClick={commitDraft}
            aria-label="Créer le thème"
            className="shrink-0 rounded-lg border border-gray-300 p-1.5 text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
          >
            <Plus size={14} />
          </button>
        </div>

        {open && (
          <div className="absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {options.length > 0 ? (
              options.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => {
                    add(t.label);
                    setDraft(''); // vide le filtre, garde la liste ouverte pour enchaîner
                  }}
                  className="block w-full px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {t.label}
                </button>
              ))
            ) : (
              <p className="px-2.5 py-1.5 text-[11px] text-gray-400">
                {draft.trim() ? 'Aucun thème existant — + pour le créer.' : 'Aucun thème disponible.'}
              </p>
            )}
          </div>
        )}
      </div>

      {draft.trim() && (
        <p className="text-[11px] text-gray-400">
          « {draft.trim()} » sera pris en compte au dépôt.
        </p>
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
