import type { ChatFilterState, ResourceType, Source } from '@/types';
import { resolveType } from '@/lib/wiki-query';

/**
 * Validation dure des filtres du panneau de chat (module pur, testé).
 * Les dates du frontmatter ont une granularité mixte ("2026", "2026-04",
 * "2026-02-12") : une ressource passe un filtre date si son INTERVALLE de
 * dates possible intersecte l'intervalle du filtre.
 */

export interface DateInterval {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD (comparaison lexicale — "-31" suffit comme borne)
}

/** Intervalle de dates couvert par une date de frontmatter à granularité mixte. */
export function dateIntervalOf(date: string | null): DateInterval | null {
  if (!date) return null;
  if (/^\d{4}$/.test(date)) return { start: `${date}-01-01`, end: `${date}-12-31` };
  if (/^\d{4}-\d{2}$/.test(date)) return { start: `${date}-01`, end: `${date}-31` };
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return { start: date, end: date };
  return null; // format inattendu → traité comme date inconnue
}

/** Applique les filtres durs du panneau (type / auteur / origine / date). */
export function sourcePassesFilters(s: Source, filters?: ChatFilterState): boolean {
  if (!filters) return true;

  if (filters.types?.length) {
    const wanted = filters.types
      .map(resolveType)
      .filter((t): t is ResourceType => !!t);
    if (wanted.length && !wanted.includes(s.type)) return false;
  }

  if (filters.authors?.length) {
    const wantsUnknown = filters.authors.includes('unknown');
    const named = filters.authors.filter((a) => a !== 'unknown');
    const matchNamed = s.author != null && named.includes(s.author);
    const matchUnknown = wantsUnknown && s.author == null;
    if (!matchNamed && !matchUnknown) return false;
  }

  if (filters.origins?.length) {
    if (!s.origin || !filters.origins.includes(s.origin)) return false;
  }

  if (filters.date) {
    const interval = dateIntervalOf(s.date);
    // Ressource sans date exploitable : passe (pas de preuve de violation).
    if (interval) {
      const { mode, from, to } = filters.date;
      const lo = mode !== 'before' && from ? `${from}-01` : null;
      const hi = mode !== 'after' && to ? `${to}-31` : null;
      if (lo && interval.end < lo) return false;
      if (hi && interval.start > hi) return false;
    }
  }

  return true;
}
