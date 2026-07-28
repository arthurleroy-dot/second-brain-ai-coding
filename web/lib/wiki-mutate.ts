/**
 * Moteur DÉTERMINISTE de mutation du wiki — « l'inverse de l'ingestion ».
 *
 * Fonctions PURES : chaque opération reçoit le CONTENU des fichiers wiki
 * pertinents (en mémoire) et renvoie une liste d'opérations de fichiers
 * (`FileOp`). Aucune I/O ici → entièrement testable sous `node:test`.
 *
 * Deux capacités :
 *   - applyEntityDecision / applyThemeDecision : appliquent une décision humaine
 *     (merge_alias | create | reject) sur une candidate, relient rétroactivement
 *     les ressources de `seen_in`, mettent à jour le graphe et purgent l'entrée.
 *   - deleteResource : retire une ressource partout (vues dérivées + graphe +
 *     manifeste + fichiers bruts).
 *
 * Volontairement SANS import `@/…` (comme wiki-verify.ts) pour rester importable
 * par les tests via chemin relatif et par les routes via l'alias. Seule dépendance
 * externe : gray-matter (lecture des frontmatters), déjà utilisée partout. Seul
 * import interne : `./alias-rule` (relatif, pur, sans dépendance) — la règle des
 * alias « utiles » partagée avec l'affichage.
 */
import matter from 'gray-matter';
import { meaningfulAliases } from './alias-rule';

// ————————————————————————————————————————————————————————————————
// Types

export type FileOp =
  | { path: string; content: string }
  | { path: string; delete: true };

export interface GraphNode {
  id: string;
  type: string;
  [k: string]: unknown;
}
export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  sections?: string[];
  [k: string]: unknown;
}
export interface Graph {
  generated: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SeenIn {
  resource: string;
  section: string | null;
  context: string;
}

// ————————————————————————————————————————————————————————————————
// Slug / heading helpers

/** Reproduit le slug d'ancre de GitHub (conserve les lettres accentuées). */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

/** Échappe une chaîne pour l'insérer dans une RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ————————————————————————————————————————————————————————————————
// Frontmatter (édition texte ciblée — jamais matter.stringify)

/** Sépare le bloc frontmatter (sans les `---`) du reste du fichier. */
export function splitFrontmatter(content: string): { fm: string; rest: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: '', rest: content };
  return { fm: m[1], rest: content.slice(m[0].length) };
}

/** Recompose un fichier `---\n<fm>\n---\n<rest>`. */
export function withFrontmatter(fm: string, rest: string): string {
  return `---\n${fm}\n---\n${rest}`;
}

/** Remplace la valeur (brute) d'un scalaire du frontmatter s'il existe. */
export function setScalar(fm: string, key: string, rawValue: string): string {
  const re = new RegExp(`^(${escapeRe(key)}):.*$`, 'm');
  if (re.test(fm)) return fm.replace(re, `${key}: ${rawValue}`);
  return fm; // clé absente : no-op (les compteurs existent toujours dans ces vues)
}

/** Incrémente (ou décrémente) un entier du frontmatter, borné à 0. */
export function bumpScalarInt(fm: string, key: string, delta: number): string {
  const re = new RegExp(`^(${escapeRe(key)}):\\s*(\\d+)\\s*$`, 'm');
  const m = fm.match(re);
  if (!m) return fm;
  const next = Math.max(0, parseInt(m[2], 10) + delta);
  return fm.replace(re, `${key}: ${next}`);
}

/**
 * Ajoute un item dans un tableau inline (`key: [a, b]`) par INSERTION ciblée
 * (préserve les items existants verbatim). Idempotent. Si la clé manque, l'insère
 * (pour `entities`, juste après la ligne `topics:` si présente).
 */
