import { NextRequest } from 'next/server';
import { rawExists, writeRaw } from '@/lib/wiki-fs';

export const dynamic = 'force-dynamic';

const TEXT_EXT = ['.md', '.txt'];
const BINARY_META_EXT = ['.pdf', '.pptx'];

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function minimalFrontmatter(): string {
  return `---
type: unknown
author: ""
date: ""
url: ""
deposited_by: ""
topics: []
needs_review: true
processed: false
---

`;
}

function sidecarContent(filename: string): string {
  return `---
source_file: "${filename}"
type: unknown
author: ""
date: ""
url: ""
deposited_by: ""
topics: []
needs_review: true
processed: false
---

## Notes extraites automatiquement
(à compléter par l'agent mainteneur lors du prochain run /process-raw)
`;
}

export async function POST(req: NextRequest) {
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

  const filename = file.name;
  const extension = ext(filename);

  if (await rawExists(filename)) {
    return Response.json(
      { error: `Un fichier nommé "${filename}" existe déjà dans /raw` },
      { status: 409 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Fichier texte : on préfixe un frontmatter minimal s'il n'en a pas déjà un.
  if (TEXT_EXT.includes(extension)) {
    const text = buffer.toString('utf-8');
    const hasFrontmatter = text.trimStart().startsWith('---');
    const content = hasFrontmatter ? text : minimalFrontmatter() + text;
    const rel = await writeRaw(filename, content);
    return Response.json({
      ok: true,
      path: rel,
      message: hasFrontmatter
        ? 'Fichier texte déposé.'
        : 'Fichier texte déposé avec frontmatter minimal.',
    });
  }

  // Fichier binaire : on écrit le binaire + un sidecar .meta.md.
  const rel = await writeRaw(filename, buffer);
  let sidecar: string | null = null;
  if (BINARY_META_EXT.includes(extension)) {
    sidecar = await writeRaw(`${filename}.meta.md`, sidecarContent(filename));
  }

  return Response.json({
    ok: true,
    path: rel,
    sidecar,
    message: sidecar
      ? 'Fichier déposé + sidecar .meta.md créé.'
      : 'Fichier déposé.',
  });
}
