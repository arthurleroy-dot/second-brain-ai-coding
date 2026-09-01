/**
 * Validation d'une date de source saisie au dépôt (module PUR, client-safe :
 * aucun import `fs`, aucune classe Tailwind littérale). Prend `today` en
 * paramètre — pas de `new Date()` interne — pour être déterministe et testable,
 * en miroir de `forceDate(markdown, declaredDate, today)` (`ingest-local.ts`).
 *
 * La granularité d'une date wiki est DÉDUITE de la forme de la chaîne
 * (jamais un champ séparé — convention du projet, cf. wiki-index / chat-filters).
 * Les trois regex de forme sont exactement celles déjà utilisées ailleurs
 * (`chat-filters.ts`, `wiki-index.ts`) — cohérence de « qu'est-ce qu'une date ».
 */
export type DateGranularity = 'year' | 'month' | 'day';

export type DateValidation =
  | { ok: true; granularity: DateGranularity; isFuture: boolean }
  | { ok: false; error: string };

/**
 * @param raw   saisie utilisateur (sera `.trim()`).
 * @param today date du jour 'AAAA-MM-JJ' (passée par l'appelant, pas de `new Date()` ici).
 */
export function validateDateInput(raw: string, today: string): DateValidation {
  const s = raw.trim();
  if (!s) return { ok: false, error: 'Renseigne la date de la source.' };

  let granularity: DateGranularity;
  if (/^\d{4}$/.test(s)) granularity = 'year';
  else if (/^\d{4}-\d{2}$/.test(s)) granularity = 'month';
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) granularity = 'day';
  else
    return {
      ok: false,
      error: 'Format attendu : AAAA, AAAA-MM ou AAAA-MM-JJ (ex. 2025, 2025-03, 2025-03-14).',
    };

  const year = Number(s.slice(0, 4));
  if (year < 1970 || year > 2100) return { ok: false, error: 'Année invalide (1970–2100).' };

  if (granularity !== 'year') {
    const month = Number(s.slice(5, 7));
    if (month < 1 || month > 12) return { ok: false, error: 'Mois invalide (01–12).' };

    if (granularity === 'day') {
      const day = Number(s.slice(8, 10));
      // Dernier jour du mois `month` (1-indexé ici) : `new Date(y, m, 0)` gère les
      // années bissextiles — `new Date(2024, 2, 0).getDate() === 29`.
      const dim = new Date(year, month, 0).getDate();
      if (day < 1 || day > dim)
        return {
          ok: false,
          error: `Jour invalide (01–${String(dim).padStart(2, '0')} pour ce mois).`,
        };
    }
  }

  // Futur = le DÉBUT de l'intervalle couvert par la date est postérieur à aujourd'hui
  // (comparaison lexicale de chaînes ISO, correcte).
  const intervalStart =
    granularity === 'year' ? `${s}-01-01` : granularity === 'month' ? `${s}-01` : s;
  const isFuture = intervalStart > today;

  return { ok: true, granularity, isFuture };
}
