import { Source } from '@/types';
import { listWikiDir, listWikiSubdirs, readWikiFile } from '@/lib/wiki-fs';
import { slugify } from '@/lib/wiki-parser';

export interface ChatFilters {
  type?: string; // dossier by-type (ex: 'articles')
}

const TYPE_KEYWORDS: Record<string, string> = {
  réunion: 'meeting-notes',
  reunion: 'meeting-notes',
  interview: 'interviews',
  article: 'articles',
  présentation: 'presentations',
  presentation: 'presentations',
  transcript: 'transcripts',
};

/**
 * Détermine quels fichiers du wiki lire en fonction de la question, puis
 * concatène leur contenu. Reprend la logique du prompt, mais lit le wiki local.
 */
export async function getRelevantWikiFiles(
  message: string,
  filters?: ChatFilters,
): Promise<string> {
  const lower = message.toLowerCase();
  const files = new Set<string>();

  // Détection d'auteur
  const authors = await listWikiSubdirs('by-author');
  for (const author of authors) {
    const name = author.toLowerCase();
    if (lower.includes(name) || lower.includes(name.replace(/-/g, ' '))) {
      files.add(`by-author/${author}/index.md`);
    }
  }

  // Détection de type
  for (const [keyword, folder] of Object.entries(TYPE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      files.add(`by-type/${folder}/index.md`);
    }
  }

  // Détection de thème
  const topicFiles = await listWikiDir('by-topic');
  for (const file of topicFiles) {
    if (!file.endsWith('.md') || file === 'index.md') continue;
    const slug = file.replace(/\.md$/, '');
    if (lower.includes(slug.replace(/-/g, ' ')) || lower.includes(slug)) {
      files.add(`by-topic/${file}`);
    }
  }

  // Filtre manuel du panneau droit
  if (filters?.type) {
    files.add(`by-type/${filters.type}/index.md`);
  }

  // Fallback : index général
  if (files.size === 0) {
    files.add('index.md');
  }

  const contents = await Promise.all(
    [...files].map(async (rel) => {
      const c = await readWikiFile(rel);
      return c ? `## Fichier: ${rel}\n\n${c}` : '';
    }),
  );

  return contents.filter(Boolean).join('\n\n---\n\n');
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
    // On isole le premier tableau JSON présent.
    const start = after.indexOf('[');
    const end = after.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      const json = after.slice(start, end + 1);
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        sources = parsed.map((s: any) => normalizeSource(s));
      }
    }
  } catch {
    // bloc SOURCES malformé → on ignore les sources mais on garde le texte
  }

  return { text, sources };
}

function normalizeSource(s: any): Source {
  const title = String(s?.title ?? s?.slug ?? 'Source');
  const slug = String(s?.slug ?? slugify(title));
  return {
    slug,
    title,
    type: (s?.type as Source['type']) ?? 'unknown',
    author: s?.author ?? null,
    date: s?.date ?? null,
    url: s?.url ?? null,
    deposited_by: null,
    topics: Array.isArray(s?.topics) ? s.topics : [],
    needs_review: false,
    file_path: s?.file_path ?? '',
  };
}
