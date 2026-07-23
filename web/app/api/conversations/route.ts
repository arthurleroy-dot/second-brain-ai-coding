import { NextRequest } from 'next/server';
import {
  createConversation,
  deleteAllConversations,
  listConversations,
} from '@/lib/conversations-store';

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

export async function DELETE() {
  try {
    await deleteAllConversations();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Suppression échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
