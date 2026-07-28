/**
 * Moteur DÉTERMINISTE de RÉGÉNÉRATION des index dérivés — `index.md` et les pages
 * `by-date/`. Contrairement à l'ancienne couche incrémentale (retouches d'une
 * ressource à la fois dans `wiki-project.ts`/`wiki-mutate.ts`), on RECONSTRUIT ces
 * vues EN ENTIER à partir de l'état canonique (fiches `resources/` + registres),
 * exactement comme `graph.json` est reconstruit par upserts idempotents. « Jamais
 * cassé par construction » : le rebuild écrase toute dérive (compteurs faux, slugs
 * corrompus `n8n→n9n`/`by-date/2027/2026`, entités plafonnées, sous-sections de type
 * dupliquées).
 *
 * Fonctions PURES : reçoivent l'état en mémoire (cartes de ressources + registres) et
 * renvoient soit une chaîne (index.md), soit une liste de `FileOp` (by-date). Aucune
 * I/O ici → testable sous `node:test`. Comme `wiki-mutate`/`wiki-project` : aucun
 * import `@/…` (importable par test en chemin relatif).
 */
import { withFrontmatter, type FileOp } from './wiki-mutate';

// ————————————————————————————————————————————————————————————————
// Types

/** Une ressource canonique, réduite aux métadonnées d'index (= `parseResourceMeta`). */
export interface ResourceCard {
  slug: string;
  title: string;
  /** '' si absent. */
  author: string;
  /** '' | 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'. */
  date: string;
  /** source_type BRUT du frontmatter (ex. 'report-pdf') — '' possible. */
  source_type: string;
  /** 'interne' | 'externe' | ''. */
  origin: string;
  /** union frontmatter ∪ chunk (= parseResourceMeta). */
  topics: string[];
  entities: string[];
}

/** Entrée de registre (entité ou thème) réduite à ce dont l'index a besoin. */
export interface KnownRef {
  slug: string;
  label: string;
}

export interface IndexInput {
  resources: ResourceCard[];
  /** Registre COMPLET des entités (énumère TOUTES les fiches → tue le plafond à 5/6). */
  entities: KnownRef[];
  /** Registre COMPLET des thèmes (labels + énumération). */
  themes: KnownRef[];
  today: string;
  /** source_type BRUT → libellé canonique (wikiTypeLabel injecté). */
  typeLabel: (sourceType: string) => string;
  /** nom d'auteur → slug (slugify injecté). */
  slugifyAuthor: (name: string) => string;
  /** Ordre canonique des libellés de type (registre effectif mappé) pour trier les sous-sections. */
  typeOrder: string[];
  /** slug ressource → queue curée (digest) récupérée de l'index courant (salvage). */
  resourceDigests: Record<string, string>;
  /** slug auteur → queue curée (digest) récupérée de l'index courant (salvage). */
  authorDigests: Record<string, string>;
}

// ————————————————————————————————————————————————————————————————
// Micro-helpers de format (réimplémentés localement — pas d'import ui.ts qui touche @/)

const ORIGIN_LABEL: Record<string, string> = { interne: 'Interne', externe: 'Externe' };

/** Pluriel français : 0 et 1 → singulier, ≥ 2 → pluriel. */
function ressources(n: number): string {
  return `${n} ressource${n > 1 ? 's' : ''}`;
}

/** Échappe le pipe pour un wikilink DANS une cellule de table (`[[..\|..]]`). */
function tableLink(rel: string, title: string): string {
  return `[[${rel}\\|${title}]]`;
}

/** Vrai si la date est une année seule (granularité inconnue → marqueur ⚠). */
function isYearOnly(date: string): boolean {
  return /^\d{4}$/.test(date);
}

// ————————————————————————————————————————————————————————————————
// buildIndex — régénère index.md EN ENTIER au format EXACT actuel