export function patchInlineArray(
  fm: string,
  key: string,
  item: string,
  opts: { quote?: boolean } = {},
): string {
  const rendered = opts.quote ? `"${item}"` : item;
  const lines = fm.split('\n');
  const re = new RegExp(`^(${escapeRe(key)}):\\s*\\[(.*)\\]\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) {
      const inner = m[2].trim();
      const items = inner
        ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
        : [];
      if (items.includes(item)) return fm; // déjà présent
      lines[i] = inner ? `${m[1]}: [${inner}, ${rendered}]` : `${m[1]}: [${rendered}]`;
      return lines.join('\n');
    }
  }
  const newLine = `${key}: [${rendered}]`;
  if (key === 'entities') {
    for (let i = 0; i < lines.length; i++) {
      if (/^topics:/.test(lines[i])) {
        lines.splice(i + 1, 0, newLine);
        return lines.join('\n');
      }
    }
  }
  lines.push(newLine);
  return lines.join('\n');
}

// ————————————————————————————————————————————————————————————————
// Suppression de blocs / lignes dans les vues dérivées

/**
 * Retire un bloc « ## [[…/resources/<slug>…]] » (ou `###`) d'une vue dérivée,
 * du heading jusqu'au prochain heading de même niveau, ou un `---` séparateur, ou
 * EOF. Consomme le séparateur `---` suivant et compacte les lignes vides.
 */
export function removeResourceBlock(
  text: string,
  level: '##' | '###',
  slug: string,
): string {
  const lines = text.split('\n');
  const headRe = new RegExp(
    `^${level} \\[\\[[^\\]]*resources/${escapeRe(slug)}[|#\\]]`,
  );
  const stopRe = new RegExp(`^#{1,${level.length}} `);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return text; // rien à retirer

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (stopRe.test(lines[i]) || /^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // Séparateur `---` : l'inclure ainsi que les lignes vides qui le suivent.
  if (end < lines.length && /^---\s*$/.test(lines[end])) {
    end++;
    while (end < lines.length && lines[end].trim() === '') end++;
  }
  const out = [...lines.slice(0, start), ...lines.slice(end)];
  return collapseBlankLines(out.join('\n'));
}

/** Retire la ligne de table dont le wikilink pointe `resources/<slug>`. */
export function removeTableRow(text: string, slug: string): string {
  const re = new RegExp(`^\\|\\s*\\[\\[[^\\]]*resources/${escapeRe(slug)}[\\\\|#\\]]`);
  return text
    .split('\n')
    .filter((line) => !re.test(line))
    .join('\n');
}

/** Retire toute ligne (bullet, etc.) référençant `resources/<slug>`. */
export function removeLinesWithResource(text: string, slug: string): string {
  const re = new RegExp(`resources/${escapeRe(slug)}[|#\\]]`);
  return text
    .split('\n')
    .filter((line) => !re.test(line))
    .join('\n');
}

/** Compte les blocs « <level> [[…/resources/…]] » restants. */
export function countResourceBlocks(text: string, level: '##' | '###'): number {
  const re = new RegExp(`^${level} \\[\\[[^\\]]*resources/`);
  return text.split('\n').filter((l) => re.test(l)).length;
}

/** Compte les lignes de table « | [[…/resources/…]] | ». */
export function countTableRows(text: string): number {
  const re = /^\|\s*\[\[[^\]]*resources\//;
  return text.split('\n').filter((l) => re.test(l)).length;
}

/** Compacte 3+ sauts de ligne consécutifs en 2, et nettoie les bords. */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').replace(/\n+$/,'\n');
}

/**
 * Décrémente le premier entier d'une ligne identifiée par un lien wiki `target`
 * (ex. « - [[themes/finops-ia|…]] — 8 ressources » → 7). Best-effort : sans
 * impact si la ligne/le nombre est introuvable.
 */
export function decrementCountOnLineWith(text: string, needle: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      lines[i] = lines[i].replace(/(\d+)/, (d) => String(Math.max(0, parseInt(d, 10) - 1)));
      return lines.join('\n');
    }
  }
  return text;
}

/** Ajuste (±) le compteur entre parenthèses d'un heading (`## Ressources (13)`). */
export function adjustHeadingCount(text: string, headingRe: RegExp, delta: number): string {
  return text.replace(headingRe, (line) =>
    line.replace(/\((\d+)\)/, (_m, d) => `(${Math.max(0, parseInt(d, 10) + delta)})`),
  );
}

// ————————————————————————————————————————————————————————————————
// Graphe

/** Parse graph.json en objet typé (tolérant). */
export function parseGraph(content: string): Graph {
  const g = JSON.parse(content);
  return {
    generated: String(g.generated ?? ''),
    nodes: Array.isArray(g.nodes) ? g.nodes : [],
    edges: Array.isArray(g.edges) ? g.edges : [],
  };
}

/** Une entrée node/edge sur une ligne, style « spacé » du fichier existant. */
function graphLine(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{${parts.join(', ')}}`;
}

/** Sérialise le graphe (un node/edge par ligne, JSON valide, déterministe). */
export function serializeGraph(g: Graph): string {
  const nodes = g.nodes.map((n) => `    ${graphLine(n)}`).join(',\n');
  const edges = g.edges.map((e) => `    ${graphLine(e)}`).join(',\n');
  return (
    `{\n  "generated": ${JSON.stringify(g.generated)},\n` +
    `  "nodes": [\n${nodes}\n  ],\n` +
    `  "edges": [\n${edges}\n  ]\n}\n`
  );
}

function hasNode(g: Graph, id: string): boolean {
  return g.nodes.some((n) => n.id === id);
}

/** Ajoute un node s'il n'existe pas (idempotent). */
function upsertNode(g: Graph, node: GraphNode): void {
  if (!hasNode(g, node.id)) g.nodes.push(node);
}

/**
 * Ajoute/fusionne un edge `mentions` (une seule arête par paire ressource↔entité ;
 * fusionne les `sections`, omet le champ si un lien niveau ressource existe).
 */
function upsertMentionEdge(g: Graph, source: string, target: string, sections: string[] | null): void {
  const existing = g.edges.find(
    (e) => e.source === source && e.target === target && e.relation === 'mentions',
  );
  if (existing) {
    if (sections === null) {
      delete existing.sections; // niveau ressource : plus de sections
    } else if (existing.sections) {
      existing.sections = [...new Set([...existing.sections, ...sections])];
    }
    return;
  }
  const edge: GraphEdge = { source, target, relation: 'mentions' };
  if (sections && sections.length) edge.sections = sections;
  g.edges.push(edge);
}

/** Ajoute un edge `belongs_to_theme` s'il n'existe pas. */
function upsertThemeEdge(g: Graph, source: string, target: string): void {
  const exists = g.edges.some(
    (e) => e.source === source && e.target === target && e.relation === 'belongs_to_theme',
  );
  if (!exists) g.edges.push({ source, target, relation: 'belongs_to_theme' });
}

// ————————————————————————————————————————————————————————————————
// JSON : candidates & manifeste

/** Retire une candidate (par `normalized`) et re-sérialise. */
export function purgeCandidate(candidatesJson: string, normalized: string): string {
  const doc = JSON.parse(candidatesJson);
  doc.candidates = (doc.candidates ?? []).filter(
    (c: any) => String(c?.normalized) !== normalized,
  );
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Retire la clé `source_file` du manifeste _ingested.json. */
export function removeManifestKey(manifestJson: string, sourceFile: string): string {
  const doc = JSON.parse(manifestJson);
  if (doc.files && sourceFile in doc.files) delete doc.files[sourceFile];
  return JSON.stringify(doc, null, 2) + '\n';
}

// ————————————————————————————————————————————————————————————————
// Lecture légère d'une ressource (métadonnées d'affichage)

export interface ResourceMeta {
  slug: string;
  title: string;
  author: string | null;
  date: string | null;
  source_type: string | null;
  origin: string | null;
  topics: string[];
  entities: string[];
  source_file: string | null;
  body: string;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}
function str(v: unknown): string | null {
  if (typeof v !== 'string') return v == null ? null : String(v);
  const t = v.trim();
  return t ? t : null;
}
function chunkArray(body: string, key: 'entities' | 'topics'): string[] {
  const out: string[] = [];
  const re = new RegExp(`^\`${key}:\\s*\\[([^\\]]*)\\]\`\\s*$`);
  for (const line of body.split('\n')) {
    const m = line.trim().match(re);
    if (m) out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

/** Parse resources/<slug>.md → métadonnées + corps (frontmatter ∪ chunks). */
export function parseResourceMeta(content: string, slug: string): ResourceMeta {
  const { data, content: body } = matter(content);
  return {
    slug: str(data.slug) ?? slug,
    title: str(data.title) ?? str(data.slug) ?? slug,
    author: str(data.author),
    date: str(data.date),
    source_type: str(data.source_type),
    origin: str(data.origin),
    topics: [...new Set([...arr(data.topics), ...chunkArray(body, 'topics')])],
    entities: [...new Set([...arr(data.entities), ...chunkArray(body, 'entities')])],
    source_file: str(data.source_file),
    body,
  };
}

/**
 * Clé de rapprochement tolérante : sans accents, tirets compactés. Les slugs de
 * section fournis par les candidates sont parfois désaccentués/compactés alors
 * que l'ancre GitHub réelle conserve accents et doubles tirets — on rapproche via
 * cette clé, mais on ÉCRIT toujours l'ancre réelle (headingSlug).
 */
function looseKey(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/-+/g, '-');
}

interface FoundHeading {
  index: number;
  text: string;
  anchor: string; // ancre GitHub réelle (headingSlug du titre)
}

/** Localise le heading d'une section (rapprochement tolérant accents/tirets). */
function findHeading(lines: string[], sectionSlug: string): FoundHeading | null {
  const target = looseKey(sectionSlug);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{2,3}\s+(.+)$/);
    if (!m) continue;
    const anchor = headingSlug(m[1]);
    if (anchor === sectionSlug || looseKey(anchor) === target) {
      return { index: i, text: m[1].trim(), anchor };
    }
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// Liaison d'une ressource à une entité / un thème (niveau chunk)

/** Insère un slug dans une ligne backtickée `` `key: [..]` ``. */
function insertIntoBacktickedArray(line: string, key: string, slug: string): string {
  const re = new RegExp(`^\`${key}:\\s*\\[(.*)\\]\`\\s*$`);
  const m = line.trim().match(re);
  if (!m) return line;
  const inner = m[1].trim();
  const items = inner ? inner.split(',').map((s) => s.trim()) : [];
  if (items.includes(slug)) return line;
  return inner ? `\`${key}: [${inner}, ${slug}]\`` : `\`${key}: [${slug}]\``;
}

/**
 * Relie une ressource à un slug au niveau CHUNK : ajoute/complète une ligne
 * `` `entities: [slug]` `` (ou `topics:`) sous le heading dont le slug d'ancre
 * correspond. Renvoie le corps modifié (idempotent).
 */
export function addChunkLink(
  body: string,
  sectionSlug: string,
  key: 'entities' | 'topics',
  slug: string,
): string {
  const lines = body.split('\n');
  const found = findHeading(lines, sectionSlug);
  if (!found) return body; // section introuvable
  const h = found.index;

  let topicsLine = -1;
  const backRe = new RegExp(`^\`${key}:\\s*\\[`);
  for (let i = h + 1; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i])) break;
    if (backRe.test(lines[i].trim())) {
      lines[i] = insertIntoBacktickedArray(lines[i], key, slug);
      return lines.join('\n');
    }
    if (/^`topics:\s*\[/.test(lines[i].trim())) topicsLine = i;
  }
  const insertAt = topicsLine !== -1 ? topicsLine + 1 : h + 1;
  lines.splice(insertAt, 0, `\`${key}: [${slug}]\``);
  return lines.join('\n');
}

