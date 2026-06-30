import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Conversation, Message, Source } from '@/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// IMPORTANT : Next.js intercepte le `fetch` global et met en cache (Data Cache)
// les réponses dans les Server Components / Route Handlers. supabase-js passant
// par `fetch`, ses lectures seraient mises en cache → une conversation lue une
// fois (vide) renverrait toujours l'état périmé, même après ajout de messages.
// `force-dynamic` sur les routes ne suffit pas à désactiver ce cache de `fetch`.
// On force donc `no-store` sur toutes les requêtes Supabase pour lire/écrire en
// temps réel.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

// Client public (clé anon) — lecture côté navigateur, persistance conversations.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, { global: { fetch: noStoreFetch } })
  : null;

// Client admin (service role) — opérations serveur uniquement (upload, process,
// migration). Bypasse la RLS. NE JAMAIS importer côté client.
export const supabaseAdminConfigured = Boolean(url && serviceRoleKey);

export const supabaseAdmin: SupabaseClient | null = supabaseAdminConfigured
  ? createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: noStoreFetch },
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
//
// Lecture : clé anon (policy `public_read`). Écriture : service role, qui
// bypasse la RLS (cf. supabase/schema.sql — aucune policy d'écriture anon).
// Ces helpers ne tournent que côté serveur (API routes / server components),
// donc l'usage du service role est sûr.
const writeClient: SupabaseClient | null = supabaseAdmin ?? supabase;

export async function createConversation(
  title = 'Nouvelle discussion',
): Promise<Conversation | null> {
  if (!writeClient) return null;
  const { data, error } = await writeClient
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
  if (!writeClient || !conversationId) return;
  await writeClient.from('messages').insert({
    conversation_id: conversationId,
    role,
    content,
    sources,
  });
  await writeClient
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

export async function renameConversationIfDefault(
  conversationId: string | null,
  firstUserMessage: string,
): Promise<void> {
  if (!writeClient || !conversationId) return;
  const { data } = await writeClient
    .from('conversations')
    .select('title')
    .eq('id', conversationId)
    .single();
  if (data?.title === 'Nouvelle discussion') {
    const title = firstUserMessage.slice(0, 60);
    await writeClient
      .from('conversations')
      .update({ title })
      .eq('id', conversationId);
  }
}
