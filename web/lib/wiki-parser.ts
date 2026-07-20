import matter from 'gray-matter';
import path from 'path';
import {
  AuthorEntry,
  Candidate,
  DateEntry,
  GraphData,
  OriginEntry,
  OriginValue,
  ResourceType,
  Source,
  ThemeCandidate,
  ThemeEntry,
  TypeEntry,
  WikiTopic,
} from '@/types';
import { listWikiDir, readWikiFile } from '@/lib/wiki-fs';
import {
  ALL_ORIGINS,
  ALL_TYPES,
  TYPE_TO_FOLDER,
  originLabel,
  resolveSourceType,
  typeLabel,
} from '@/lib/ui';

const RESOURCES = 'resources';
const THEMES = 'themes';
const ENTITIES = 'entities';

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return v == null ? null : String(v);
  const t = v.trim();
  if (!t || t.toLowerCase() === 'unknown') return null;
  return t;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

/** Normalise le champ `origin` du frontmatter → 'interne' | 'externe' | null. */
function cleanOrigin(v: unknown): OriginValue | null {
  const s = cleanStr(v);
  return s === 'interne' || s === 'externe' ? s : null;
}

function normalizeType(rawType: unknown): ResourceType {
  return typeof rawType === 'string' ? resolveSourceType(rawType) : 'unknown';
}

