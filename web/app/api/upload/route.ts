import { NextRequest } from 'next/server';
import path from 'path';
import { ResourceType } from '@/types';
import {
  commitFiles,
  isGithubConfigured,
  resolveAvailableRawName,
  FileToCommit,
} from '@/lib/github';

export const dynamic = 'force-dynamic';

const ACCEPTED_EXT = ['.md', '.txt', '.pdf', '.pptx', '.docx'];
const MAX_BYTES = 50 * 1024 * 1024; // 50 Mo

// ResourceType (UI) → source_type (vocabulaire wiki, cf. docs/wiki-spec.md).
const TYPE_TO_SOURCE_TYPE: Record<ResourceType, string> = {
  article: 'article',
  report_pdf: 'report-pdf',
  tweet: 'tweet',
  meeting_note: 'meeting-notes',
  interview: 'interview',
  presentation: 'presentation',
  transcript: 'transcript',
  personal_note: 'personal-notes',
  unknown: 'unknown',
};

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/** Nettoie un nom de fichier d'upload (basename, sans caractères de chemin). */
function safeName(name: string): string {
  return path.basename(name).replace(/[\\/]/g, '').trim();
}

/** Scalaire YAML sûr pour une chaîne (guillemets doubles échappés). */
function yamlStr(v: string): string {
  return JSON.stringify(v);
}

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Construit le sidecar `<source>.meta.md` à partir des métadonnées du formulaire. */
function buildSidecar(meta: {
  title: string | null;
  sourceType: string;
  author: string | null;
  date: string | null;
  url: string | null;
  depositedBy: string | null;
  entities: string[];
  granularity: string;
}): string {
  const lines: string[] = ['---'];
  if (meta.title) lines.push(`title: ${yamlStr(meta.title)}`);
  lines.push(`type: ${meta.sourceType}`);
  if (meta.author) lines.push(`author: ${yamlStr(meta.author)}`);
  if (meta.date) lines.push(`date: ${yamlStr(meta.date)}`);
  if (meta.url) lines.push(`url: ${yamlStr(meta.url)}`);
  if (meta.depositedBy) lines.push(`deposited_by: ${yamlStr(meta.depositedBy)}`);
  if (meta.entities.length) lines.push(`entities: [${meta.entities.join(', ')}]`);
  if (meta.entities.length) lines.push(`entities_granularity: ${meta.granularity}`);
  lines.push('---', '');
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  if (!isGithubConfigured()) {
    return Response.json(
      { error: 'Dépôt GitHub non configuré (GITHUB_TOKEN / GITHUB_REPO).' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Requête multipart invalide' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Aucun fichier fourni' }, { status: 400 });
  }

  const name = safeName(file.name);
  const extension = ext(name);
  if (!name || !ACCEPTED_EXT.includes(extension)) {
    return Response.json(
      { error: `Extension non supportée (${extension}). Acceptés : ${ACCEPTED_EXT.join(', ')}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Fichier trop volumineux (max ${MAX_BYTES / 1024 / 1024} Mo).` },
      { status: 413 },
    );
  }

  // Métadonnées (précédence humaine : le sidecar est autoritaire côté agent).
  const title = field(form, 'title');
  const author = field(form, 'author');
  const date = field(form, 'date');
  const depositedBy = field(form, 'deposited_by');
  const url = field(form, 'url');
  const typeRaw = (field(form, 'type') ?? 'unknown') as ResourceType;
  const sourceType = TYPE_TO_SOURCE_TYPE[typeRaw] ?? 'unknown';
  const entities = (field(form, 'entities') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean);
  const granularity = field(form, 'entities_granularity') ?? 'auto';

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    // Nom disponible dans raw/ (suffixe -2, -3… en cas de collision).
    const finalName = await resolveAvailableRawName(name);
    const sidecar = buildSidecar({
      title,
      sourceType,
      author,
      date,
      url,
      depositedBy,
      entities,
      granularity,
    });

    const files: FileToCommit[] = [
      { path: `raw/${finalName}`, content: buffer },
      { path: `raw/${finalName}.meta.md`, content: sidecar },
    ];
    const { commitSha } = await commitFiles(
      files,
      `feat(raw): dépôt "${title ?? finalName}" via plateforme`,
    );

    return Response.json({ ok: true, file: finalName, commit_sha: commitSha });
  } catch (e: any) {
    return Response.json(
      { error: `Commit GitHub échoué : ${e?.message ?? 'inconnu'}` },
      { status: 502 },
    );
  }
}
