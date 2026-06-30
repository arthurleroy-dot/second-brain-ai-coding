import { listAuthors, listDates, listTypes } from '@/lib/wiki-query';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [authors, dates, types] = await Promise.all([
    listAuthors(),
    listDates(),
    listTypes(),
  ]);
  return Response.json({ authors, dates, types });
}
