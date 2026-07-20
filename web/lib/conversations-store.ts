import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DATA_ROOT } from '@/lib/wiki-fs';
import { Conversation, Message, Source } from '@/types';

/**
 * Historique de chat en fichiers JSON locaux — un fichier par conversation dans
 * `<DATA_ROOT>/.data/conversations/<id>.json`. Remplace `@/lib/supabase` : mêmes
 * signatures que les helpers historiques, pour ne toucher qu'aux imports des
 * appelants. Format d'un fichier :
 *   { id, title, created_at, updated_at, messages: Message[] }
 * (`.data/` est HORS `wiki/` et `raw/` — écriture atomique dédiée ici, le
 * garde-fou d'`applyFileOps` refusant à dessein tout chemin hors wiki/raw.)
 */
const CONV_DIR = path.join(DATA_ROOT, '.data', 'conversations');
const DEFAULT_TITLE = 'Nouvelle discussion';

function convPath(id: string): string {
  // `id` est un UUID généré par nous → sûr. Garde-fou anti-traversal par prudence.
  const safe = path.basename(id);
  return path.join(CONV_DIR, `${safe}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Écriture atomique (temp + rename même volume), dossiers créés au besoin. */
async function writeJsonAtomic(abs: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

/** Lit et parse un fichier conversation ; null si absent ou corrompu. */
async function readConv(id: string): Promise<Conversation | null> {
  try {
    const raw = await fs.readFile(convPath(id), 'utf-8');
    const doc = JSON.parse(raw);
    return {
      id: String(doc.id ?? id),
      title: String(doc.title ?? DEFAULT_TITLE),
      created_at: String(doc.created_at ?? nowIso()),
      updated_at: String(doc.updated_at ?? doc.created_at ?? nowIso()),
      messages: Array.isArray(doc.messages) ? (doc.messages as Message[]) : [],
    };
  } catch {
    return null;
  }
}

export async function createConversation(
  title = DEFAULT_TITLE,
): Promise<Conversation | null> {
  const ts = nowIso();
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title,
    messages: [],
    created_at: ts,
    updated_at: ts,
  };
  try {
    await writeJsonAtomic(convPath(conv.id), conv);
    return conv;
  } catch {
    return null;
  }
}

export async function listConversations(): Promise<Conversation[]> {
  let names: string[];
  try {
    names = await fs.readdir(CONV_DIR);
  } catch {
    return []; // dossier pas encore créé
  }
  const convs: Conversation[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const conv = await readConv(name.slice(0, -'.json'.length));
    // Métadonnées seulement (comme l'ancien Supabase : messages vidés en liste).
    if (conv) convs.push({ ...conv, messages: [] });
  }
  // Tri updated_at décroissant.
  convs.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  return convs;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  return readConv(id);
}

export async function getConversationHistory(
  conversationId: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const conv = await readConv(conversationId);
  if (!conv) return [];
  return conv.messages.map((m) => ({ role: m.role, content: m.content }));
}

export async function saveMessage(
  conversationId: string | null,
  role: 'user' | 'assistant',
  content: string,
  sources: Source[],
): Promise<void> {
  if (!conversationId) return;
  const conv = await readConv(conversationId);
  if (!conv) return; // conversation inconnue : no-op (même dégradation que l'ancien)
  const message: Message = {
    id: crypto.randomUUID(),
    role,
    content,
    sources,
    created_at: nowIso(),
  };
  conv.messages.push(message);
  conv.updated_at = message.created_at;
  await writeJsonAtomic(convPath(conversationId), conv);
}

export async function renameConversationIfDefault(
  conversationId: string | null,
  firstUserMessage: string,
): Promise<void> {
  if (!conversationId) return;
  const conv = await readConv(conversationId);
  if (!conv || conv.title !== DEFAULT_TITLE) return;
  conv.title = firstUserMessage.slice(0, 60);
  await writeJsonAtomic(convPath(conversationId), conv);
}
