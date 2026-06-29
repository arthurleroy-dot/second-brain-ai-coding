import { NextRequest } from 'next/server';
import { createConversation, listConversations } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const conversations = await listConversations();
  return Response.json({ conversations });
}

export async function POST(req: NextRequest) {
  let title = 'Nouvelle discussion';
  try {
    const body = await req.json();
    if (body?.title) title = String(body.title);
  } catch {
    // pas de corps → titre par défaut
  }
  const conversation = await createConversation(title);
  return Response.json({ conversation });
}
