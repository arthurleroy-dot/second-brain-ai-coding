'use client';

import { useEffect, useState } from 'react';

interface ThemeInfo {
  slug: string;
  label: string;
}

/**
 * Sélecteur de thèmes à l'upload. Version aplatie de LinkPicker (les thèmes
 * n'ont pas de dimension `type`) : autocomplétion des thèmes existants (via
 * /api/themes) + saisie d'un nouveau thème à la volée, réutilisable ensuite.
 * Valeur = liste de noms (l'agent slugifie et crée/relie selon docs/entities.md).
 */
export default function ThemePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => {});
  }, []);

  const add = (name: string) => {
    const n = name.trim();
    if (!n) return;
    if (value.some((x) => x.toLowerCase() === n.toLowerCase())) return;
    onChange([...value, n]);
  };
  const remove = (name: string) => onChange(value.filter((x) => x !== name));

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
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        list="theme-options"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
            setDraft('');
          }
        }}
        placeholder="Choisir un thème existant ou en créer un — Entrée pour valider"
        className="w-full rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
      />
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

      <p className="text-[11px] text-gray-400">
        Un thème inédit sera créé et réutilisable par les autres. Laisse vide :
        l'agent déduit les thèmes du contenu.
      </p>
    </div>
  );
}
