import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { RAW_ROOT } from '@/lib/wiki-fs';
import { fetchRepoFileRaw } from '@/lib/github';

export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(name: string): string {
  const i = name.lastIndexOf('.');
  const ext = i === -1 ? '' : name.slice(i).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Sert un fichier de /raw. Le wiki markdown est bundlé, mais pas les binaires :
 * en local on lit le filesystem (RAW_ROOT), en prod (Vercel, fs read-only) on
 * passe par la Contents API GitHub. `?download=1` force le téléchargement.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { file: string[] } },
) {
  // Les noms de /raw sont plats : on ne garde que le basename (anti-traversal).
  const name = path.basename((params.file ?? []).join('/'));
  if (!name) return new Response('Not found', { status: 404 });

  const download = new URL(req.url).searchParams.get('download');
  const disposition = download
    ? `attachment; filename="${encodeURIComponent(name)}"`
    : 'inline';

  let bytes: Buffer | null = null;

  // 1. Filesystem local (dev)
  try {
    bytes = await fs.readFile(path.join(RAW_ROOT, name));
  } catch {
    bytes = null;
  }

  // 2. Repli GitHub (prod)
  if (!bytes) {
    const res = await fetchRepoFileRaw(`raw/${name}`);
    if (res.ok && res.buffer) bytes = res.buffer;
    else return new Response('Fichier introuvable', { status: res.status || 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': contentType(name),
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
