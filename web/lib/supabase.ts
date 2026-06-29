import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Conversation, Message, Source } from '@/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// Client public (clé anon) — lecture côté navigateur, persistance conversations.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!)
  : null;

// Client admin (service role) — opérations serveur uniquement (upload, process,
// migration). Bypasse la RLS. NE JAMAIS importer côté client.
export const supabaseAdminConfigured = Boolean(url && serviceRoleKey);

export const supabaseAdmin: SupabaseClient | null = supabaseAdminConfigured
  ? createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

/** Renvoie le client admin ou lève une erreur explicite si non configuré. */
export function requireAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    throw new Error(
      'Supabase service role non configuré. Renseigne NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env.local.',
    );
  }
  return supabaseAdmin;
}

// ---- Helpers à dégradation gracieuse ----
// Si Supabase n'est pas configuré, ces fonctions renvoient des valeurs neutres
// pour que le chat fonctionne quand même (sans persistance).

export async function createConversation(
  title = 'Nouvelle discussion',
): Promise<Conversation | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('conversations')
    .insert({ title })
    .select()
    .single();
  if (error || !data) return null;
  return { ...data, messages: [] } as Conversation;
}

export async function listConversations(): Promise<Conversation[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data.map((c) => ({ ...c, messages: [] })) as Conversation[];
}

export async function getConversation(
  id: string,
): Promise<Conversation | null> {
  if (!supabase) return null;
  const { data: conv } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single();
  if (!conv) return null;
  const { data: msgs } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });
  return { ...conv, messages: (msgs ?? []) as Message[] } as Conversation;
}

export async function getConversationHistory(
  conversationId: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return (data ?? []) as { role: 'user' | 'assistant'; content: string }[];
}

export async function saveMessage(
  conversationId: string | null,
  role: 'user' | 'assistant',
  content: string,
  sources: Source[],
): Promise<void> {
  if (!supabase || !conversationId) return;
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role,
    content,
    sources,
  });
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

export async function renameConversationIfDefault(
  conversationId: string | null,
  firstUserMessage: string,
): Promise<void> {
  if (!supabase || !conversationId) return;
  const { data } = await supabase
    .from('conversations')
    .select('title')
    .eq('id', conversationId)
    .single();
  if (data?.title === 'Nouvelle discussion') {
    const title = firstUserMessage.slice(0, 60);
    await supabase
      .from('conversations')
      .update({ title })
      .eq('id', conversationId);
  }
}
