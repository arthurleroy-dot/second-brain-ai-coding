import { NextRequest } from 'next/server';
import { listSources, slugify, resolveType } from '@/lib/wiki-query';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // ResourceType ou dossier
  const author = searchParams.get('author');
  const date = searchParams.get('date'); // préfixe YYYY ou YYYY-MM
  const filter = searchParams.get('filter'); // 'needs_review'

  const all = await listSources();
  const total = all.length;
  const needsReviewCount = all.filter((s) => s.needs_review).length;

  let sources = all;

  if (type) {
    const t = resolveType(type);
    if (t) sources = sources.filter((s) => s.type === t);
  }
  if (author) {
    const a = author.toLowerCase();
    sources = sources.filter((s) => {
      const name = (s.author ?? 'unknown').toLowerCase();
      return name === a || slugify(name) === a;
    });
  }
  if (date) {
    sources = sources.filter((s) => (s.date ?? '').startsWith(date));
  }
  if (filter === 'needs_review') {
    sources = sources.filter((s) => s.needs_review);
  }

  return Response.json({
    sources,
    total,
    needs_review: needsReviewCount,
    count: sources.length,
  });
}
