import { ChatFilterState, OriginValue, ResourceType, Source } from '@/types';
import { ALL_TYPES, TYPE_TO_FOLDER, originLabel, typeLabel } from '@/lib/ui';
import {
  getSourceDetail,
  listAllSources,
  listAuthors,
  listDates,
  listOrigins,
  listTopics,
  listTypes,
  slugify,
} from '@/lib/wiki-parser';

// Façade de lecture du wiki : le contenu vit dans les fichiers markdown
// (wiki/), lus par wiki-parser. On ré-exporte sous les mêmes noms que
// l'ancienne couche Supabase pour ne pas toucher les pages/routes.
export {
  slugify,
  getSourceDetail,
  listTopics,
  listAuthors,
  listTypes,
  listOrigins,
  listDates,
};
export type { SourceDetail } from '@/lib/wiki-parser';

/** Toutes les ressources (alias fs de l'ancien listSources Supabase). */
export const listSources = listAllSources;

// Filtres reçus du panneau de chat + filtre `topic` interne.
export interface ChatFilters extends ChatFilterState {
  topic?: string;
}

/** Résout un filtre `type` (ResourceType ou ancien libellé de dossier) → ResourceType. */
export function resolveType(value: string): ResourceType | null {
  if ((ALL_TYPES as string[]).includes(value)) return value as ResourceType;
  const entry = (Object.entries(TYPE_TO_FOLDER) as [ResourceType, string][]).find(
    ([, folder]) => folder === value,
  );
  return entry ? entry[0] : null;
}

/** Décrit les filtres actifs en une phrase lisible (pour le prompt système). */
export function describeChatFilters(filters?: ChatFilters): string {
  if (!filters) return '';
  const parts: string[] = [];
  if (filters.types?.length) {
    const labels = filters.types.map((f) => {
      const t = resolveType(f);
      return t ? typeLabel(t) : f;
    });
    parts.push(`type ∈ {${labels.join(', ')}}`);
  }
  if (filters.authors?.length) {
    const labels = filters.authors.map((a) => (a === 'unknown' ? 'auteur inconnu' : a));
    parts.push(`auteur ∈ {${labels.join(', ')}}`);
  }
  if (filters.origins?.length) {
    const labels = filters.origins.map((o) => originLabel(o as OriginValue));
    parts.push(`origine ∈ {${labels.join(', ')}}`);
  }
  if (filters.date) {
    const { mode, from, to } = filters.date;
    if (mode === 'between' && (from || to)) parts.push(`date entre ${from ?? '…'} et ${to ?? '…'}`);
    else if (mode === 'after' && from) parts.push(`date ≥ ${from}`);
    else if (mode === 'before' && to) parts.push(`date ≤ ${to}`);
  }
  if (filters.topic) parts.push(`thème = ${filters.topic}`);
  return parts.join(' ; ');
}

/**
 * Extrait le bloc `SOURCES: [...]` de la réponse de Claude, le retire du texte,
 * et renvoie le texte propre + les sources parsées.
 */
export function parseResponse(raw: string): { text: string; sources: Source[] } {
  const idx = raw.search(/SOURCES\s*:/i);
  if (idx === -1) return { text: raw.trim(), sources: [] };

  const text = raw.slice(0, idx).trim();
  const after = raw.slice(idx).replace(/^SOURCES\s*:/i, '').trim();

  let sources: Source[] = [];
  try {
    const start = after.indexOf('[');
    const end = after.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      const parsed = JSON.parse(after.slice(start, end + 1));
      if (Array.isArray(parsed)) sources = parsed.map(normalizeSource);
    }
  } catch {
    // bloc SOURCES malformé → on ignore les sources mais on garde le texte
  }

  return { text, sources };
}

function normalizeSource(s: any): Source {
  const title = String(s?.title ?? s?.slug ?? 'Source');
  return {
    slug: String(s?.slug ?? slugify(title)),
    title,
    type: (s?.type as ResourceType) ?? 'unknown',
    author: s?.author ?? null,
    date: s?.date ?? null,
    url: s?.url ?? null,
    deposited_by: null,
    topics: Array.isArray(s?.topics) ? s.topics : [],
    needs_review: false,
  };
}
