import { NextRequest } from 'next/server';
import { deleteConversation, getConversation } from '@/lib/conversations-store';

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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await deleteConversation(params.id);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Suppression échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
