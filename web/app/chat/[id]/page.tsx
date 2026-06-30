import ChatWindow from '@/components/chat/ChatWindow';
import { getConversation } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: {
  params: { id: string };
}) {
  const conversation = await getConversation(params.id);
  return (
    <ChatWindow
      key={params.id}
      conversationId={params.id}
      initialMessages={conversation?.messages ?? []}
    />
  );
}
