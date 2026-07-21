/**
 * Moteur DÉTERMINISTE de PROJECTION d'une ressource — « l'inverse de la
 * suppression » (`deleteResource` dans `wiki-mutate.ts`).
 *
 * L'IA d'ingestion ne produit QUE la page canonique `wiki/resources/<slug>.md`
 * (frontmatter + blockquote de nav + corps paraphrasé + annotations de section).
 * `projectResource` reconstruit alors, SANS aucun appel modèle, TOUTES les vues
 * dérivées + le graphe + le manifeste à partir de cette seule page.
 *
 * Fonction PURE : reçoit le CONTENU des fichiers wiki pertinents (en mémoire) et
 * renvoie une liste d'opérations de fichiers (`FileOp`). Aucune I/O ici → testable
 * sous `node:test`. Comme `wiki-mutate.ts` : aucun import `@/…` (dépendances
 * injectées), pour rester importable par les tests via chemin relatif.
 *
 * Priorité de correction (cf. audit `wiki-verify.ts`) : `graph.json` + `_ingested.json`
 * EXACTS (c'est ce que le verify juge). Les formats markdown des vues sont exigés par
 * la spec (fidélité) mais ne font pas échouer le verify.
 *
 * ⚠️ NE MODIFIE PAS `wiki-mutate.ts` (moteur figé/testé). On réutilise ses helpers
 * EXPORTÉS et on ré-implémente ici ses briques privées (constructeurs de blocs,
 * upserts de graphe, insertion ordonnée, `addManifestKey`, extraction du takeaway).
 */
import {
  headingSlug,
  splitFrontmatter,
  withFrontmatter,
  setScalar,
  bumpScalarInt,
  countResourceBlocks,
  countTableRows,
  adjustHeadingCount,
  removeResourceBlock,
  parseGraph,
  serializeGraph,
  parseResourceMeta,
  type FileOp,
  type Graph,
  type GraphNode,
  type GraphEdge,
} from './wiki-mutate';

// ————————————————————————————————————————————————————————————————
// Types

/** Déclaration d'une entité DÉCLARÉE-NOUVELLE (sidecar) dont la page est créée ici. */
export interface NewEntityDecl {
  entity_type: string;
  label: string;
  aliases: string[];
}

/**
 * Contenu courant de chaque vue à mettre à jour. `null` = page à CRÉER (symétrique
 * de `DeleteViews`, où l'absence signalait un orphelin à supprimer).
 */
export interface ProjectViews {
  /** themes/<slug>.md par slug de thème (frontmatter). `null` = à créer. */
  themes: Record<string, string | null>;
  /** Label d'affichage de chaque thème (topics frontmatter) — nav + node + création. */
  themeLabels: Record<string, string>;
  /** authors/<slug>.md (slug = slugify(author)). `null` = à créer. */
  authorPath: string | null;
  authorContent: string | null;
  /** origin/<val>.md (existe toujours en prod). */
  originPath: string | null;
  originContent: string | null;
  /** entities/<slug>.md par slug (frontmatter ∪ chunk). `null` = à créer. */
  entities: Record<string, string | null>;
  /** Déclaration (type/label/aliases) de chaque entité à CRÉER (déclarée-nouvelle). */
  newEntities: Record<string, NewEntityDecl>;
  /** by-date : page année / page mois (si date au mois). `null` = à créer. */
  yearPath: string | null;
  yearContent: string | null;
  monthPath: string | null;
  monthContent: string | null;
  graph: string;
  manifest: string;
  index: string;
  types: string | null;
}

export interface ProjectResourceInput {
  slug: string;
  /** La page ressource produite par l'IA (écrite verbatim en op #1). */
  resourceContent: string;
  views: ProjectViews;
  /** slugify (injecté — évite une dépendance @/). */
  slugifyAuthor: (name: string) => string;
  /** source_type brut → libellé d'affichage (pour node type: + sous-titre index). */
  typeLabel: (sourceType: string) => string;
  /** Date du jour (AAAA-MM-JJ) pour last_updated / graph.generated / manifeste. */
  today: string;
}

// ————————————————————————————————————————————————————————————————
// Helpers texte

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ORIGIN_LABEL: Record<string, string> = { interne: 'Interne', externe: 'Externe' };

