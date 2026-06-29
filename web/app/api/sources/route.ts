import { NextRequest } from 'next/server';
import { listAllSources, slugify } from '@/lib/wiki-parser';
import { TYPE_TO_FOLDER } from '@/lib/ui';
import { ResourceType } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // ResourceType ou dossier
  const author = searchParams.get('author');
  const date = searchParams.get('date'); // préfixe YYYY ou YYYY-MM
  const filter = searchParams.get('filter'); // 'needs_review'

  const all = await listAllSources();
  const total = all.length;
  const needsReviewCount = all.filter((s) => s.needs_review).length;

  let sources = all;

  if (type) {
    // accepte soit le ResourceType, soit le nom de dossier
    sources = sources.filter(
      (s) => s.type === type || TYPE_TO_FOLDER[s.type as ResourceType] === type,
    );
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