/** Ajoute un thème au blockquote de navigation `> Par … · Thèmes : [[…]]`. */
export function addThemeToNav(body: string, slug: string, label: string): string {
  const lines = body.split('\n');
  const link = `[[../themes/${slug}|${label}]]`;
  for (let i = 0; i < lines.length; i++) {
    if (/^>\s*Par\s+/i.test(lines[i])) {
      if (lines[i].includes(`themes/${slug}|`)) return body; // déjà présent
      if (/Thèmes\s*:/.test(lines[i])) lines[i] = `${lines[i]} · ${link}`;
      else lines[i] = `${lines[i]} · Thèmes : ${link}`;
      return lines.join('\n');
    }
  }
  return body;
}

// ————————————————————————————————————————————————————————————————
// Construction de blocs « Mentions » (page entité) et de blocs de thème

function entityMetaLine(m: ResourceMeta): string {
  const bits = [m.date, m.source_type].filter(Boolean).join(' · ');
  return `\`${bits}${m.author ? ` — ${m.author}` : ''}\``;
}

function mentionBullet(m: ResourceMeta, seen: SeenIn): string {
  if (!seen.section) return `- Ressource entière : ${seen.context}`;
  const found = findHeading(m.body.split('\n'), seen.section);
  const anchor = found?.anchor ?? seen.section;
  const title = found?.text ?? seen.section;
  return `- [[../resources/${m.slug}#${anchor}|${title}]] — ${seen.context}`;
}

/** Construit le bloc `### [[..]]` + méta + puces pour la page entité. */
function buildEntityMentionBlock(m: ResourceMeta, seens: SeenIn[]): string {
  const header = `### [[../resources/${m.slug}|${m.title}]]`;
  const meta = entityMetaLine(m);
  const bullets = seens.map((s) => mentionBullet(m, s)).join('\n');
  return `${header}\n${meta}\n${bullets}`;
}

/** Ajoute (ou complète) un bloc de mentions dans le corps d'une page entité. */
function appendEntityMention(entityBody: string, m: ResourceMeta, seens: SeenIn[]): string {
  if (new RegExp(`^### \\[\\[[^\\]]*resources/${escapeRe(m.slug)}[|#\\]]`, 'm').test(entityBody)) {
    return entityBody; // déjà mentionnée : idempotent (on ne duplique pas)
  }
  const block = buildEntityMentionBlock(m, seens);
  const trimmed = entityBody.replace(/\n+$/, '');
  return `${trimmed}\n\n${block}\n`;
}

function themeMetaLine(m: ResourceMeta): string {
  const bits = [m.date, m.source_type, m.origin].filter(Boolean).join(' · ');
  return `\`${bits}${m.author ? ` — ${m.author}` : ''}\``;
}

/** Construit le bloc `## [[..]]` + méta + puces pour une page thème. */
function buildThemeBlock(m: ResourceMeta, seens: SeenIn[]): string {
  const header = `## [[../resources/${m.slug}|${m.title}]]`;
  const meta = themeMetaLine(m);
  const bullets = seens
    .map((s) => {
      if (!s.section) return `- Ressource entière — ${s.context}`;
      const found = findHeading(m.body.split('\n'), s.section);
      const anchor = found?.anchor ?? s.section;
      const title = found?.text ?? s.section;
      return `- [[../resources/${m.slug}#${anchor}|${title}]] — ${s.context}`;
    })
    .join('\n');
  return `${header}\n${meta}\n\n${bullets}`;
}

/** Extrait le label (quoté ou non) d'un frontmatter d'entité/thème. */
function labelOf(fm: string): string {
  return fm.match(/^label:\s*"?([^"\n]+?)"?\s*$/m)?.[1]?.trim() ?? '';
}

