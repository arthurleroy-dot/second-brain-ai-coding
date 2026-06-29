import { listAuthors, listDates } from '@/lib/wiki-query';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [authors, dates] = await Promise.all([listAuthors(), listDates()]);
  return Response.json({ authors, dates });
}
