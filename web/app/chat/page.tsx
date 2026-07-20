import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ChatWindow from '@/components/chat/ChatWindow';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  // Reprise de la conversation active : point de passage unique couvrant le clic
  // « Chat » de la sidebar, le redirect /→/chat, et l'accès direct à /chat.
  const active = cookies().get('active_conversation')?.value;
  if (active) redirect(`/chat/${active}`);
  return <ChatWindow key="new" conversationId={null} />;
}
