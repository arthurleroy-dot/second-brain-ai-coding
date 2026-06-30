'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Upload, X } from 'lucide-react';
import {
  AuthorEntry,
  ChatFilterState,
  DateFilter,
  DateFilterMode,
  TypeEntry,
} from '@/types';
import { useUpload } from '@/components/UploadProvider';

interface Props {
  filters: ChatFilterState;
  onChange: (next: ChatFilterState) => void;
}

// Valeur de filtre envoyée au backend pour un auteur ('unknown' = auteur null).
const authorValue = (a: AuthorEntry) => (a.slug === 'unknown' ? 'unknown' : a.name);

type OpenMenu = 'type' | 'author' | 'date' | null;

export default function RightPanel({ filters, onChange }: Props) {
  const [types, setTypes] = useState<TypeEntry[]>([]);
  const [authors, setAuthors] = useState<AuthorEntry[]>([]);
  const [open, setOpen] = useState<OpenMenu>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { openPicker, uploading, lastResult } = useUpload();

  useEffect(() => {
    fetch('/api/explore')
      .then((r) => r.json())
      .then((d) => {
        setTypes(d.types ?? []);
        setAuthors(d.authors ?? []);
      })
      .catch(() => {});
  }, [lastResult]);

  // Ferme le menu ouvert au clic en dehors du panneau.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Bascule une valeur dans un axe multi-sélection (type ou auteur).
  const toggle = (axis: 'types' | 'authors', value: string) => {
    const cur = filters[axis] ?? [];
    const next = cur.includes(value)
      ? cur.filter((v) => v !== value)
      : [...cur, value];
    onChange({ ...filters, [axis]: next.length ? next : undefined });
  };

  const typeItems = types.map((t) => ({
    value: t.folder,
    label: t.label,
    count: t.source_count,
  }));
  const authorItems = authors.map((a) => ({
    value: authorValue(a),
    label: a.name,
    count: a.source_count,
  }));

  const typeLabelOf = (folder: string) =>
    types.find((t) => t.folder === folder)?.label ?? folder;
  const authorLabelOf = (value: string) =>
    value === 'unknown' ? 'Auteur inconnu' : value;

  const hasFilters =
    (filters.types?.length ?? 0) > 0 ||
    (filters.authors?.length ?? 0) > 0 ||
    !!filters.date;

  return (
    <aside
      ref={rootRef}
      className="flex w-[230px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-gray-200 bg-white p-3 text-xs"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800">Filtres</h2>
        {hasFilters && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-[11px] text-gray-400 hover:text-gray-700"
          >
            Tout effacer
          </button>
        )}
      </div>

      <SelectMenu
        label="Type"
        placeholder="Tous les types"
        items={typeItems}
        selected={filters.types ?? []}
        onToggle={(v) => toggle('types', v)}
        isOpen={open === 'type'}
        onToggleOpen={() => setOpen((o) => (o === 'type' ? null : 'type'))}
      />

      <SelectMenu
        label="Auteur"
        placeholder="Tous les auteurs"
        items={authorItems}
        selected={filters.authors ?? []}
        onToggle={(v) => toggle('authors', v)}
        isOpen={open === 'author'}
        onToggleOpen={() => setOpen((o) => (o === 'author' ? null : 'author'))}
      />

      <DateMenu
        value={filters.date}
        onChange={(d) => onChange({ ...filters, date: d })}
        isOpen={open === 'date'}
        onToggleOpen={() => setOpen((o) => (o === 'date' ? null : 'date'))}
      />

      {hasFilters && (
        <div>
          <h3 className="mb-1.5 font-semibold text-gray-700">Sélection</h3>
          <div className="flex flex-wrap gap-1.5">
            {(filters.types ?? []).map((v) => (
              <Chip
                key={`t-${v}`}
                label={typeLabelOf(v)}
                onRemove={() => toggle('types', v)}
              />
            ))}
            {(filters.authors ?? []).map((v) => (
              <Chip
                key={`a-${v}`}
                label={authorLabelOf(v)}
                onRemove={() => toggle('authors', v)}
              />
            ))}
            {filters.date && (
              <Chip
                label={describeDate(filters.date)}
                onRemove={() => onChange({ ...filters, date: undefined })}
              />
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={openPicker}
        disabled={uploading}
        className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        <Upload size={14} />
        {uploading ? 'Envoi…' : 'Déposer une source'}
      </button>
      {lastResult && (
        <p className={`text-[10px] ${lastResult.ok ? 'text-green-600' : 'text-red-600'}`}>
          {lastResult.message}
        </p>
      )}
    </aside>
  );
}

interface MenuItem {
  value: string;
  label: string;
  count: number;
}

// Menu déroulant multi-sélection avec recherche interne (type, auteur).
function SelectMenu({
  label,
  placeholder,
  items,
  selected,
  onToggle,
  isOpen,
  onToggleOpen,
}: {
  label: string;
  placeholder: string;
  items: MenuItem[];
  selected: string[];
  onToggle: (value: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = q
    ? items.filter((it) => it.label.toLowerCase().includes(q.toLowerCase()))
    : items;
  const summary =
    selected.length === 0
      ? placeholder
      : `${selected.length} sélectionné${selected.length > 1 ? 's' : ''}`;

  return (
    <div>
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-2.5 py-1.5 text-left hover:border-gray-300"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            {label}
          </span>
          <span className={`truncate ${selected.length ? 'text-gray-800' : 'text-gray-400'}`}>
            {summary}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-sm">
          <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1">
            <Search size={12} className="shrink-0 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="w-full bg-transparent text-xs outline-none"
              autoFocus
            />
          </div>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-1.5 py-1 text-gray-400">Aucun résultat.</li>
            )}
            {filtered.map((it) => {
              const checked = selected.includes(it.value);
              return (
                <li key={it.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(it.value)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1 truncate text-gray-700">{it.label}</span>
                    <span className="text-gray-400">{it.count}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Menu déroulant date : intervalle, avant une borne, ou après une borne.
function DateMenu({
  value,
  onChange,
  isOpen,
  onToggleOpen,
}: {
  value: DateFilter | undefined;
  onChange: (d: DateFilter | undefined) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  const [mode, setMode] = useState<DateFilterMode>(value?.mode ?? 'between');

  // Resynchronise le mode local si la valeur externe change (ex : « Tout effacer »).
  useEffect(() => {
    setMode(value?.mode ?? 'between');
  }, [value?.mode]);

  // Émet un filtre normalisé : bornes inutiles au mode courant retirées ;
  // aucune borne => pas de filtre date.
  const emit = (m: DateFilterMode, from?: string, to?: string) => {
    const f = m === 'before' ? undefined : from || undefined;
    const t = m === 'after' ? undefined : to || undefined;
    if (!f && !t) onChange(undefined);
    else onChange({ mode: m, from: f, to: t });
  };

  const onMode = (m: DateFilterMode) => {
    setMode(m);
    emit(m, value?.from, value?.to);
  };

  const MODES: { m: DateFilterMode; label: string }[] = [
    { m: 'between', label: 'Intervalle' },
    { m: 'before', label: 'Avant' },
    { m: 'after', label: 'Après' },
  ];

  const monthInput = (
    placeholder: string,
    val: string | undefined,
    onVal: (v: string) => void,
  ) => (
    <label className="flex flex-1 flex-col gap-0.5">
      <span className="text-[10px] text-gray-400">{placeholder}</span>
      <input
        type="month"
        value={val ?? ''}
        onChange={(e) => onVal(e.target.value)}
        className="rounded-md border border-gray-200 px-1.5 py-1 text-xs text-gray-700 outline-none focus:border-gray-400"
      />
    </label>
  );

  return (
    <div>
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-2.5 py-1.5 text-left hover:border-gray-300"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Date
          </span>
          <span className={`truncate ${value ? 'text-gray-800' : 'text-gray-400'}`}>
            {value ? describeDate(value) : 'Toutes les dates'}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="mt-1 space-y-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
          <div className="flex gap-1">
            {MODES.map(({ m, label }) => (
              <button
                key={m}
                type="button"
                onClick={() => onMode(m)}
                className={`flex-1 rounded-md px-1.5 py-1 text-[11px] ${
                  mode === m
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {mode === 'between' && (
              <>
                {monthInput('De', value?.from, (v) => emit('between', v, value?.to))}
                {monthInput('À', value?.to, (v) => emit('between', value?.from, v))}
              </>
            )}
            {mode === 'after' &&
              monthInput('À partir de', value?.from, (v) => emit('after', v, undefined))}
            {mode === 'before' &&
              monthInput('Jusqu’à', value?.to, (v) => emit('before', undefined, v))}
          </div>
        </div>
      )}
    </div>
  );
}

function describeDate(d: DateFilter): string {
  if (d.mode === 'after' && d.from) return `Après ${d.from}`;
  if (d.mode === 'before' && d.to) return `Avant ${d.to}`;
  if (d.mode === 'between') {
    if (d.from && d.to) return `${d.from} → ${d.to}`;
    if (d.from) return `Depuis ${d.from}`;
    if (d.to) return `Jusqu’à ${d.to}`;
  }
  return 'Date';
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2 pr-1 text-[11px] text-gray-700">
      <span className="max-w-[140px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${label}`}
        className="rounded-full p-0.5 text-gray-500 hover:bg-gray-300/60 hover:text-gray-800"
      >
        <X size={10} />
      </button>
    </span>
  );
}