/** Première phrase d'un texte (jusqu'au premier `.`/`!`/`?`), bornée. */
function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const m = clean.match(/^(.{0,300}?[.!?])(\s|$)/);
  const s = m ? m[1] : clean.slice(0, 200);
  return s.trim();
}

/** Valeurs d'un tableau inline du frontmatter (`key: [a, b]`), dé-quotées. */
function fmArray(fm: string, key: string): string[] {
  const m = fm.match(new RegExp(`^${escapeRe(key)}:\\s*\\[([^\\]]*)\\]\\s*$`, 'm'));
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

interface Section {
  title: string;
  anchor: string;
  topics: string[];
  entities: string[];
  takeaway: string;
}

/** Découpe le corps en sections `##`/`###` avec leurs annotations + takeaway. */
function collectSections(body: string): Section[] {
  const lines = body.split('\n');
  const out: Section[] = [];
  let cur: { title: string; anchor: string; topics: string[]; entities: string[]; prose: string[] } | null = null;
  const flush = () => {
    if (cur) {
      out.push({
        title: cur.title,
        anchor: cur.anchor,
        topics: cur.topics,
        entities: cur.entities,
        takeaway: firstSentence(cur.prose.join(' ')),
      });
    }
  };
  for (const line of lines) {
    const h = line.match(/^#{2,3}\s+(.+)$/);
    if (h) {
      flush();
      cur = { title: h[1].trim(), anchor: headingSlug(h[1]), topics: [], entities: [], prose: [] };
      continue;
    }
    if (!cur) continue;
    const t = line.trim();
    const mt = t.match(/^`topics:\s*\[([^\]]*)\]`$/);
    if (mt) {
      cur.topics.push(...mt[1].split(',').map((s) => s.trim()).filter(Boolean));
      continue;
    }
    const me = t.match(/^`entities:\s*\[([^\]]*)\]`$/);
    if (me) {
      cur.entities.push(...me[1].split(',').map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (/^>\s*Par\s+/i.test(t)) continue; // blockquote de nav
    if (t) cur.prose.push(t);
  }
  flush();
  return out;
}

// ————————————————————————————————————————————————————————————————
// Lignes méta + blocs (ré-implémentation des briques privées de wiki-mutate)

interface Card {
  slug: string;
  title: string;
  date: string;
  source_type: string;
  origin: string;
  author: string;
}

function themeMetaLine(c: Card): string {
  const bits = [c.date, c.source_type, c.origin].filter(Boolean).join(' · ');
  return `\`${bits}${c.author ? ` — ${c.author}` : ''}\``;
}
function entityMetaLine(c: Card): string {
  const bits = [c.date, c.source_type].filter(Boolean).join(' · ');
  return `\`${bits}${c.author ? ` — ${c.author}` : ''}\``;
}
function originMetaLine(c: Card): string {
  return `\`${[c.date, c.source_type, c.author].filter(Boolean).join(' · ')}\``;
}

function buildThemeBlock(c: Card, secs: Section[], resourceTakeaway: string): string {
  const header = `## [[../resources/${c.slug}|${c.title}]]`;
  const bullets = secs.length
    ? secs.map((s) => `- [[../resources/${c.slug}#${s.anchor}|${s.title}]] — ${s.takeaway}`)
    : [`- Ressource entière — ${resourceTakeaway}`];
  return `${header}\n${themeMetaLine(c)}\n\n${bullets.join('\n')}`;
}

function buildEntityBlock(c: Card, resourceLevel: boolean, secs: Section[], resourceTakeaway: string): string {
  const header = `### [[../resources/${c.slug}|${c.title}]]`;
  const bullets =
    resourceLevel || secs.length === 0
      ? [`- Ressource entière : ${resourceTakeaway}`]
      : secs.map((s) => `- [[../resources/${c.slug}#${s.anchor}|${s.title}]] — ${s.takeaway}`);
  return `${header}\n${entityMetaLine(c)}\n${bullets.join('\n')}`;
}

function buildOriginBlock(c: Card): string {
  return `## [[../resources/${c.slug}|${c.title}]]\n${originMetaLine(c)}`;
}

/**
 * Upsert idempotent d'un bloc dans une vue existante : retire un éventuel bloc du
 * même slug (via l'helper exporté `removeResourceBlock`) puis ré-ajoute le bloc frais
 * en fin de vue. `separator` = `---` entre blocs (thèmes), sinon simple ligne vide
 * (entités, origin).
 */
function upsertBlock(text: string, level: '##' | '###', slug: string, block: string, useSeparator: boolean): string {
  const without = removeResourceBlock(text, level, slug);
  const trimmed = without.replace(/\n+$/, '');
  const hasBlocks = new RegExp(`^${level} \\[\\[[^\\]]*resources/`, 'm').test(trimmed);
  const sep = hasBlocks && useSeparator ? '\n\n---\n\n' : '\n\n';
  return `${trimmed}${sep}${block}\n`;
}

// ————————————————————————————————————————————————————————————————
// Tables (auteur, by-date, types) — insertion / création

/** Vrai si une ligne de table pointe déjà `resources/<slug>`. */
function hasTableRow(text: string, slug: string): boolean {
  return new RegExp(`^\\|\\s*\\[\\[[^\\]]*resources/${escapeRe(slug)}[\\\\|#\\]]`, 'm').test(text);
}

/** Insère `row` après la dernière ligne de table (`| …`) de la section du heading. */
function insertRowUnderHeading(text: string, headingRe: RegExp, row: string): string {
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let lastRow = -1;
  for (let i = start + 1; i < end; i++) if (/^\|/.test(lines[i])) lastRow = i;
  const at = lastRow !== -1 ? lastRow + 1 : end;
  lines.splice(at, 0, row);
  return lines.join('\n');
}

/** Insère `bullet` à la fin de la section du heading (après le dernier contenu). */
function insertBulletUnderHeading(text: string, headingRe: RegExp, bullet: string): string {
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let k = end - 1;
  while (k > start && lines[k].trim() === '') k--;
  lines.splice(k + 1, 0, bullet);
  return lines.join('\n');
}

/** Incrémente le premier entier d'une ligne repérée par `needle` (inverse de decrement). */
function incrementCountOnLineWith(text: string, needle: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      lines[i] = lines[i].replace(/(\d+)/, (d) => String(parseInt(d, 10) + 1));
      return lines.join('\n');
    }
  }
  return text;
}

// ————————————————————————————————————————————————————————————————
// Graphe (ré-implémentation des upserts privés + les 7 relations)

function upsertNode(g: Graph, node: GraphNode): void {
  if (!g.nodes.some((n) => n.id === node.id)) g.nodes.push(node);
}

/** Upsert d'un edge (fusion des `sections` pour `mentions` ; niveau ressource = sans sections). */
function upsertEdge(g: Graph, source: string, target: string, relation: string, sections?: string[] | null): void {
  const found = g.edges.find((e) => e.source === source && e.target === target && e.relation === relation);
  if (found) {
    if (relation === 'mentions') {
      if (sections == null) delete found.sections;
      else if (found.sections) found.sections = [...new Set([...found.sections, ...sections])];
    }
    return;
  }
  const edge: GraphEdge = { source, target, relation };
  if (relation === 'mentions' && sections && sections.length) edge.sections = sections;
  g.edges.push(edge);
}

// ————————————————————————————————————————————————————————————————
// Manifeste

/** Ajoute (ou remplace) la clé `sourceFile` du manifeste (inverse de removeManifestKey). */
export function addManifestKey(
  manifestJson: string,
  sourceFile: string,
  entry: { slug: string; ingested_at: string; run: string },
): string {
  const doc = JSON.parse(manifestJson);
  if (!doc.files || typeof doc.files !== 'object') doc.files = {};
  doc.files[sourceFile] = entry;
  return JSON.stringify(doc, null, 2) + '\n';
}

// ————————————————————————————————————————————————————————————————
// Créations de pages neuves

function createThemePage(slug: string, label: string, block: string, today: string): string {
  return (
    `---\ntype: theme\nslug: ${slug}\nlabel: ${JSON.stringify(label)}\n` +
    `resource_count: 1\nlast_updated: ${JSON.stringify(today)}\n---\n\n${block}\n`
  );
}

function createEntityPage(slug: string, decl: NewEntityDecl, block: string): string {
  const aliasList = decl.aliases.length ? `[${decl.aliases.map((a) => JSON.stringify(a)).join(', ')}]` : '[]';
  return (
    `---\ntype: entity\nentity_type: ${decl.entity_type}\nslug: ${slug}\n` +
    `label: ${JSON.stringify(decl.label)}\naliases: ${aliasList}\n---\n\n` +
    `# ${decl.label}\n\n\`entity_type: ${decl.entity_type}\`\n\n## Mentions\n\n${block}\n`
  );
}

function createAuthorPage(authorSlug: string, label: string, row: string): string {
  return (
    `---\ntype: author\nslug: ${authorSlug}\nlabel: ${label}\nresource_count: 1\n---\n\n` +
    `| Ressource | Date | Type | Origin | Topics |\n|-----------|------|------|--------|--------|\n${row}\n`
  );
}

function createMonthPage(ym: string, row: string): string {
  return (
    `---\ntype: by-date\nperiod: ${JSON.stringify(ym)}\nresource_count: 1\n---\n\n` +
    `| Ressource | Auteur | Type | Origin | Topics |\n|-----------|--------|------|--------|--------|\n${row}\n`
  );
}

function createYearPage(y: string, yearRow: string | null, monthBullet: string | null): string {
  const yearTable = `| Ressource | Auteur | Type | Origin | Topics |\n|-----------|--------|------|--------|--------|${yearRow ? `\n${yearRow}` : ''}`;
  return (
    `---\ntype: by-date\nperiod: ${JSON.stringify(y)}\nresource_count: 1\n---\n\n` +
    `## Date précise inconnue (année seulement)\n\n${yearTable}\n\n` +
    `## Par mois\n${monthBullet ? `\n${monthBullet}\n` : '\n'}`
  );
}

// ————————————————————————————————————————————————————————————————
// PROJECTION

export function projectResource(input: ProjectResourceInput): FileOp[] {
  const { slug, resourceContent, views: v, slugifyAuthor, typeLabel, today } = input;
  const meta = parseResourceMeta(resourceContent, slug);
  const { fm } = splitFrontmatter(resourceContent);
  const feTopics = fmArray(fm, 'topics');
  const feEntities = fmArray(fm, 'entities');
  const sections = collectSections(meta.body);
  const resourceTakeaway = sections.find((s) => s.takeaway)?.takeaway || meta.title;

  const card: Card = {
    slug,
    title: meta.title,
    date: meta.date ?? '',
    source_type: meta.source_type ?? '',
    origin: meta.origin ?? '',
    author: meta.author ?? '',
  };
  const ops: FileOp[] = [];

  // 1. La ressource canonique (verbatim — l'IA l'a déjà écrite avec nav + annotations).
  ops.push({ path: `wiki/resources/${slug}.md`, content: resourceContent });

  // 2. themes/ (topics FRONTMATTER) — bloc + resource_count recalculé.
  for (const t of feTopics) {
    const label = v.themeLabels[t] ?? t;
    const secs = sections.filter((s) => s.topics.includes(t));
    const block = buildThemeBlock(card, secs, resourceTakeaway);
    const existing = v.themes[t] ?? null;
    let content: string;
    if (existing === null) {
      content = createThemePage(t, label, block, today);
    } else {
      const merged = upsertBlock(existing, '##', slug, block, true);
      const { fm: f, rest } = splitFrontmatter(merged);
      let nf = setScalar(f, 'resource_count', String(countResourceBlocks(rest, '##')));
      nf = setScalar(nf, 'last_updated', JSON.stringify(today));
      content = withFrontmatter(nf, rest);
    }
    ops.push({ path: `wiki/themes/${t}.md`, content });
  }

  // 3. authors/ — page créée si nouvel auteur, sinon ligne + resource_count.
  if (card.author) {
    const aslug = slugifyAuthor(card.author);
    const path = v.authorPath ?? `wiki/authors/${aslug}.md`;
    const row = `| [[../resources/${slug}\\|${card.title}]] | ${card.date} | ${card.source_type} | ${card.origin} | ${feTopics.join(', ')} |`;
    let content: string;
    if (v.authorContent === null) {
      content = createAuthorPage(aslug, card.author, row);
    } else if (hasTableRow(v.authorContent, slug)) {
      content = v.authorContent; // idempotent
    } else {
      const merged = insertRowUnderHeading(v.authorContent, /^\| Ressource /m, row);
      const { fm: f, rest } = splitFrontmatter(merged);
      content = withFrontmatter(setScalar(f, 'resource_count', String(countTableRows(rest))), rest);
    }
    ops.push({ path, content });
  }

  // 4. origin/ — bloc + resource_count. Pages toujours présentes en prod.
  if (card.origin && v.originContent !== null) {
    const block = buildOriginBlock(card);
    const merged = upsertBlock(v.originContent, '##', slug, block, false);
    const { fm: f, rest } = splitFrontmatter(merged);
    let nf = setScalar(f, 'resource_count', String(countResourceBlocks(rest, '##')));
    nf = setScalar(nf, 'last_updated', JSON.stringify(today));
    ops.push({ path: v.originPath ?? `wiki/origin/${card.origin}.md`, content: withFrontmatter(nf, rest) });
  }

  // 5. by-date/ — mois (si connu) + année.
  const date = card.date;
  const year = date.slice(0, 4);
  const ym = date.slice(0, 7);
  const isMonth = date.length >= 7;
  if (year) {
    if (isMonth) {
      // Idempotence : si le mois porte déjà la ressource, on ne touche à rien (ni au
      // compteur du mois, ni à celui de l'année).
      const monthPresent = v.monthContent !== null && hasTableRow(v.monthContent, slug);
      const mrow = `| [[../../../resources/${slug}\\|${card.title}]] | ${card.author} | ${card.source_type} | ${card.origin} | ${feTopics.join(', ')} |`;
      const mpath = v.monthPath ?? `wiki/by-date/${year}/${ym}/${ym}.md`;
      if (v.monthContent === null) {
        ops.push({ path: mpath, content: createMonthPage(ym, mrow) });
      } else if (!monthPresent) {
        const merged = insertRowUnderHeading(v.monthContent, /^\| Ressource /m, mrow);
        const { fm: f, rest } = splitFrontmatter(merged);
        ops.push({ path: mpath, content: withFrontmatter(setScalar(f, 'resource_count', String(countTableRows(rest))), rest) });
      }

      if (!monthPresent) {
        const monthBullet = `- [[by-date/${year}/${ym}/${ym}|${ym}]] — 1 ressource (${card.author})`;
        const ypath = v.yearPath ?? `wiki/by-date/${year}/${year}.md`;
        let ycontent: string;
        if (v.yearContent === null) {
          ycontent = createYearPage(year, null, monthBullet);
        } else {
          let out = v.yearContent;
          if (new RegExp(`/${escapeRe(ym)}/${escapeRe(ym)}[|\\]]`).test(out)) {
            out = upsertMonthBullet(out, ym, card.author);
          } else {
            out = insertBulletUnderHeading(out, /^## Par mois/m, monthBullet);
          }
          const { fm: f, rest } = splitFrontmatter(out);
          ycontent = withFrontmatter(bumpScalarInt(f, 'resource_count', 1), rest);
        }
        ops.push({ path: ypath, content: ycontent });
      }
    } else {
      // Date à l'année seulement → table « Date précise inconnue ».
      const yrow = `| [[../../resources/${slug}\\|${card.title}]] | ${card.author} | ${card.source_type} | ${card.origin} | ${feTopics.join(', ')} |`;
      const ypath = v.yearPath ?? `wiki/by-date/${year}/${year}.md`;
      let ycontent: string;
      if (v.yearContent === null) {
        ycontent = createYearPage(year, yrow, null);
      } else if (hasTableRow(v.yearContent, slug)) {
        ycontent = v.yearContent;
      } else {
        const merged = insertRowUnderHeading(v.yearContent, /^## Date précise inconnue/m, yrow);
        const { fm: f, rest } = splitFrontmatter(merged);
        ycontent = withFrontmatter(bumpScalarInt(f, 'resource_count', 1), rest);
      }
      ops.push({ path: ypath, content: ycontent });
    }
  }

  // 6. entities/ (frontmatter ∪ chunk) — bloc de mention ; création si déclarée-nouvelle.
  for (const e of meta.entities) {
    const resourceLevel = feEntities.includes(e);
    const secs = sections.filter((s) => s.entities.includes(e));
    const block = buildEntityBlock(card, resourceLevel, secs, resourceTakeaway);
    const existing = v.entities[e] ?? null;
    let content: string;
    if (existing === null) {
      const decl = v.newEntities[e] ?? { entity_type: 'concept', label: e, aliases: [] };
      content = createEntityPage(e, decl, block);
    } else {
      content = upsertBlock(existing, '###', slug, block, false);
    }
    ops.push({ path: `wiki/entities/${e}.md`, content });
  }

  // 7. types.md — ligne + heading « ## <source_type> (N ressources) ». Idempotent.
  if (card.source_type && v.types !== null && !hasTableRow(v.types, slug)) {
    const row = `| [[resources/${slug}\\|${card.title}]] | ${card.author} | ${card.date} | ${card.origin} |`;
    const headRe = new RegExp(`^## ${escapeRe(card.source_type)} \\(\\d+ ressources?\\)`, 'm');
    let out: string;
    if (headRe.test(v.types)) {
      out = v.types.replace(
        new RegExp(`^(## ${escapeRe(card.source_type)}) \\((\\d+) ressources?\\)`, 'm'),
        (_m, h, n) => {
          const next = parseInt(n, 10) + 1;
          return `${h} (${next} ressource${next > 1 ? 's' : ''})`;
        },
      );
      out = insertRowUnderHeading(out, headRe, row);
    } else {
      const section =
        `## ${card.source_type} (1 ressource)\n\n` +
        `| Ressource | Auteur | Date | Origin |\n|-----------|--------|------|--------|\n${row}`;
      out = `${v.types.replace(/\n+$/, '')}\n\n${section}\n`;
    }
    ops.push({ path: 'wiki/types.md', content: out });
  }

  // 8. graph.json (CRITIQUE) — node ressource + les 7 relations.
  const g = parseGraph(v.graph);
  g.generated = today;
  const rid = `resource:${slug}`;
  upsertNode(g, { id: rid, type: 'resource', label: card.title, date: date });
  if (card.author) {
    const a = slugifyAuthor(card.author);
    upsertNode(g, { id: `author:${a}`, type: 'author', label: card.author });
    upsertEdge(g, rid, `author:${a}`, 'written_by');
  }
  if (card.source_type) {
    upsertNode(g, { id: `type:${card.source_type}`, type: 'source_type', label: typeLabel(card.source_type) });
    upsertEdge(g, rid, `type:${card.source_type}`, 'has_type');
  }
  if (card.origin) {
    upsertNode(g, { id: `origin:${card.origin}`, type: 'origin', label: ORIGIN_LABEL[card.origin] ?? card.origin });
    upsertEdge(g, rid, `origin:${card.origin}`, 'has_origin');
  }
  for (const t of feTopics) {
    upsertNode(g, { id: `theme:${t}`, type: 'theme', label: v.themeLabels[t] ?? t });
    upsertEdge(g, rid, `theme:${t}`, 'belongs_to_theme');
  }
  for (const e of meta.entities) {
    const resourceLevel = feEntities.includes(e);
    const decl = v.newEntities[e];
    if (decl) upsertNode(g, { id: `entity:${e}`, type: 'entity', entity_type: decl.entity_type, label: decl.label });
    else upsertNode(g, { id: `entity:${e}`, type: 'entity' });
    const secs = resourceLevel ? null : sections.filter((s) => s.entities.includes(e)).map((s) => s.anchor);
    upsertEdge(g, rid, `entity:${e}`, 'mentions', secs);
  }
  if (year) {
    if (isMonth) {
      upsertNode(g, { id: `date:${ym}`, type: 'date', label: ym, granularity: 'month', year });
      upsertNode(g, { id: `date:${year}`, type: 'date', label: year, granularity: 'year' });
      upsertEdge(g, rid, `date:${ym}`, 'published_on');
      upsertEdge(g, `date:${ym}`, `date:${year}`, 'year_of');
    } else {
      upsertNode(g, { id: `date:${year}`, type: 'date', label: year, granularity: 'year' });
      upsertEdge(g, rid, `date:${year}`, 'published_on');
    }
  }
  ops.push({ path: 'wiki/graph.json', content: serializeGraph(g) });

  // 9. _ingested.json — clé source_file.
  if (meta.source_file) {
    ops.push({
      path: 'wiki/_ingested.json',
      content: addManifestKey(v.manifest, meta.source_file, { slug, ingested_at: today, run: 'local' }),
    });
  }

  // 10. index.md — bullet ressource + compteurs (vue non jugée par verify, fidélité).
  ops.push({ path: 'wiki/index.md', content: updateIndex(v, card, feTopics, year, slugifyAuthor, typeLabel, today) });

  // 11. raw/ : rien (immuable). 12. log.md : géré par la route (verify l'ignore).
  return ops;
}

/** Upsert du bullet mois dans « ## Par mois » (incrémente N + ajoute l'auteur). */
function upsertMonthBullet(yearContent: string, ym: string, author: string): string {
  const lines = yearContent.split('\n');
  const re = new RegExp(`/${escapeRe(ym)}/${escapeRe(ym)}[|\\]]`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      let line = lines[i].replace(/(\d+)/, (d) => String(parseInt(d, 10) + 1));
      if (author && !line.includes(author)) {
        line = line.replace(/\(([^)]*)\)\s*$/, (_m, inside) => `(${inside}, ${author})`);
      }
      lines[i] = line;
      return lines.join('\n');
    }
  }
  return yearContent;
}

/** Met à jour index.md : bullet ressource + tous les compteurs (mirroir inverse de deleteResource). */
function updateIndex(
  v: ProjectViews,
  card: Card,
  feTopics: string[],
  year: string,
  slugifyAuthor: (s: string) => string,
  typeLabel: (s: string) => string,
  today: string,
): string {
  // Idempotence : si la ressource figure déjà dans l'index, ne rien recompter.
  if (v.index.includes(`resources/${card.slug}|`)) return v.index;

  let { fm, rest: body } = splitFrontmatter(v.index);

  // Ressources (N) + sous-section de type.
  body = adjustHeadingCount(body, /^## Ressources \(\d+\)/m, 1);
  const resourceBullet = `- [[resources/${card.slug}|${card.title}]] — ${[card.author, card.date].filter(Boolean).join(' · ')}`;
  if (card.source_type) {
    const label = typeLabel(card.source_type);
    const subRe = new RegExp(`^### ${escapeRe(label)} \\(\\d+\\)`, 'm');
    if (subRe.test(body)) {
      body = adjustHeadingCount(body, subRe, 1);
      body = insertBulletUnderHeading(body, subRe, resourceBullet);
    } else {
      body = addTypeSubsection(body, label, resourceBullet);
    }
  }

  // Auteurs.
  if (card.author) {
    const a = slugifyAuthor(card.author);
    if (v.authorContent === null) {
      body = adjustHeadingCount(body, /^## Auteurs \(\d+\)/m, 1);
      body = insertBulletUnderHeading(body, /^## Auteurs \(/m, `- [[authors/${a}|${card.author}]] — 1 ressource`);
      fm = bumpScalarInt(fm, 'author_count', 1);
    } else {
      body = incrementCountOnLineWith(body, `authors/${a}|`);
    }
  }

  // Thèmes.
  for (const t of feTopics) {
    if ((v.themes[t] ?? null) === null) {
      body = adjustHeadingCount(body, /^## Thèmes \(\d+\)/m, 1);
      body = insertBulletUnderHeading(body, /^## Thèmes \(/m, `- [[themes/${t}|${v.themeLabels[t] ?? t}]] — 1 ressource`);
      fm = bumpScalarInt(fm, 'theme_count', 1);
    } else {
      body = incrementCountOnLineWith(body, `themes/${t}|`);
    }
  }

  // Origine.
  if (card.origin) body = incrementCountOnLineWith(body, `origin/${card.origin}|`);

  // Date (année).
  if (year) {
    if (body.includes(`by-date/${year}/${year}|`)) {
      body = incrementCountOnLineWith(body, `by-date/${year}/${year}|`);
    } else {
      body = insertBulletUnderHeading(body, /^## Index par date/m, `- [[by-date/${year}/${year}|${year}]] — 1 ressource`);
    }
  }

  fm = bumpScalarInt(fm, 'resource_count', 1);
  fm = setScalar(fm, 'last_updated', JSON.stringify(today));
  return withFrontmatter(fm, body);
}

/** Ajoute une sous-section « ### <label> (1) » + bullet à la fin de « ## Ressources ». */
function addTypeSubsection(body: string, label: string, bullet: string): string {
  const lines = body.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^## Ressources \(/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]) || /^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  let k = end - 1;
  while (k > start && lines[k].trim() === '') k--;
  lines.splice(k + 1, 0, '', `### ${label} (1)`, '', bullet);
  return lines.join('\n');
}