/** Récupère les entités déclarées en chunk (`entities: [...]` sous un heading). */
function extractChunkEntities(body: string): string[] {
  const out: string[] = [];
  const re = /^`entities:\s*\[([^\]]*)\]`\s*$/;
  for (const line of body.split('\n')) {
    const m = line.trim().match(re);
    if (m) out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

export interface ParsedResource {
  source: Source;
  body: string; // markdown sans le frontmatter
}

/** Parse une ressource `resources/<slug>.md` → Source + corps markdown. */
export function parseResource(content: string, slugFallback: string): ParsedResource {
  const { data, content: body } = matter(content);

  const feEntities = arr(data.entities);
  const entities = [...new Set([...feEntities, ...extractChunkEntities(body)])];

  const source: Source = {
    slug: cleanStr(data.slug) ?? slugFallback,
    title: cleanStr(data.title) ?? cleanStr(data.slug) ?? slugFallback,
    type: normalizeType(data.source_type ?? data.type),
    author: cleanStr(data.author),
    date: cleanStr(data.date),
    url: cleanStr(data.url),
    deposited_by: cleanStr(data.deposited_by),
    topics: arr(data.topics),
    entities,
    origin: cleanOrigin(data.origin),
    needs_review: data.needs_review === true,
    source_file: cleanStr(data.source_file),
    file_path: `${RESOURCES}/${cleanStr(data.slug) ?? slugFallback}.md`,
  };

  return { source, body };
}

/** Toutes les ressources du wiki (resources/*.md), triées par date décroissante. */
export async function listAllSources(): Promise<Source[]> {
  const files = await listWikiDir(RESOURCES);
  const sources: Source[] = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = await readWikiFile(`${RESOURCES}/${file}`);
    if (!content.trim()) continue;
    sources.push(parseResource(content, path.basename(file, '.md')).source);
  }
  return sources.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** Une ressource complète (métadonnées + corps markdown), ou null si absente. */
export async function getResource(slug: string): Promise<ParsedResource | null> {
  const content = await readWikiFile(`${RESOURCES}/${slug}.md`);
  if (!content.trim()) return null;
  return parseResource(content, slug);
}

export interface SourceDetail {
  source: Source;
  body: string;
  rawFile: string | null; // nom du fichier de contenu dans /raw (pour le proxy)
  isPdf: boolean;
}

/** Détail d'une ressource par slug (lecture fs). */
export async function getSourceDetail(slug: string): Promise<SourceDetail | null> {
  const parsed = await getResource(slug);
  if (!parsed) return null;
  const rawFile = parsed.source.source_file ?? null;
  const isPdf = !!rawFile && rawFile.toLowerCase().endsWith('.pdf');
  return { source: parsed.source, body: parsed.body, rawFile, isPdf };
}

/** Pages thématiques (themes/*.md) avec compteur de sources. */
export async function listTopics(): Promise<WikiTopic[]> {
  const files = await listWikiDir(THEMES);
  const all = await listAllSources();
  const topics: WikiTopic[] = [];
  for (const file of files) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const content = await readWikiFile(`${THEMES}/${file}`);
    const { data } = matter(content);
    const slug = cleanStr(data.slug) ?? path.basename(file, '.md');
    const title = cleanStr(data.label) ?? slug;
    const sources = all.filter((s) => s.topics.includes(slug));
    topics.push({
      slug,
      title,
      source_count: sources.length,
      sources,
      last_updated: cleanStr(data.last_updated),
    });
  }
  return topics.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Registre des thèmes (themes/*.md, hors _candidates). Version légère de
 * listTopics() (frontmatter seul, pas de scan des ressources) : alimente le
 * ThemePicker de l'upload et le registre de la page /themes. Miroir de
 * listEntities(), sans la dimension `entity_type`.
 */
export async function listThemes(): Promise<ThemeEntry[]> {
  const files = await listWikiDir(THEMES);
  const themes: ThemeEntry[] = [];
  for (const file of files) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const content = await readWikiFile(`${THEMES}/${file}`);
    const { data } = matter(content);
    const slug = cleanStr(data.slug) ?? path.basename(file, '.md');
    themes.push({
      slug,
      label: cleanStr(data.label) ?? slug,
      aliases: arr(data.aliases),
    });
  }
  return themes.sort((a, b) => a.label.localeCompare(b.label));
}

/** Auteurs distincts (dérivés des ressources) avec compteurs. */
export async function listAuthors(): Promise<AuthorEntry[]> {
  const sources = await listAllSources();
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

/** Types de ressource présents (dérivés des ressources) avec compteurs. */
export async function listTypes(): Promise<TypeEntry[]> {
  const sources = await listAllSources();
  const counts = new Map<ResourceType, number>();
  for (const s of sources) {
    const t = (s.type as ResourceType) ?? 'unknown';
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return ALL_TYPES.filter((t) => counts.has(t)).map((t) => ({
    type: t,
    folder: TYPE_TO_FOLDER[t],
    label: typeLabel(t),
    source_count: counts.get(t) ?? 0,
  }));
}

/**
 * Origines présentes (dérivées des ressources) avec compteurs. Contrairement à
 * listTypes(), renvoie TOUJOURS les deux valeurs (même à 0) : enum fermé, filtre
 * stable, et miroir de la règle « les deux nœuds origin sont toujours présents ».
 */
export async function listOrigins(): Promise<OriginEntry[]> {
  const sources = await listAllSources();
  const counts = new Map<OriginValue, number>();
  for (const s of sources) {
    if (s.origin) counts.set(s.origin, (counts.get(s.origin) ?? 0) + 1);
  }
  return ALL_ORIGINS.map((o) => ({
    value: o,
    label: originLabel(o),
    source_count: counts.get(o) ?? 0,
  }));
}

/** Entrées de date (par mois, année seule, inconnu) dérivées des ressources. */
export async function listDates(): Promise<DateEntry[]> {
  const sources = await listAllSources();
  const months = new Map<string, number>();
  const yearsOnly = new Map<string, number>();
  let unknown = 0;

  for (const s of sources) {
    const d = s.date;
    if (!d) unknown += 1;
    else if (d.length >= 7) {
      const ym = d.slice(0, 7);
      months.set(ym, (months.get(ym) ?? 0) + 1);
    } else {
      const y = d.slice(0, 4);
      yearsOnly.set(y, (yearsOnly.get(y) ?? 0) + 1);
    }
  }

  const entries: DateEntry[] = [];
  for (const [ym, count] of months) {
    entries.push({ year: ym.slice(0, 4), month: ym, label: ym, source_count: count, is_unknown: false });
  }
  for (const [y, count] of yearsOnly) {
    entries.push({ year: y, month: null, label: `${y} (mois inconnu)`, source_count: count, is_unknown: true });
  }
  if (unknown > 0) {
    entries.push({ year: 'unknown', month: null, label: 'Date inconnue', source_count: unknown, is_unknown: true });
  }
  return entries.sort((a, b) => (b.month ?? b.year).localeCompare(a.month ?? a.year));
}

export interface EntityEntry {
  slug: string;
  label: string;
  entity_type: string;
  aliases: string[];
}

/** Registre des entités (entities/*.md, hors _candidates). */
export async function listEntities(): Promise<EntityEntry[]> {
  const files = await listWikiDir(ENTITIES);
  const entities: EntityEntry[] = [];
  for (const file of files) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const content = await readWikiFile(`${ENTITIES}/${file}`);
    const { data } = matter(content);
    const slug = cleanStr(data.slug) ?? path.basename(file, '.md');
    entities.push({
      slug,
      label: cleanStr(data.label) ?? slug,
      entity_type: cleanStr(data.entity_type) ?? 'entity',
      aliases: arr(data.aliases),
    });
  }
  return entities.sort((a, b) => a.label.localeCompare(b.label));
}

export interface EntityDetail {
  entity: EntityEntry;
  body: string; // corps markdown (## Mentions) sans le frontmatter
}

/** Une entité du registre par slug (frontmatter + corps Mentions), ou null. */
export async function getEntity(slug: string): Promise<EntityDetail | null> {
  const content = await readWikiFile(`${ENTITIES}/${slug}.md`);
  if (!content.trim()) return null;
  const { data, content: body } = matter(content);
  const s = cleanStr(data.slug) ?? slug;
  return {
    entity: {
      slug: s,
      label: cleanStr(data.label) ?? s,
      entity_type: cleanStr(data.entity_type) ?? 'entity',
      aliases: arr(data.aliases),
    },
    body,
  };
}

/**
 * File des entités candidates (wiki/entities/_candidates.json). Contrat partagé
 * entre les deux moteurs d'ingestion (LLM puis TypeScript) : ils écrivent ce
 * fichier, la plateforme le lit. Renvoie [] si absent ou illisible.
 */
export async function listCandidates(): Promise<Candidate[]> {
  const content = await readWikiFile(`${ENTITIES}/_candidates.json`);
  if (!content.trim()) return [];
  try {
    const json = JSON.parse(content);
    const list = Array.isArray(json?.candidates) ? json.candidates : [];
    // Normalisation défensive : on garantit les tableaux et la structure decision.
    return list.map((c: any): Candidate => ({
      name: String(c?.name ?? ''),
      normalized: String(c?.normalized ?? String(c?.name ?? '').toLowerCase()),
      variants: arr(c?.variants),
      note: c?.note ?? null,
      seen_in: Array.isArray(c?.seen_in)
        ? c.seen_in.map((s: any) => ({
            resource: String(s?.resource ?? ''),
            section: s?.section ?? null,
            context: String(s?.context ?? ''),
          }))
        : [],
      suggested_aliases: Array.isArray(c?.suggested_aliases)
        ? c.suggested_aliases.map((a: any) => ({
            slug: String(a?.slug ?? ''),
            label: String(a?.label ?? a?.slug ?? ''),
            score: Number(a?.score ?? 0),
          }))
        : [],
      suggested_types: arr(c?.suggested_types),
      status: (c?.status ?? 'pending') as Candidate['status'],
      decision: {
        target_slug: c?.decision?.target_slug ?? null,
        entity_type: c?.decision?.entity_type ?? null,
        slug: c?.decision?.slug ?? null,
      },
      updated_at: c?.updated_at ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Graphe de connaissances (wiki/graph.json) — vue dérivée générée à l'ingestion.
 * Lecture seule pour la page de visualisation. Renvoie un graphe vide si le
 * fichier est absent ou illisible (même contrat défensif que listCandidates).
 */
export async function getGraph(): Promise<GraphData> {
  const content = await readWikiFile('graph.json');
  if (!content.trim()) return { nodes: [], edges: [] };
  try {
    const json = JSON.parse(content);
    return {
      nodes: Array.isArray(json?.nodes) ? json.nodes : [],
      edges: Array.isArray(json?.edges) ? json.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

/**
 * File des thèmes candidats (wiki/themes/_candidates.json). Miroir de
 * listCandidates() sans les champs de type (`suggested_types`, `entity_type`).
 * Renvoie [] si absent ou illisible.
 */
export async function listThemeCandidates(): Promise<ThemeCandidate[]> {
  const content = await readWikiFile(`${THEMES}/_candidates.json`);
  if (!content.trim()) return [];
  try {
    const json = JSON.parse(content);
    const list = Array.isArray(json?.candidates) ? json.candidates : [];
    return list.map((c: any): ThemeCandidate => ({
      name: String(c?.name ?? ''),
      normalized: String(c?.normalized ?? String(c?.name ?? '').toLowerCase()),
      variants: arr(c?.variants),
      note: c?.note ?? null,
      seen_in: Array.isArray(c?.seen_in)
        ? c.seen_in.map((s: any) => ({
            resource: String(s?.resource ?? ''),
            section: s?.section ?? null,
            context: String(s?.context ?? ''),
          }))
        : [],
      suggested_aliases: Array.isArray(c?.suggested_aliases)
        ? c.suggested_aliases.map((a: any) => ({
            slug: String(a?.slug ?? ''),
            label: String(a?.label ?? a?.slug ?? ''),
            score: Number(a?.score ?? 0),
          }))
        : [],
      status: (c?.status ?? 'pending') as ThemeCandidate['status'],
      decision: {
        target_slug: c?.decision?.target_slug ?? null,
        slug: c?.decision?.slug ?? null,
      },
      updated_at: c?.updated_at ?? null,
    }));
  } catch {
    return [];
  }
}