export function buildIndex(input: IndexInput): string {
  const { resources, entities, themes, today, typeLabel, slugifyAuthor, typeOrder } = input;
  const { resourceDigests, authorDigests } = input;

  const R = resources.length;
  const T = themes.length;
  const E = entities.length;

  // Auteurs distincts (slug) parmi les ressources à auteur non vide.
  const authorSlugs = new Map<string, string>(); // aslug -> nom d'affichage (1ᵉʳ vu)
  for (const r of resources) {
    if (!r.author) continue;
    const a = slugifyAuthor(r.author);
    if (!authorSlugs.has(a)) authorSlugs.set(a, r.author);
  }
  const A = authorSlugs.size;

  const fm = [
    'type: index',
    `last_updated: ${JSON.stringify(today)}`,
    `resource_count: ${R}`,
    `theme_count: ${T}`,
    `author_count: ${A}`,
    `entity_count: ${E}`,
  ].join('\n');

  const L: string[] = [''];

  // 1. Thèmes — 1 bullet/thème du registre ; tri c desc puis label.
  const themeCount = (slug: string) => resources.filter((r) => r.topics.includes(slug)).length;
  const themeRows = themes
    .map((t) => ({ slug: t.slug, label: t.label, c: themeCount(t.slug) }))
    .sort((a, b) => b.c - a.c || a.label.localeCompare(b.label));
  L.push(`## Thèmes (${T})`, '');
  for (const t of themeRows) L.push(`- [[themes/${t.slug}|${t.label}]] — ${ressources(t.c)}`);
  L.push('', '---', '');

  // 2. Entités — FIX CENTRAL : 1 bullet PAR entité du registre (slug/label émis tels quels).
  const entityCount = (slug: string) => resources.filter((r) => r.entities.includes(slug)).length;
  const entityRows = entities
    .map((e) => ({ slug: e.slug, label: e.label, c: entityCount(e.slug) }))
    .sort((a, b) => b.c - a.c || a.label.localeCompare(b.label));
  L.push(`## Entités (${E})`, '');
  for (const e of entityRows) L.push(`- [[entities/${e.slug}|${e.label}]] — ${ressources(e.c)}`);
  L.push('', '---', '');

  // 3. Auteurs — 1 bullet/auteur ; count · dates distinctes triées · digest (salvage).
  const authorRows = [...authorSlugs.entries()]
    .map(([aslug, name]) => {
      const rs = resources.filter((r) => r.author && slugifyAuthor(r.author) === aslug);
      const dates = [...new Set(rs.map((r) => r.date).filter(Boolean))].sort();
      return { aslug, name, c: rs.length, dates };
    })
    .sort((a, b) => b.c - a.c || a.name.localeCompare(b.name));
  L.push(`## Auteurs (${A})`, '');
  for (const a of authorRows) {
    const parts = [ressources(a.c)];
    if (a.dates.length) parts.push(a.dates.join(' & '));
    const digest = authorDigests[a.aslug];
    if (digest) parts.push(digest);
    L.push(`- [[authors/${a.aslug}|${a.name}]] — ${parts.join(' · ')}`);
  }
  L.push('', '---', '');

  // 4. Ressources — sous-sections par libellé canonique de type (dédoublonne Article/Articles),
  //    ordre du registre (typeOrder) ; bullets triés date desc puis slug.
  const groups = new Map<string, ResourceCard[]>();
  for (const r of resources) {
    const label = typeLabel(r.source_type || '');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(r);
  }
  const orderedLabels = [...groups.keys()].sort((a, b) => {
    const ia = typeOrder.indexOf(a);
    const ib = typeOrder.indexOf(b);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || a.localeCompare(b);
  });
  L.push(`## Ressources (${R})`, '');
  for (const label of orderedLabels) {
    const rs = groups
      .get(label)!
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
    L.push(`### ${label} (${rs.length})`, '');
    for (const r of rs) {
      const dateStr = r.date ? (isYearOnly(r.date) ? `${r.date} ⚠` : r.date) : '';
      const parts = [r.author, dateStr, resourceDigests[r.slug]].filter(Boolean).join(' · ');
      L.push(`- [[resources/${r.slug}|${r.title}]] — ${parts}`);
    }
    L.push('');
  }
  L.push('---', '');

  // 5. Index par date — 1 bullet par année distincte (asc) ; (dont M date exacte inconnue) si M>0.
  const years = [...new Set(resources.map((r) => r.date.slice(0, 4)).filter(Boolean))].sort();
  L.push('## Index par date', '');
  for (const y of years) {
    const inYear = resources.filter((r) => r.date.slice(0, 4) === y);
    const m = inYear.filter((r) => isYearOnly(r.date)).length;
    const suffix = m > 0 ? ` (dont ${m} date exacte inconnue)` : '';
    L.push(`- [[by-date/${y}/${y}|${y}]] — ${ressources(inYear.length)}${suffix}`);
  }
  L.push('');

  // 6. Index par type — pointeur statique.
  L.push('## Index par type', '');
  L.push('→ [[types]]', '');

  // 7. Origine — 1 bullet/origine présente ; tri c desc puis valeur.
  const originVals = [...new Set(resources.map((r) => r.origin).filter(Boolean))];
  const O = originVals.length;
  const originRows = originVals
    .map((v) => ({ v, c: resources.filter((r) => r.origin === v).length }))
    .sort((a, b) => b.c - a.c || a.v.localeCompare(b.v));
  L.push(`## Origine (${O})`, '');
  for (const o of originRows) {
    L.push(`- [[origin/${o.v}|${ORIGIN_LABEL[o.v] ?? o.v}]] — ${ressources(o.c)}`);
  }

  return withFrontmatter(fm, L.join('\n') + '\n');
}

