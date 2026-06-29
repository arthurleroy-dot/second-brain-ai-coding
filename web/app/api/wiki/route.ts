import { NextRequest } from 'next/server';
import { listTopics, slugify } from '@/lib/wiki-parser';
import { wikiExists, writeWikiFile } from '@/lib/wiki-fs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const topics = await listTopics();
  return Response.json({ topics });
}

// Crée une ébauche de page thématique dans by-topic/.
// L'enrichissement reste le rôle de l'agent mainteneur (/process-raw).
export async function POST(req: NextRequest) {
  let title = '';
  try {
    const body = await req.json();
    title = String(body?.title ?? '').trim();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  if (!title) {
    return Response.json({ error: 'Titre manquant' }, { status: 400 });
  }

  const slug = slugify(title);
  if (!slug) {
    return Response.json({ error: 'Titre invalide' }, { status: 400 });
  }
  const rel = `by-topic/${slug}.md`;
  if (await wikiExists(rel)) {
    return Response.json({ error: `Le thème "${slug}" existe déjà` }, { status: 409 });
  }

  const content = `# ${title}\n\n## Résumé\n(ébauche créée depuis l'interface — à enrichir par l'agent mainteneur)\n\n## Concepts clés\n`;
  await writeWikiFile(rel, content);

  return Response.json({ ok: true, slug, path: rel });
}