// ————————————————————————————————————————————————————————————————
// APPLY : décision entité

export interface EntityDecisionInput {
  action: 'merge_alias' | 'create' | 'reject';
  candidate: {
    name: string;
    normalized: string;
    variants: string[];
    seen_in: SeenIn[];
  };
  decision: { target_slug: string | null; entity_type: string | null; slug: string | null };
  /** Contenu de chaque resources/<slug>.md cité dans seen_in (clé = slug). */
  resources: Record<string, string>;
  /** Contenu de la page entité cible (merge) — null pour create. */
  entityPage: string | null;
  /** graph.json courant. */
  graph: string;
  /** entities/_candidates.json courant. */
  candidatesJson: string;
  today: string;
}

export function applyEntityDecision(input: EntityDecisionInput): FileOp[] {
  const { action, candidate, decision, today } = input;
  const ops: FileOp[] = [];

  // reject : purge seule.
  if (action === 'reject') {
    return [{ path: 'wiki/entities/_candidates.json', content: purgeCandidate(input.candidatesJson, candidate.normalized) }];
  }

  const effectiveSlug = action === 'merge_alias' ? decision.target_slug! : decision.slug!;
  const graph = parseGraph(input.graph);
  graph.generated = today;

  // Regrouper les seen_in par ressource.
  const byResource = new Map<string, SeenIn[]>();
  for (const s of candidate.seen_in) {
    if (!byResource.has(s.resource)) byResource.set(s.resource, []);
    byResource.get(s.resource)!.push(s);
  }

  // Métadonnées de chaque ressource (pour les blocs de mention).
  const metas: Record<string, ResourceMeta> = {};
  for (const [slug, seens] of byResource) {
    const content = input.resources[slug];
    if (!content) continue; // ressource absente : on saute (best-effort)
    const meta = parseResourceMeta(content, slug);
    metas[slug] = meta;

    // 1. Relier la ressource (frontmatter ou chunk).
    const { fm, rest } = splitFrontmatter(content);
    let newFm = fm;
    let newBody = rest;
    const resourceLevel = seens.some((s) => s.section === null);
    if (resourceLevel) {
      newFm = patchInlineArray(fm, 'entities', effectiveSlug);
    } else {
      for (const s of seens) {
        if (s.section) newBody = addChunkLink(newBody, s.section, 'entities', effectiveSlug);
      }
    }
    ops.push({ path: `wiki/resources/${slug}.md`, content: withFrontmatter(newFm, newBody) });

    // 2. Graphe : node ressource garanti + edge mentions.
    const sections = resourceLevel ? null : seens.map((s) => s.section!).filter(Boolean);
    upsertMentionEdge(graph, `resource:${slug}`, `entity:${effectiveSlug}`, sections);
  }

  // 3. Page entité (create : nouvelle ; merge : append aux Mentions + alias).
  if (action === 'create') {
    const label = candidate.name;
    const entityType = decision.entity_type!;
    const cleanAliases = meaningfulAliases(candidate.variants, label);
    const aliasList = cleanAliases.length
      ? `[${cleanAliases.map((v) => JSON.stringify(v)).join(', ')}]`
      : '[]';
    let page =
      `---\ntype: entity\nentity_type: ${entityType}\nslug: ${effectiveSlug}\n` +
      `label: ${JSON.stringify(label)}\naliases: ${aliasList}\n---\n\n` +
      `# ${label}\n\n\`entity_type: ${entityType}\`\n\n## Mentions\n`;
    for (const [slug, seens] of byResource) {
      if (metas[slug]) page = appendEntityMention(page, metas[slug], seens);
    }
    ops.push({ path: `wiki/entities/${effectiveSlug}.md`, content: page });
    upsertNode(graph, { id: `entity:${effectiveSlug}`, type: 'entity', entity_type: entityType, label } as GraphNode);
  } else {
    // merge_alias : ajoute nom + variants aux aliases, append les mentions.
    let page = input.entityPage ?? '';
    const { fm, rest } = splitFrontmatter(page);
    let newFm = fm;
    for (const alias of meaningfulAliases([candidate.name, ...candidate.variants], labelOf(fm))) {
      newFm = patchInlineArray(newFm, 'aliases', alias, { quote: true });
    }
    let newBody = rest;
    for (const [slug, seens] of byResource) {
      if (metas[slug]) newBody = appendEntityMention(newBody, metas[slug], seens);
    }
    ops.push({ path: `wiki/entities/${effectiveSlug}.md`, content: withFrontmatter(newFm, newBody) });
  }

  // 4. Graphe + purge candidate.
  ops.push({ path: 'wiki/graph.json', content: serializeGraph(graph) });
  ops.push({ path: 'wiki/entities/_candidates.json', content: purgeCandidate(input.candidatesJson, candidate.normalized) });
  return ops;
}

// ————————————————————————————————————————————————————————————————
// APPLY : décision thème

export interface ThemeDecisionInput {
  action: 'merge_alias' | 'create' | 'reject';
  candidate: { name: string; normalized: string; variants: string[]; seen_in: SeenIn[] };
  decision: { target_slug: string | null; slug: string | null };
  resources: Record<string, string>;
  /** Contenu de la page thème (create : null). */
  themePage: string | null;
  graph: string;
  candidatesJson: string;
  /** index.md courant (pour compteurs à la création). */
  index: string;
  today: string;
}

