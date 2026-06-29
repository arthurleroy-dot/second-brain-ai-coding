import matter from 'gray-matter';
import path from 'path';
import {
  AuthorEntry,
  DateEntry,
  ResourceType,
  Source,
  WikiTopic,
} from '@/types';
import {
  listWikiDir,
  listWikiSubdirs,
  readWikiFile,
} from '@/lib/wiki-fs';

const BY_TYPE = 'by-type';
const BY_AUTHOR = 'by-author';
const BY_DATE = 'by-date';
const BY_TOPIC = 'by-topic';

// Dossiers by-type/ → ResourceType
const FOLDER_TO_TYPE: Record<string, ResourceType> = {
  articles: 'article',
  'meeting-notes': 'meeting_note',
  interviews: 'interview',
  presentations: 'presentation',
  transcripts: 'transcript',
  'personal-notes': 'personal_note',
  unknown: 'unknown',
};

// Valeurs possibles du champ `type` dans le frontmatter → ResourceType normalisé
const RAW_TYPE_TO_TYPE: Record<string, ResourceType> = {
  article: 'article',
  meeting_note: 'meeting_note',
  'meeting-notes': 'meeting_note',
  interview: 'interview',
  presentation: 'presentation',
  transcript: 'transcript',
  personal_note: 'personal_note',
  'personal-notes': 'personal_note',
  unknown: 'unknown',
};

function normalizeType(rawType: unknown, folder: string): ResourceType {
  if (typeof rawType === 'string' && RAW_TYPE_TO_TYPE[rawType.trim()]) {
    return RAW_TYPE_TO_TYPE[rawType.trim()];
  }
  return FOLDER_TO_TYPE[folder] ?? 'unknown';
}

function firstH1(body: string): string | null {
  for (const line of body.split('\n')) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === 'unknown') return null;
  return t;
}

/** Parse le contenu d'une fiche by-type/<folder>/<file>.md → Source. */
export function parseResource(
  content: string,
  relFilePath: string,
): Source {
  const { data, content: body } = matter(content);
  const folder = relFilePath.split('/')[1] ?? 'unknown'; // by-type/<folder>/...
  const fileBase = path.basename(relFilePath, '.md');

  const topics = Array.isArray(data.topics)
    ? data.topics.map((t: unknown) => String(t).trim()).filter(Boolean)
    : [];

  return {
    slug: cleanStr(data.slug) ?? fileBase,
    title: firstH1(body) ?? (cleanStr(data.slug) ?? fileBase),
    type: normalizeType(data.type, folder),
    author: cleanStr(data.author),
    date: cleanStr(data.date),
    url: cleanStr(data.url),
    deposited_by: cleanStr(data.deposited_by),
    topics,
    needs_review: data.needs_review === true,
    file_path: relFilePath,
  };
}

/** Liste toutes les ressources du wiki (by-type/<folder>/*.md, hors index.md). */
export async function listAllSources(): Promise<Source[]> {
  const folders = await listWikiSubdirs(BY_TYPE);
  const sources: Source[] = [];

  for (const folder of folders) {
    const files = await listWikiDir(`${BY_TYPE}/${folder}`);
    for (const file of files) {
      if (!file.endsWith('.md') || file === 'index.md') continue;
      const rel = `${BY_TYPE}/${folder}/${file}`;
      const content = await readWikiFile(rel);
      if (!content) continue;
      sources.push(parseResource(content, rel));
    }
  }

  // Tri : plus récent d'abord (dates manquantes en fin)
  return sources.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

function titleFromTopicBody(body: string, slug: string): string {
  return firstH1(body) ?? slug;
}

/** Liste les pages thématiques (by-topic/*.md) avec compteur de sources. */
export async function listTopics(): Promise<WikiTopic[]> {
  const files = await listWikiDir(BY_TOPIC);
  const allSources = await listAllSources();
  const topics: WikiTopic[] = [];

  for (const file of files) {
    if (!file.endsWith('.md') || file === 'index.md') continue;
    const slug = path.basename(file, '.md');
    const content = await readWikiFile(`${BY_TOPIC}/${file}`);
    const sources = allSources.filter((s) => s.topics.includes(slug));
    topics.push({
      slug,
      title: titleFromTopicBody(content, slug),
      source_count: sources.length,
      sources,
      last_updated: null,
    });
  }

  return topics.sort((a, b) => a.title.localeCompare(b.title));
}

/** Liste les auteurs (dossiers by-author/) avec compteur de sources. */
export async function listAuthors(): Promise<AuthorEntry[]> {
  const dirs = await listWikiSubdirs(BY_AUTHOR);
  const allSources = await listAllSources();

  const entries: AuthorEntry[] = dirs.map((dir) => {
    // Le dossier auteur correspond au nom (slugifié) ; on compte par correspondance souple.
    const matches = allSources.filter((s) => {
      const a = (s.author ?? 'unknown').toLowerCase();
      return slugify(a) === dir.toLowerCase() || a === dir.toLowerCase();
    });
    // Nom d'affichage : on préfère le libellé réel de l'auteur (ex: "McKinsey") au slug du dossier.
    const realName = matches.find((s) => s.author)?.author;
    return {
      slug: dir,
      name: dir === 'unknown' ? 'Auteur inconnu' : realName ?? dir,
      source_count: matches.length,
    };
  });

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Liste les entrées de date (by-date/<YYYY>/<YYYY-MM>) avec compteurs. */
export async function listDates(): Promise<DateEntry[]> {
  const years = await listWikiSubdirs(BY_DATE);
  const allSources = await listAllSources();
  const entries: DateEntry[] = [];

  for (const year of years) {
    if (year === 'unknown') {
      const count = allSources.filter((s) => !s.date).length;
      entries.push({
        year: 'unknown',
        month: null,
        label: 'Date inconnue',
        source_count: count,
        is_unknown: true,
      });
      continue;
    }
    const months = await listWikiSubdirs(`${BY_DATE}/${year}`);
    for (const month of months) {
      const isUnknownMonth = month === 'unknown';
      const count = allSources.filter((s) => {
        if (!s.date) return false;
        if (isUnknownMonth) return s.date === year; // année seule connue
        return s.date.startsWith(month); // "YYYY-MM" préfixe
      }).length;
      entries.push({
        year,
        month: isUnknownMonth ? null : month,
        label: isUnknownMonth ? `${year} (mois inconnu)` : month,
        source_count: count,
        is_unknown: isUnknownMonth,
      });
    }
  }

  return entries.sort((a, b) => (b.month ?? b.year).localeCompare(a.month ?? a.year));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