// ————————————————————————————————————————————————————————————————
// buildByDate — réémet CHAQUE page année/mois en entier (tue upsertMonthBullet)

export function buildByDate(resources: ResourceCard[]): FileOp[] {
  const ops: FileOp[] = [];
  const dated = resources.filter((r) => r.date); // date vide → ignorée (miroir du garde `if (year)`)

  const years = [...new Set(dated.map((r) => r.date.slice(0, 4)))].sort();
  for (const year of years) {
    const inYear = dated.filter((r) => r.date.slice(0, 4) === year);
    const yearOnly = inYear
      .filter((r) => isYearOnly(r.date))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    const months = [...new Set(inYear.filter((r) => r.date.length >= 7).map((r) => r.date.slice(0, 7)))].sort();

    // --- Pages mois ---
    for (const ym of months) {
      const inMonth = inYear
        .filter((r) => r.date.slice(0, 7) === ym)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
      const rows = inMonth.map(
        (r) =>
          `| ${tableLink(`../../../resources/${r.slug}`, r.title)} | ${r.author} | ${r.source_type} | ${r.origin} | ${r.topics.join(', ')} |`,
      );
      const content =
        `---\ntype: by-date\nperiod: ${JSON.stringify(ym)}\nresource_count: ${inMonth.length}\n---\n\n` +
        `| Ressource | Auteur | Type | Origin | Topics |\n|-----------|--------|------|--------|--------|\n${rows.join('\n')}\n`;
      ops.push({ path: `wiki/by-date/${year}/${ym}/${ym}.md`, content });
    }

    // --- Page année ---
    const yearRows = yearOnly.map(
      (r) =>
        `| ${tableLink(`../../resources/${r.slug}`, r.title)} | ${r.author} | ${r.source_type} | ${r.origin} | ${r.topics.join(', ')} |`,
    );
    const monthBullets = months.map((ym) => {
      const inMonth = inYear.filter((r) => r.date.slice(0, 7) === ym);
      const authors = [...new Set(inMonth.map((r) => r.author).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return `- [[by-date/${year}/${ym}/${ym}|${ym}]] — ${ressources(inMonth.length)} (${authors.join(', ')})`;
    });
    const content =
      `---\ntype: by-date\nperiod: ${JSON.stringify(year)}\nresource_count: ${inYear.length}\n---\n\n` +
      `## Date précise inconnue (année seulement)\n\n` +
      `| Ressource | Auteur | Type | Origin | Topics |\n|-----------|--------|------|--------|--------|` +
      (yearRows.length ? `\n${yearRows.join('\n')}` : '') +
      `\n\n## Par mois\n\n` +
      (monthBullets.length ? `${monthBullets.join('\n')}\n` : '');
    ops.push({ path: `wiki/by-date/${year}/${year}.md`, content });
  }

  return ops;
}

/** Chemins by-date (année + mois) qui DOIVENT exister pour ces ressources (pour purger les orphelins). */
export function expectedByDatePaths(resources: ResourceCard[]): Set<string> {
  const paths = new Set<string>();
  for (const r of resources) {
    if (!r.date) continue;
    const year = r.date.slice(0, 4);
    paths.add(`wiki/by-date/${year}/${year}.md`);
    if (r.date.length >= 7) {
      const ym = r.date.slice(0, 7);
      paths.add(`wiki/by-date/${year}/${ym}/${ym}.md`);
    }
  }
  return paths;
}

// ————————————————————————————————————————————————————————————————
// salvageDigests — récupère les digests curés de l'index COURANT avant réécriture

/** Vrai si `s` est un bloc de dates (`2025-11 & 2026-04` ou `2024`). */
function isDateBlock(s: string): boolean {
  const toks = s.split(' & ').map((t) => t.trim());
  return toks.length > 0 && toks.every((t) => /^\d{4}(-\d{2}){0,2}$/.test(t));
}

/**
 * Parse l'`index.md` courant et récupère la queue curée (digest) par slug de ressource
 * et par slug d'auteur — ces résumés d'une ligne n'existent que dans l'index (aucun
 * frontmatter), donc on les SAUVE avant de réécrire (cf. Décisions §D5, Option B).
 *
 * `cards` fournit auteur/date par ressource pour retirer proprement ces tokens de tête
 * (l'auteur n'est pas reconnaissable par motif, contrairement à la date). Parser fragile
 * → couvert par test. Digest absent → clé omise (repli = bullet author · date seul).
 */
export function salvageDigests(
  priorIndex: string,
  cards: ResourceCard[],
): { resourceDigests: Record<string, string>; authorDigests: Record<string, string> } {
  const cardBySlug = new Map(cards.map((c) => [c.slug, c]));
  const resourceDigests: Record<string, string> = {};
  const authorDigests: Record<string, string> = {};

  for (const line of priorIndex.split('\n')) {
    const t = line.trim();

    const rm = t.match(/^- \[\[resources\/([a-z0-9-]+)\|.*?\]\] — (.*)$/);
    if (rm) {
      const slug = rm[1];
      const card = cardBySlug.get(slug);
      let parts = rm[2].split(' · ').map((s) => s.trim()).filter((s) => s.length);
      if (card) {
        if (parts.length && card.author && parts[0] === card.author) parts = parts.slice(1);
        if (parts.length && card.date) {
          const p0 = parts[0].replace(/\s*⚠\s*$/, '').trim();
          if (p0 === card.date) parts = parts.slice(1);
        }
      }
      const digest = parts.join(' · ').trim();
      if (digest) resourceDigests[slug] = digest;
      continue;
    }

    const am = t.match(/^- \[\[authors\/([a-z0-9-]+)\|.*?\]\] — (.*)$/);
    if (am) {
      const aslug = am[1];
      let parts = am[2].split(' · ').map((s) => s.trim()).filter((s) => s.length);
      if (parts.length && /^\d+ ressources?$/.test(parts[0])) parts = parts.slice(1);
      if (parts.length && isDateBlock(parts[0])) parts = parts.slice(1);
      const digest = parts.join(' · ').trim();
      if (digest) authorDigests[aslug] = digest;
      continue;
    }
  }

  return { resourceDigests, authorDigests };
}