export function applyThemeDecision(input: ThemeDecisionInput): FileOp[] {
  const { action, candidate, decision, today } = input;
  if (action === 'reject') {
    return [{ path: 'wiki/themes/_candidates.json', content: purgeCandidate(input.candidatesJson, candidate.normalized) }];
  }

  const effectiveSlug = action === 'merge_alias' ? decision.target_slug! : decision.slug!;
  const label = candidate.name;
  const ops: FileOp[] = [];
  const graph = parseGraph(input.graph);
  graph.generated = today;

  const byResource = new Map<string, SeenIn[]>();
  for (const s of candidate.seen_in) {
    if (!byResource.has(s.resource)) byResource.set(s.resource, []);
    byResource.get(s.resource)!.push(s);
  }

  const metas: Record<string, ResourceMeta> = {};
  for (const [slug, seens] of byResource) {
    const content = input.resources[slug];
    if (!content) continue;
    const meta = parseResourceMeta(content, slug);
    metas[slug] = meta;

    const { fm, rest } = splitFrontmatter(content);
    let newFm = fm;
    let newBody = rest;
    const resourceLevel = seens.some((s) => s.section === null);
    if (resourceLevel) newFm = patchInlineArray(fm, 'topics', effectiveSlug);
    else for (const s of seens) if (s.section) newBody = addChunkLink(newBody, s.section, 'topics', effectiveSlug);
    newBody = addThemeToNav(newBody, effectiveSlug, label);
    ops.push({ path: `wiki/resources/${slug}.md`, content: withFrontmatter(newFm, newBody) });

    upsertThemeEdge(graph, `resource:${slug}`, `theme:${effectiveSlug}`);
  }

  // Page thème.
  if (action === 'create') {
    const cleanAliases = meaningfulAliases(candidate.variants, label);
    const aliasLine = cleanAliases.length
      ? `\naliases: [${cleanAliases.map((v) => JSON.stringify(v)).join(', ')}]`
      : '';
    const blocks = [...byResource.entries()]
      .filter(([slug]) => metas[slug])
      .map(([slug, seens]) => buildThemeBlock(metas[slug], seens))
      .join('\n\n---\n\n');
    const page =
      `---\ntype: theme\nslug: ${effectiveSlug}\nlabel: ${JSON.stringify(label)}${aliasLine}\n` +
      `resource_count: ${byResource.size}\nlast_updated: ${JSON.stringify(today)}\n---\n\n${blocks}\n`;
    ops.push({ path: `wiki/themes/${effectiveSlug}.md`, content: page });
    upsertNode(graph, { id: `theme:${effectiveSlug}`, type: 'theme', label } as GraphNode);
    // index.md : bullet + compteurs.
    let index = adjustHeadingCount(input.index, /^## Thèmes \(\d+\)/m, 1);
    const { fm, rest } = splitFrontmatter(index);
    const newFm = bumpScalarInt(fm, 'theme_count', 1);
    index = withFrontmatter(newFm, addThemeBullet(rest, effectiveSlug, label, byResource.size));
    ops.push({ path: 'wiki/index.md', content: index });
  } else {
    let page = input.themePage ?? '';
    const { fm, rest } = splitFrontmatter(page);
    let newFm = fm;
    for (const alias of meaningfulAliases([candidate.name, ...candidate.variants], labelOf(fm))) {
      newFm = patchInlineArray(newFm, 'aliases', alias, { quote: true });
    }
    newFm = bumpScalarInt(newFm, 'resource_count', byResource.size);
    newFm = setScalar(newFm, 'last_updated', JSON.stringify(today));
    const blocks = [...byResource.entries()]
      .filter(([slug]) => metas[slug])
      .map(([slug, seens]) => buildThemeBlock(metas[slug], seens))
      .join('\n\n---\n\n');
    const newBody = `${rest.replace(/\n+$/, '')}\n\n---\n\n${blocks}\n`;
    ops.push({ path: `wiki/themes/${effectiveSlug}.md`, content: withFrontmatter(newFm, newBody) });
  }

  ops.push({ path: 'wiki/graph.json', content: serializeGraph(graph) });
  ops.push({ path: 'wiki/themes/_candidates.json', content: purgeCandidate(input.candidatesJson, candidate.normalized) });
  return ops;
}

/** Ajoute un bullet de thème dans la section « ## Thèmes » de index.md. */
function addThemeBullet(body: string, slug: string, label: string, count: number): string {
  const lines = body.split('\n');
  const bullet = `- [[themes/${slug}|${label}]] — ${count} ressource${count > 1 ? 's' : ''}`;
  for (let i = 0; i < lines.length; i++) {
    if (/^## Thèmes/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !/^## /.test(lines[j]) && !/^---/.test(lines[j])) j++;
      // insérer avant la première ligne vide/heading de fin de section
      let k = j - 1;
      while (k > i && lines[k].trim() === '') k--;
      lines.splice(k + 1, 0, bullet);
      return lines.join('\n');
    }
  }
  return body;
}

// ————————————————————————————————————————————————————————————————
// DELETE : suppression d'une ressource

export interface DeleteViews {
  /** themes/<slug>.md par slug de thème. */
  themes: Record<string, string>;
  /** authors/<slug>.md (slug = slugify(author)). */
  authorPath: string | null;
  authorContent: string | null;
  /** origin/<val>.md. */
  originPath: string | null;
  originContent: string | null;
  /** entities/<slug>.md par slug. */
  entities: Record<string, string>;
  /** by-date : contenu de la page année et (si mois) de la page mois. */
  yearPath: string | null;
  yearContent: string | null;
  monthPath: string | null;
  monthContent: string | null;
  graph: string;
  manifest: string;
  index: string;
  types: string | null;
  /** raw : true si le sidecar .meta.md existe (à supprimer aussi). */
  metaExists: boolean;
}

export interface DeleteResourceInput {
  slug: string;
  resourceContent: string;
  views: DeleteViews;
  /** slugify (injecté pour éviter une dépendance @/). */
  slugifyAuthor: (name: string) => string;
  typeLabel: (sourceType: string) => string;
}

export function deleteResource(input: DeleteResourceInput): FileOp[] {
  const meta = parseResourceMeta(input.resourceContent, input.slug);
  const { slug } = input;
  const v = input.views;
  const ops: FileOp[] = [];
  const orphanAuthors: string[] = [];
  const orphanDates: string[] = []; // ids date:<…> orphelins

  // 1. La ressource canonique.
  ops.push({ path: `wiki/resources/${slug}.md`, delete: true });

  // 2. Thèmes : retirer le bloc + recompute resource_count. Registre = jamais delete.
  for (const topic of meta.topics) {
    const content = v.themes[topic];
    if (!content) continue;
    let out = removeResourceBlock(content, '##', slug);
    const { fm, rest } = splitFrontmatter(out);
    const newFm = setScalar(fm, 'resource_count', String(countResourceBlocks(rest, '##')));
    ops.push({ path: `wiki/themes/${topic}.md`, content: withFrontmatter(newFm, rest) });
  }

  // 3. Auteur : retirer la ligne. Orphelin (0 ligne) → delete page + node.
  if (meta.author && v.authorContent && v.authorPath) {
    const authorSlug = input.slugifyAuthor(meta.author);
    const out = removeTableRow(v.authorContent, slug);
    if (countTableRows(out) === 0) {
      ops.push({ path: v.authorPath, delete: true });
      orphanAuthors.push(authorSlug);
    } else {
      const { fm, rest } = splitFrontmatter(out);
      ops.push({ path: v.authorPath, content: withFrontmatter(setScalar(fm, 'resource_count', String(countTableRows(rest))), rest) });
    }
  }

  // 4. Origine : retirer le bloc + recompute. Jamais delete (enum).
  if (meta.origin && v.originContent && v.originPath) {
    const out = removeResourceBlock(v.originContent, '##', slug);
    const { fm, rest } = splitFrontmatter(out);
    ops.push({ path: v.originPath, content: withFrontmatter(setScalar(fm, 'resource_count', String(countResourceBlocks(rest, '##'))), rest) });
  }

  // 5. by-date : mois puis année. Orphelins → delete + nodes.
  const date = meta.date ?? '';
  const isMonth = date.length >= 7;
  const year = date.slice(0, 4);
  const ym = date.slice(0, 7);
  if (isMonth && v.monthContent && v.monthPath) {
    const out = removeTableRow(v.monthContent, slug);
    if (countTableRows(out) === 0) {
      ops.push({ path: v.monthPath, delete: true });
      orphanDates.push(`date:${ym}`);
      // Retirer le bullet du mois dans la page année.
      if (v.yearContent && v.yearPath) {
        v.yearContent = removeLinesWithMonth(v.yearContent, ym);
      }
    } else {
      const { fm, rest } = splitFrontmatter(out);
      ops.push({ path: v.monthPath, content: withFrontmatter(setScalar(fm, 'resource_count', String(countTableRows(rest))), rest) });
    }
  }
  if (v.yearContent && v.yearPath) {
    // Retirer une éventuelle ligne « année seulement » de cette ressource.
    let yearOut = removeTableRow(v.yearContent, slug);
    const rowsLeft = countTableRows(yearOut);
    const monthsLeft = /^-\s*\[\[by-date\//m.test(yearOut);
    if (rowsLeft === 0 && !monthsLeft) {
      ops.push({ path: v.yearPath, delete: true });
      orphanDates.push(`date:${year}`);
    } else {
      const { fm, rest } = splitFrontmatter(yearOut);
      ops.push({ path: v.yearPath, content: withFrontmatter(bumpScalarInt(fm, 'resource_count', -1), rest) });
    }
  }

  // 6. Entités : retirer le bloc `### [[..]]` des Mentions. Registre = jamais delete.
  for (const ent of meta.entities) {
    const content = v.entities[ent];
    if (!content) continue;
    ops.push({ path: `wiki/entities/${ent}.md`, content: removeResourceBlock(content, '###', slug) });
  }

  // 7. types.md : retirer la ligne + décrémenter le compteur « (N ressources) »
  // du heading de ce type (le heading utilise le source_type brut, ex. `## article`).
  if (v.types && meta.source_type) {
    let out = removeTableRow(v.types, slug);
    out = out.replace(
      new RegExp(`^(## ${escapeRe(meta.source_type)}) \\((\\d+) ressources?\\)`, 'm'),
      (_m, h, n) => {
        const next = Math.max(0, parseInt(n, 10) - 1);
        return `${h} (${next} ressource${next > 1 ? 's' : ''})`;
      },
    );
    ops.push({ path: 'wiki/types.md', content: out });
  }

  // 8. graph.json : retirer le node ressource + ses edges ; puis nodes dérivés orphelins.
  const graph = parseGraph(v.graph);
  const rid = `resource:${slug}`;
  graph.edges = graph.edges.filter((e) => e.source !== rid && e.target !== rid);
  graph.nodes = graph.nodes.filter((n) => n.id !== rid);
  // Auteur orphelin.
  for (const a of orphanAuthors) graph.nodes = graph.nodes.filter((n) => n.id !== `author:${a}`);
  // Type orphelin : plus aucune ressource → node type retiré. Déterminé par
  // l'absence d'edge has_type vers ce type après filtrage.
  if (meta.source_type) {
    const typeId = `type:${meta.source_type}`;
    if (!graph.edges.some((e) => e.relation === 'has_type' && e.target === typeId)) {
      graph.nodes = graph.nodes.filter((n) => n.id !== typeId);
    }
  }
  // Dates orphelines : node + edges year_of.
  for (const d of orphanDates) {
    graph.nodes = graph.nodes.filter((n) => n.id !== d);
    graph.edges = graph.edges.filter((e) => !(e.relation === 'year_of' && (e.source === d || e.target === d)));
  }
  ops.push({ path: 'wiki/graph.json', content: serializeGraph(graph) });

  // 9. _ingested.json : retirer la clé source_file.
  if (meta.source_file) {
    ops.push({ path: 'wiki/_ingested.json', content: removeManifestKey(v.manifest, meta.source_file) });
  }

  // 10. index.md : retrait du bullet + décréments.
  let index = v.index;
  const { fm: ifm, rest: ibody } = splitFrontmatter(index);
  let body = removeLinesWithResource(ibody, slug);
  body = adjustHeadingCount(body, /^## Ressources \(\d+\)/m, -1);
  if (meta.source_type) {
    const label = input.typeLabel(meta.source_type);
    body = adjustHeadingCount(body, new RegExp(`^### ${escapeRe(label)} \\(\\d+\\)`, 'm'), -1);
  }
  for (const topic of meta.topics) body = decrementCountOnLineWith(body, `themes/${topic}|`);
  // Entités : miroir des thèmes — décrémente le bullet, jamais retiré (registre = jamais
  // delete) ni le heading « ## Entités (N) » (compte des entités distinctes, inchangé).
  for (const ent of meta.entities) body = decrementCountOnLineWith(body, `entities/${ent}|`);
  if (meta.origin) body = decrementCountOnLineWith(body, `origin/${meta.origin}|`);
  if (year) body = decrementCountOnLineWith(body, `by-date/${year}/${year}|`);
  // Auteur : bullet retiré si orphelin, sinon compteur décrémenté.
  if (meta.author) {
    const authorSlug = input.slugifyAuthor(meta.author);
    if (orphanAuthors.includes(authorSlug)) {
      body = removeLinesWithResource2(body, `authors/${authorSlug}|`);
      body = adjustHeadingCount(body, /^## Auteurs \(\d+\)/m, -1);
    } else {
      body = decrementCountOnLineWith(body, `authors/${authorSlug}|`);
    }
  }
  let newIfm = bumpScalarInt(ifm, 'resource_count', -1);
  if (orphanAuthors.length) newIfm = bumpScalarInt(newIfm, 'author_count', -orphanAuthors.length);
  index = withFrontmatter(newIfm, body);
  ops.push({ path: 'wiki/index.md', content: index });

  // 11. Fichiers bruts.
  if (meta.source_file) {
    ops.push({ path: `raw/${meta.source_file}`, delete: true });
    if (v.metaExists) ops.push({ path: `raw/${meta.source_file}.meta.md`, delete: true });
  }

  return ops;
}

// ————————————————————————————————————————————————————————————————
// DELETE : entité (miroir de deleteResource — geste EXPLICITE, pas de cascade)

/** Retire un item d'un tableau inline `key: [a, b]` du frontmatter (préserve le reste verbatim). */
export function removeFromInlineArray(fm: string, key: string, item: string): string {
  const lines = fm.split('\n');
  const re = new RegExp(`^(${escapeRe(key)}):\\s*\\[(.*)\\]\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) {
      const items = m[2].trim()
        ? m[2].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
        : [];
      const kept = items.filter((x) => x !== item);
      lines[i] = `${m[1]}: [${kept.join(', ')}]`;
      return lines.join('\n');
    }
  }
  return fm;
}

/** Retire un item des annotations chunk `` `key: [a, b]` `` du corps (préserve l'indentation). */
function removeFromBacktickedArrays(body: string, key: string, item: string): string {
  const re = new RegExp(`^\`${escapeRe(key)}:\\s*\\[(.*)\\]\`\\s*$`);
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      const m = trimmed.match(re);
      if (!m) return line;
      const items = m[1].trim() ? m[1].split(',').map((s) => s.trim()) : [];
      const kept = items.filter((x) => x !== item);
      const indent = line.slice(0, line.length - trimmed.length);
      return `${indent}\`${key}: [${kept.join(', ')}]\``;
    })
    .join('\n');
}

/** Retire une entité (frontmatter `entities:` + annotations chunk) d'une ressource. */
function removeEntityLink(resourceContent: string, slug: string): string {
  const { fm, rest } = splitFrontmatter(resourceContent);
  const newFm = removeFromInlineArray(fm, 'entities', slug);
  const newBody = removeFromBacktickedArrays(rest, 'entities', slug);
  return withFrontmatter(newFm, newBody);
}

/** Slugs des ressources citées dans la section `## Mentions` d'une fiche entité (`### [[../resources/<slug>…]]`). */
export function entityReferencingResources(entityContent: string): string[] {
  const slugs = new Set<string>();
  const re = /^###\s+\[\[[^\]]*resources\/([a-z0-9-]+)[|#\]]/;
  for (const line of entityContent.split('\n')) {
    const m = line.match(re);
    if (m) slugs.add(m[1]);
  }
  return [...slugs];
}

/**
 * Purge DÉFENSIVE d'une candidate dont la décision (ou le nom slugifié) résout au slug
 * supprimé. En marche normale une entité validée n'a plus de candidate (create/merge la
 * purgent), d'où le `null` fréquent (= rien à écrire). Renvoie le JSON ou `null` si no-op.
 */
export function purgeCandidatesForEntity(
  candidatesJson: string,
  slug: string,
  slugify?: (s: string) => string,
): string | null {
  let doc: any;
  try {
    doc = JSON.parse(candidatesJson);
  } catch {
    return null;
  }
  const before = Array.isArray(doc.candidates) ? doc.candidates.length : 0;
  if (!before) return null;
  doc.candidates = doc.candidates.filter((c: any) => {
    const dslug = c?.decision?.slug ?? null;
    const dtarget = c?.decision?.target_slug ?? null;
    const nameSlug = slugify ? slugify(String(c?.name ?? '')) : null;
    return !(dslug === slug || dtarget === slug || nameSlug === slug);
  });
  if (doc.candidates.length === before) return null;
  return JSON.stringify(doc, null, 2) + '\n';
}

export interface DeleteEntityInput {
  slug: string;
  /** Contenu de `wiki/entities/<slug>.md` (source des ressources citantes). */
  entityContent: string;
  graph: string;
  /** `resources/<r>.md` par slug, pour chaque ressource citant l'entité (l'appelant les lit). */
  referencingResources?: Record<string, string>;
  /** `_candidates.json` — purge défensive d'une entrée éventuelle. */
  candidatesJson?: string;
  /** slugify (injecté) — rapproche une candidate éventuelle du slug supprimé. */
  slugify?: (s: string) => string;
}

/**
 * Supprime une entité du registre — geste EXPLICITE (jamais en cascade depuis
 * `deleteResource`). Retire : la fiche, le nœud `entity:<slug>` + ses arêtes, le lien
 * dans le frontmatter/annotations de chaque ressource citante, et purge défensivement
 * une candidate résiduelle. Fonction PURE (l'appelant applique les `FileOp`).
 */
export function deleteEntity(input: DeleteEntityInput): FileOp[] {
  const { slug } = input;
  const ops: FileOp[] = [];
  const eid = `entity:${slug}`;

  // 1. La fiche entité.
  ops.push({ path: `wiki/entities/${slug}.md`, delete: true });

  // 2. Ressources citantes : retirer le lien (frontmatter + chunk). Best-effort si illisible.
  const refResources = input.referencingResources ?? {};
  for (const r of entityReferencingResources(input.entityContent)) {
    const content = refResources[r];
    if (!content) continue;
    ops.push({ path: `wiki/resources/${r}.md`, content: removeEntityLink(content, slug) });
  }

  // 3. graph.json : retirer le nœud entité + toute arête le touchant (mentions, etc.).
  const graph = parseGraph(input.graph);
  graph.nodes = graph.nodes.filter((n) => n.id !== eid);
  graph.edges = graph.edges.filter((e) => e.source !== eid && e.target !== eid);
  ops.push({ path: 'wiki/graph.json', content: serializeGraph(graph) });

  // 4. _candidates.json : purge défensive (rare).
  if (input.candidatesJson) {
    const purged = purgeCandidatesForEntity(input.candidatesJson, slug, input.slugify);
    if (purged !== null) ops.push({ path: 'wiki/entities/_candidates.json', content: purged });
  }

  return ops;
}

// ————————————————————————————————————————————————————————————————
// DELETE : thème (miroir de deleteEntity — geste EXPLICITE, pas de cascade).
// Contrairement à l'entité, un thème apparaît AUSSI dans le blockquote de nav des
// ressources et dans la colonne « Topics » des pages auteur → deux strippers en plus.

/** Inverse de `addThemeToNav` : retire `[[../themes/<slug>|…]]` du blockquote de nav
 *  `> … · Thèmes : …`. Retire tout le segment « · Thèmes : … » si c'était le seul
 *  thème (et la ligne entière si la nav devient un blockquote vide). No-op si absent. */
export function removeThemeFromNav(body: string, slug: string): string {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*>/.test(line) || !/Th[èe]mes\s*:/.test(line) || !line.includes('themes/')) continue;
    const m = line.match(/^(.*?)(Th[èe]mes\s*:\s*)(.*)$/);
    if (!m) continue;
    const items = m[3].split(',').map((s) => s.trim()).filter(Boolean);
    const kept = items.filter((it) => !it.includes(`themes/${slug}|`));
    if (kept.length === items.length) return body; // slug absent → inchangé
    if (kept.length === 0) {
      const head = m[1].replace(/\s*·\s*$/, '').replace(/\s+$/, '');
      if (/^\s*>\s*$/.test(head)) lines.splice(i, 1); // nav dégénérée vidée → ligne retirée
      else lines[i] = head;
    } else {
      lines[i] = `${m[1]}Thèmes : ${kept.join(', ')}`;
    }
    return lines.join('\n');
  }
  return body;
}

/** Retire un thème (frontmatter `topics:` + annotations chunk + nav) d'une ressource.
 *  Miroir de `removeEntityLink`, plus le stripper de nav (les entités n'ont pas de nav). */
function removeThemeLink(resourceContent: string, slug: string): string {
  const { fm, rest } = splitFrontmatter(resourceContent);
  const newFm = removeFromInlineArray(fm, 'topics', slug);
  let newBody = removeFromBacktickedArrays(rest, 'topics', slug);
  newBody = removeThemeFromNav(newBody, slug);
  return withFrontmatter(newFm, newBody);
}

/** Retire un thème de la cellule « Topics » (DERNIÈRE colonne, sans pipe) de la ligne
 *  d'une ressource dans une page auteur. No-op si la ligne/le thème est absent. */
export function removeTopicFromAuthorRow(
  authorContent: string,
  resourceSlug: string,
  themeSlug: string,
): string {
  const rowRe = new RegExp(`^\\|\\s*\\[\\[[^\\]]*resources/${escapeRe(resourceSlug)}[\\\\|#\\]]`);
  const lines = authorContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!rowRe.test(lines[i])) continue;
    lines[i] = lines[i].replace(/\|([^|]*)\|(\s*)$/, (_m, cell: string, ws: string) => {
      const kept = cell.split(',').map((s) => s.trim()).filter((s) => s && s !== themeSlug);
      return `| ${kept.join(', ')} |${ws}`;
    });
    return lines.join('\n');
  }
  return authorContent;
}

