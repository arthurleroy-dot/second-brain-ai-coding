import { SupabaseClient } from '@supabase/supabase-js';
import { ChatFilterState, ResourceType, Source } from '@/types';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { ALL_TYPES, TYPE_TO_FOLDER, typeLabel } from '@/lib/ui';
import {
  getSourceDetail,
  listAllSources,
  listAuthors,
  listDates,
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

// ---------------------------------------------------------------------------
// Chat — sélection du contexte.
// TRANSITOIRE : encore basé sur Supabase. Réécrit en lecture markdown en phase 6
// (docs/platform.md §5). Renvoie un contexte vide si Supabase n'est pas configuré.
// ---------------------------------------------------------------------------

function readClient(): SupabaseClient | null {
  return supabaseAdmin ?? supabase ?? null;
}

function rowToSource(r: any): Source {
  const title = r.title ?? '(sans titre)';
  return {
    id: r.id,
    slug: r.slug ?? slugify(title),
    title,
    type: (r.type as ResourceType) ?? 'unknown',
    author: r.author ?? null,
    date: r.date ?? null,
    url: r.url ?? null,
    deposited_by: r.deposited_by ?? null,
    topics: Array.isArray(r.topics) ? r.topics : [],
    needs_review: r.needs_review === true,
    status: r.status,
    created_at: r.created_at,
  };
}

export async function getRelevantContext(
  message: string,
  filters?: ChatFilters,
  detectionText?: string,
): Promise<{ context: string; sources: Source[] }> {
  const db = readClient();
  if (!db) return { context: '', sources: [] };

  const lower = (detectionText ?? message).toLowerCase();

  let query = db
    .from('resources')
    .select('*, resource_content(*)')
    .eq('status', 'done');

  if (filters?.types?.length) {
    const resolved = filters.types
      .map((f) => resolveType(f))
      .filter((t): t is ResourceType => !!t);
    if (resolved.length) query = query.in('type', resolved);
  }
  if (filters?.topic) query = query.contains('topics', [filters.topic]);

  const explicitAuthor = !!filters?.authors?.length;
  if (explicitAuthor) {
    const names = filters!.authors!.filter((a) => a !== 'unknown');
    const wantsUnknown = filters!.authors!.includes('unknown');
    const ors: string[] = [];
    if (names.length) {
      const quoted = names.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',');
      ors.push(`author.in.(${quoted})`);
    }
    if (wantsUnknown) ors.push('author.is.null');
    if (ors.length) query = query.or(ors.join(','));
  }

  if (filters?.date) {
    const { mode, from, to } = filters.date;
    if ((mode === 'after' || mode === 'between') && from) query = query.gte('date', from);
    if ((mode === 'before' || mode === 'between') && to) query = query.lte('date', `${to}-31`);
  }

  if (!explicitAuthor) {
    const { data: authorRows } = await db
      .from('resources')
      .select('author')
      .eq('status', 'done');
    const authors = [
      ...new Set((authorRows ?? []).map((r: any) => r.author).filter(Boolean)),
    ] as string[];
    const mentioned = authors.find((a) => lower.includes(a.toLowerCase()));
    if (mentioned) query = query.eq('author', mentioned);
  }

  const { data, error } = await query.limit(5);
  if (error || !data) return { context: '', sources: [] };

  const sources = data.map(rowToSource);
  const context = data
    .map((r: any) => {
      const content = Array.isArray(r.resource_content)
        ? r.resource_content[0]
        : r.resource_content;
      const body = content?.full_content ?? content?.summary ?? '';
      return `=== ${r.title} (${r.type} — ${r.author ?? 'auteur inconnu'} — ${
        r.date ?? 'date inconnue'
      }) ===\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  return { context, sources };
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
