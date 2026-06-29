import { NextRequest } from 'next/server';
import { getConversation } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const conversation = await getConversation(params.id);
  if (!conversation) {
    return Response.json({ conversation: null }, { status: 404 });
  }
  return Response.json({ conversation });
}
