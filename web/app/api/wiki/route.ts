import { NextRequest } from 'next/server';
import { listTopics, slugify } from '@/lib/wiki-query';
import { requireAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const topics = await listTopics();
  return Response.json({ topics });
}

// Crée une page thématique dans la table `topics`.
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

  let db;
  try {
    db = requireAdmin();
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 503 });
  }

  const { data: existing } = await db
    .from('topics')
    .select('slug')
    .eq('slug', slug)
    .maybeSingle();
  if (existing) {
    return Response.json({ error: `Le thème "${slug}" existe déjà` }, { status: 409 });
  }

  const { error } = await db.from('topics').insert({ slug, title });
  if (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }

  return Response.json({ ok: true, slug });
}
