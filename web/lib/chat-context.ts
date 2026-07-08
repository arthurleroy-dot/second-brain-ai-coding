import { ResourceType, Source } from '@/types';
import { ALL_TYPES, TYPE_TO_FOLDER } from '@/lib/ui';
import {
  getResource,
  listAllSources,
  listEntities,
  listTopics,
} from '@/lib/wiki-parser';
import { stripChunkAnnotations } from '@/lib/wiki-md';

// Filtres du panneau de chat (mêmes champs que ChatFilters de wiki-query, gardés
// ici pour éviter une dépendance circulaire).
export interface ChatFilters {
  types?: string[];
  authors?: string[];
  date?: { mode: 'between' | 'before' | 'after'; from?: string; to?: string };
  topic?: string;
}

const CONTEXT_BUDGET = 80_000; // caractères max concaténés
const MAX_SOURCES = 6;

function resolveTypeLocal(value: string): ResourceType | null {
  if ((ALL_TYPES as string[]).includes(value)) return value as ResourceType;
  const entry = (Object.entries(TYPE_TO_FOLDER) as [ResourceType, string][]).find(
    ([, folder]) => folder === value,
  );
  return entry ? entry[0] : null;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Applique les filtres durs du panneau (type / auteur / date / topic). */
function passesFilters(s: Source, filters?: ChatFilters): boolean {
  if (!filters) return true;

  if (filters.types?.length) {
    const wanted = filters.types
      .map(resolveTypeLocal)
      .filter((t): t is ResourceType => !!t);
    if (wanted.length && !wanted.includes(s.type)) return false;
  }

  if (filters.authors?.length) {
    const name = s.author;
    const wantsUnknown = filters.authors.includes('unknown');
    const named = filters.authors.filter((a) => a !== 'unknown');
    const matchNamed = name != null && named.some((a) => a === name);
    const matchUnknown = wantsUnknown && name == null;
    if (!matchNamed && !matchUnknown) return false;
  }

  if (filters.topic && !s.topics.includes(filters.topic)) return false;

  if (filters.date && s.date) {
    const { mode, from, to } = filters.date;
    if ((mode === 'after' || mode === 'between') && from && s.date < from) return false;
    if ((mode === 'before' || mode === 'between') && to && s.date > `${to}-31`) return false;
  }
  return true;
}

/**
 * Sélectionne le contexte pertinent depuis le wiki markdown (lecture par
 * paliers, cf. docs/wiki-spec.md §7) et le concatène pour le prompt système.
 * `detectionText` = intégralité de la conversation (pas seulement le dernier msg).
 */
export async function getRelevantContext(
  message: string,
  filters?: ChatFilters,
  detectionText?: string,
): Promise<{ context: string; sources: Source[] }> {
  const all = await listAllSources();
  const candidates = all.filter((s) => passesFilters(s, filters));
  if (candidates.length === 0) return { context: '', sources: [] };

  const text = norm(detectionText ?? message);

  // Entités mentionnées dans la conversation (via label/aliases du registre).
  const entities = await listEntities();
  const mentionedEntities = new Set(
    entities
      .filter((e) => [e.label, ...e.aliases].some((a) => a && text.includes(norm(a))))
      .map((e) => e.slug),
  );

  // Thèmes mentionnés (slug ou label).
  const topics = await listTopics();
  const mentionedTopics = new Set(
    topics
      .filter(
        (t) =>
          text.includes(norm(t.slug.replace(/-/g, ' '))) || text.includes(norm(t.title)),
      )
      .map((t) => t.slug),
  );

  // Score chaque candidat.
  const scored = candidates.map((s) => {
    let score = 0;
    if (s.entities?.some((e) => mentionedEntities.has(e))) score += 5;
    if (s.author && text.includes(norm(s.author))) score += 5;
    if (s.topics.some((t) => mentionedTopics.has(t))) score += 3;
    if (text.includes(norm(s.title))) score += 4;
    // Recouvrement de mots-clés du titre.
    const words = norm(s.title).split(/\s+/).filter((w) => w.length > 4);
    if (words.some((w) => text.includes(w))) score += 1;
    return { s, score };
  });

  const hasSignal = scored.some((x) => x.score > 0);
  const ranked = hasSignal
    ? scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
    : // Aucun signal : repli sur les plus récentes (candidats déjà triés par date).
      scored.slice(0, MAX_SOURCES);

  // Construit le contexte dans la limite du budget de caractères.
  const picked: Source[] = [];
  const blocks: string[] = [];
  let used = 0;
  for (const { s } of ranked) {
    if (picked.length >= MAX_SOURCES) break;
    const parsed = await getResource(s.slug);
    if (!parsed) continue;
    const body = stripChunkAnnotations(parsed.body).trim();
    const block = `=== ${s.title} (${s.type} — ${s.author ?? 'auteur inconnu'} — ${
      s.date ?? 'date inconnue'
    }) ===\n${body}`;
    if (used + block.length > CONTEXT_BUDGET && picked.length > 0) break;
    blocks.push(block.slice(0, CONTEXT_BUDGET));
    picked.push(s);
    used += block.length;
  }

  return { context: blocks.join('\n\n---\n\n'), sources: picked };
}
