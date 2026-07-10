import { listAuthors, listDates, listOrigins, listTypes } from '@/lib/wiki-query';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [authors, dates, types, origins] = await Promise.all([
    listAuthors(),
    listDates(),
    listTypes(),
    listOrigins(),
  ]);
  return Response.json({ authors, dates, types, origins });
}
