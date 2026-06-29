import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import React from 'react';
import { readWikiFile, wikiExists } from '@/lib/wiki-fs';
import { listSources } from '@/lib/wiki-query';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';
import { ResourceType } from '@/types';

export const dynamic = 'force-dynamic';

interface Section {
  title: string;
  content: string[];
}

/** Découpe le markdown en sections de niveau `## `. */
function parseSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let current: Section = { title: '', content: [] };

  for (const line of lines) {
    if (line.startsWith('# ')) continue; // titre principal géré à part
    if (line.startsWith('## ')) {
      if (current.title || current.content.length) sections.push(current);
      current = { title: line.replace('## ', '').trim(), content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.title || current.content.length) sections.push(current);

  // On ignore une éventuelle section d'intro vide (avant le premier ##).
  return sections.filter((s) => s.title);
}

export default async function TopicPage({
  params,
}: {
  params: { slug: string };
}) {
  const relPath = `by-topic/${params.slug}.md`;
  if (!(await wikiExists(relPath))) notFound();

  const raw = await readWikiFile(relPath);
  if (!raw.trim()) notFound();

  const lines = raw.split('\n');
  const title =
    lines.find((l) => l.startsWith('# '))?.replace('# ', '').trim() ||
    params.slug;
  const meta = lines.find((l) => l.startsWith('> '))?.replace('> ', '').trim();
  const sections = parseSections(raw);

  // Ressources liées : on réutilise la requête wiki existante (status='done', triées par date).
  const allSources = await listSources();
  const resources = allSources.filter((s) => s.topics.includes(params.slug));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <Link
          href="/wiki"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft size={13} /> Tous les thèmes
        </Link>

        <div className="mb-8">
          <h1 className="mb-1 text-2xl font-semibold text-gray-900">{title}</h1>
          {meta && <p className="text-sm text-gray-400">{meta}</p>}
        </div>

        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-xl border border-gray-100 bg-white p-5"
            >
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {section.title}
              </h2>
              <div className="text-sm leading-relaxed text-gray-700">
                {renderBlocks(section.content)}
              </div>
            </section>
          ))}

          {resources.length > 0 && (
            <section className="rounded-xl border border-gray-100 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Sources ({resources.length})
              </h2>
              <div className="flex flex-col">
                {resources.map((r) => (
                  <div
                    key={r.id ?? r.slug}
                    className="flex items-center gap-3 border-b border-gray-50 py-2 last:border-0"
                  >
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(
                        r.type,
                      )}`}
                    >
                      {typeLabel(r.type)}
                    </span>
                    <span className="flex-1 text-sm text-gray-800">{r.title}</span>
                    <span className="whitespace-nowrap text-xs text-gray-400">
                      {r.author || 'auteur inconnu'} · {formatDate(r.date)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Rendu markdown léger (pas de dépendance externe) ----

/** Regroupe les lignes d'une section en blocs (titres, listes, tableaux, paragraphes). */
function renderBlocks(lines: string[]): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Ligne vide → on saute
    if (!trimmed) {
      i++;
      continue;
    }

    // Sous-titre ### / ####
    const heading = trimmed.match(/^(#{3,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <h3 key={key++} className="mb-1 mt-4 font-semibold text-gray-800 first:mt-0">
          {renderInline(heading[2])}
        </h3>,
      );
      i++;
      continue;
    }

    // Tableau (lignes contenant des |)
    if (trimmed.includes('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i]);
        i++;
      }
      blocks.push(renderTable(rows, key++));
      continue;
    }

    // Liste à puces (- ou *)
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-2 flex flex-col gap-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2">
              <span className="mt-0.5 text-gray-300">·</span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraphe : agrège les lignes consécutives non vides / non spéciales
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        !t ||
        /^(#{3,4})\s+/.test(t) ||
        t.includes('|') ||
        /^[-*]\s+/.test(t)
      ) {
        break;
      }
      para.push(t);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 first:mt-0">
        {renderInline(para.join(' '))}
      </p>,
    );
  }

  return blocks;
}

function renderTable(rows: string[], key: number): React.ReactNode {
  // On retire les lignes de séparation markdown (|---|---|).
  const dataRows = rows.filter((r) => !/^[\s|:-]+$/.test(r));
  const cells = dataRows.map((r) =>
    r
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim()),
  );
  if (cells.length === 0) return null;

  return (
    <table key={key} className="my-2 w-full border-collapse text-sm">
      <tbody>
        {cells.map((row, i) => (
          <tr key={i} className="border-b border-gray-50 last:border-0">
            {row.map((cell, j) => (
              <td
                key={j}
                className={`py-1.5 pr-4 align-top ${
                  i === 0 ? 'font-medium text-gray-600' : 'text-gray-700'
                }`}
              >
                {renderInline(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Rendu inline : gère **gras**, [texte](url), [[wikilink]] (vers une autre fiche).
 * Tokenizer simple à priorité fixe.
 */
function renderInline(text: string): React.ReactNode {
  if (!text) return null;

  const nodes: React.ReactNode[] = [];
  // Ordre : wikilink, lien markdown, gras.
  const regex =
    /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));

    if (m[1] !== undefined) {
      // [[wikilink]] → fiche thématique
      const slug = m[1].trim();
      nodes.push(
        <Link
          key={key++}
          href={`/wiki/${slug}`}
          className="text-blue-600 hover:underline"
        >
          {slug}
        </Link>,
      );
    } else if (m[2] !== undefined && m[3] !== undefined) {
      // [texte](url)
      const url = m[3].trim();
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {m[2]}
        </a>,
      );
    } else if (m[4] !== undefined) {
      // **gras**
      nodes.push(
        <strong key={key++} className="font-semibold text-gray-900">
          {m[4]}
        </strong>,
      );
    }

    last = regex.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
