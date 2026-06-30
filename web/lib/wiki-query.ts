import { SupabaseClient } from '@supabase/supabase-js';
import {
  AuthorEntry,
  ChatFilterState,
  DateEntry,
  ResourceContent,
  ResourceType,
  Source,
  TypeEntry,
  WikiTopic,
} from '@/types';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { ALL_TYPES, TYPE_TO_FOLDER, typeLabel } from '@/lib/ui';

// Filtres reçus du panneau de chat (multi-sélection type/auteur + date
// structurée), plus le filtre `topic` interne.
export interface ChatFilters extends ChatFilterState {
  topic?: string;
}

/** Client de lecture côté serveur : service role en priorité, sinon anon. */
function readClient(): SupabaseClient | null {
  return supabaseAdmin ?? supabase ?? null;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Résout un filtre `type` (ResourceType ou dossier) vers un ResourceType. */
export function resolveType(value: string): ResourceType | null {
  if ((ALL_TYPES as string[]).includes(value)) return value as ResourceType;
  const entry = (Object.entries(TYPE_TO_FOLDER) as [ResourceType, string][]).find(
    ([, folder]) => folder === value,
  );
  return entry ? entry[0] : null;
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

/** Toutes les ressources traitées (status='done'), triées par date décroissante. */
export async function listSources(): Promise<Source[]> {
  const db = readClient();
  if (!db) return [];
  const { data, error } = await db
    .from('resources')
    .select('*')
    .eq('status', 'done');
  if (error || !data) return [];
  return data
    .map(rowToSource)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SourceDetail {
  source: Source;
  storage_path: string | null;
  content: ResourceContent | null;
}

function rowToContent(row: any): ResourceContent | null {
  const c = Array.isArray(row) ? row[0] : row;
  if (!c) return null;
  return {
    summary: c.summary ?? null,
    full_content: c.full_content ?? null,
    key_concepts: Array.isArray(c.key_concepts) ? c.key_concepts : [],
    notable_quotes: Array.isArray(c.notable_quotes) ? c.notable_quotes : [],
    key_figures: Array.isArray(c.key_figures) ? c.key_figures : [],
  };
}

/**
 * Récupère une ressource (métadonnées + contenu traité + chemin Storage).
 * `idOrSlug` accepte un uuid (colonne `id`) ou un slug.
 */
export async function getSourceDetail(
  idOrSlug: string,
): Promise<SourceDetail | null> {
  const db = readClient();
  if (!db) return null;

  const column = UUID_RE.test(idOrSlug) ? 'id' : 'slug';
  const { data, error } = await db
    .from('resources')
    .select('*, resource_content(*)')
    .eq(column, idOrSlug)
    .maybeSingle();
  if (error || !data) return null;

  return {
    source: rowToSource(data),
    storage_path: data.storage_path ?? null,
    content: rowToContent(data.resource_content),
  };
}

/**
 * Génère une URL signée (bucket privé `raw-files`) valable 1h.
 * `download` force le téléchargement avec le nom de fichier donné.
 */
export async function createRawFileSignedUrl(
  storagePath: string,
  download?: string,
): Promise<string | null> {
  const db = readClient();
  if (!db) return null;
  const { data, error } = await db.storage
    .from('raw-files')
    .createSignedUrl(storagePath, 60 * 60, download ? { download } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Pages thématiques avec compteur de sources. */
export async function listTopics(): Promise<WikiTopic[]> {
  const db = readClient();
  if (!db) return [];
  const { data: topicRows } = await db.from('topics').select('slug, title');
  const sources = await listSources();

  const topics: WikiTopic[] = (topicRows ?? []).map((t: any) => {
    const matched = sources.filter((s) => s.topics.includes(t.slug));
    return {
      slug: t.slug,
      title: t.title ?? t.slug,
      source_count: matched.length,
      sources: matched,
      last_updated: null,
    };
  });

  return topics.sort((a, b) => a.title.localeCompare(b.title));
}

/** Auteurs distincts (parmi les ressources traitées) avec compteurs. */
export async function listAuthors(): Promise<AuthorEntry[]> {
  const sources = await listSources();
  const byAuthor = new Map<string, { name: string; count: number }>();

  for (const s of sources) {
    const name = s.author ?? 'unknown';
    const slug = name === 'unknown' ? 'unknown' : slugify(name);
    const cur = byAuthor.get(slug) ?? {
      name: name === 'unknown' ? 'Auteur inconnu' : name,
      count: 0,
    };
    cur.count += 1;
    byAuthor.set(slug, cur);
  }

  return [...byAuthor.entries()]
    .map(([slug, v]) => ({ slug, name: v.name, source_count: v.count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Types de ressource distincts (parmi les ressources traitées) avec compteurs. */
export async function listTypes(): Promise<TypeEntry[]> {
  const sources = await listSources();
  const counts = new Map<ResourceType, number>();

  for (const s of sources) {
    const t = (s.type as ResourceType) ?? 'unknown';
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  // Conserve l'ordre canonique d'ALL_TYPES ; n'expose que les types présents.
  return ALL_TYPES.filter((t) => counts.has(t)).map((t) => ({
    type: t,
    folder: TYPE_TO_FOLDER[t],
    label: typeLabel(t),
    source_count: counts.get(t) ?? 0,
  }));
}

/** Entrées de date (par mois, par année sans mois, et inconnu). */
export async function listDates(): Promise<DateEntry[]> {
  const sources = await listSources();
  const months = new Map<string, number>(); // "YYYY-MM" -> count
  const yearsOnly = new Map<string, number>(); // "YYYY" -> count (date == année seule)
  let unknown = 0;

  for (const s of sources) {
    const d = s.date;
    if (!d) {
      unknown += 1;
    } else if (d.length >= 7) {
      const ym = d.slice(0, 7);
      months.set(ym, (months.get(ym) ?? 0) + 1);
    } else {
      const y = d.slice(0, 4);
      yearsOnly.set(y, (yearsOnly.get(y) ?? 0) + 1);
    }
  }

  const entries: DateEntry[] = [];
  for (const [ym, count] of months) {
    entries.push({
      year: ym.slice(0, 4),
      month: ym,
      label: ym,
      source_count: count,
      is_unknown: false,
    });
  }
  for (const [y, count] of yearsOnly) {
    entries.push({
      year: y,
      month: null,
      label: `${y} (mois inconnu)`,
      source_count: count,
      is_unknown: true,
    });
  }
  if (unknown > 0) {
    entries.push({
      year: 'unknown',
      month: null,
      label: 'Date inconnue',
      source_count: unknown,
      is_unknown: true,
    });
  }

  return entries.sort((a, b) =>
    (b.month ?? b.year).localeCompare(a.month ?? a.year),
  );
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
    const labels = filters.authors.map((a) =>
      a === 'unknown' ? 'auteur inconnu' : a,
    );
    parts.push(`auteur ∈ {${labels.join(', ')}}`);
  }
  if (filters.date) {
    const { mode, from, to } = filters.date;
    if (mode === 'between' && (from || to)) {
      parts.push(`date entre ${from ?? '…'} et ${to ?? '…'}`);
    } else if (mode === 'after' && from) {
      parts.push(`date ≥ ${from}`);
    } else if (mode === 'before' && to) {
      parts.push(`date ≤ ${to}`);
    }
  }
  if (filters.topic) parts.push(`thème = ${filters.topic}`);

  return parts.join(' ; ');
}

/**
 * Trouve les ressources pertinentes pour une question et renvoie un contexte
 * textuel concaténé (full_content) à injecter dans le system prompt du chat.
 *
 * `detectionText` permet de détecter les entités (auteurs, titres, types, dates)
 * sur l'intégralité de l'historique de conversation et non seulement le dernier
 * message. S'il est absent, on retombe sur `message`.
 */
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

  // Filtre type (panneau droit) — multi-sélection (OR intra-axe)
  if (filters?.types?.length) {
    const resolved = filters.types
      .map((f) => resolveType(f))
      .filter((t): t is ResourceType => !!t);
    if (resolved.length) query = query.in('type', resolved);
  }

  // Filtre topic explicite
  if (filters?.topic) {
    query = query.contains('topics', [filters.topic]);
  }

  // Filtre auteur (panneau droit) — multi-sélection (OR), 'unknown' = author NULL
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

  // Filtre date (panneau droit) : intervalle / avant / après.
  // Comparaison lexicographique sur 'YYYY[-MM[-DD]]' ; borne haute étendue à
  // '-31' pour inclure tout le mois choisi.
  if (filters?.date) {
    const { mode, from, to } = filters.date;
    if ((mode === 'after' || mode === 'between') && from) {
      query = query.gte('date', from);
    }
    if ((mode === 'before' || mode === 'between') && to) {
      query = query.lte('date', `${to}-31`);
    }
  }

  // Heuristique auteur : si un nom d'auteur connu apparaît dans la question.
  // Ignorée quand un filtre auteur explicite est déjà appliqué.
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