export interface DeleteThemeInput {
  slug: string;
  graph: string; // contenu wiki/graph.json
  /** `resources/<r>.md` par slug, pour chaque ressource citant le thème (l'appelant les lit). */
  referencingResources?: Record<string, string>;
  /** `authors/<aslug>.md` par slug d'auteur (colonne Topics à nettoyer). */
  authorPages?: Record<string, string>;
  /** slugify auteur injecté (= `slugify` de wiki-parser, cf. projectResource). */
  slugify?: (s: string) => string;
}

/**
 * Supprime un thème du registre — geste EXPLICITE (jamais en cascade). Retire : la fiche
 * `wiki/themes/<slug>.md`, le thème du frontmatter/annotations/nav de chaque ressource
 * citante, le thème de la colonne « Topics » des pages auteur concernées, et le nœud
 * `theme:<slug>` + ses arêtes du graphe. `index.md` + `by-date/` sont reconstruits par
 * `rebuildDerivedIndexes` (appelé ensuite par la route, APRÈS le strip des ressources).
 * Fonction PURE (l'appelant applique les `FileOp`).
 */
export function deleteTheme(input: DeleteThemeInput): FileOp[] {
  const { slug } = input;
  const ops: FileOp[] = [];
  const tid = `theme:${slug}`;
  const refs = input.referencingResources ?? {};
  const slugifyFn = input.slugify ?? ((s) => s);

  // 1. La fiche de registre du thème.
  ops.push({ path: `wiki/themes/${slug}.md`, delete: true });

  // 2. Ressources citantes : strip frontmatter + chunk + nav. Éditions des pages auteur
  //    cumulées PAR slug auteur (plusieurs ressources peuvent partager une même page,
  //    et `applyFileOps` garde la DERNIÈRE écriture d'un chemin → on plie d'abord).
  const authorEdits = new Map<string, string>();
  for (const [r, content] of Object.entries(refs)) {
    ops.push({ path: `wiki/resources/${r}.md`, content: removeThemeLink(content, slug) });
    const meta = parseResourceMeta(content, r);
    if (meta.author && input.authorPages) {
      const aslug = slugifyFn(meta.author);
      const base = authorEdits.get(aslug) ?? input.authorPages[aslug];
      if (base) authorEdits.set(aslug, removeTopicFromAuthorRow(base, r, slug));
    }
  }
  for (const [aslug, content] of authorEdits) {
    ops.push({ path: `wiki/authors/${aslug}.md`, content });
  }

  // 3. graph.json : retirer le nœud theme:<slug> + toute arête le touchant.
  const graph = parseGraph(input.graph);
  graph.nodes = graph.nodes.filter((n) => n.id !== tid);
  graph.edges = graph.edges.filter((e) => e.source !== tid && e.target !== tid);
  ops.push({ path: 'wiki/graph.json', content: serializeGraph(graph) });

  return ops;
}

/** Retire la ligne bullet du mois `- [[by-date/Y/Y-M/Y-M|Y-M]] — …` de la page année. */
function removeLinesWithMonth(yearContent: string, ym: string): string {
  const re = new RegExp(`by-date/[^/]+/${escapeRe(ym)}/${escapeRe(ym)}[|\\]]`);
  return yearContent
    .split('\n')
    .filter((line) => !re.test(line))
    .join('\n');
}

/** Retire une ligne contenant `needle` (helper interne pour bullets index). */
function removeLinesWithResource2(text: string, needle: string): string {
  return text
    .split('\n')
    .filter((line) => !line.includes(needle))
    .join('\n');
}
