// Store de streaming de chat, au niveau module (singleton).
//
// Objectif : qu'une génération de réponse CONTINUE même quand l'utilisateur
// quitte la page de la conversation, et qu'à son retour il voie la réponse
// poursuivre son streaming en direct (comme ChatGPT).
//
// Pourquoi un store module-level et pas l'état local de ChatWindow ?
// La navigation dans l'app est client-side (next/link) : la SPA reste vivante
// d'une page à l'autre. En sortant la boucle de lecture du flux du cycle de vie
// du composant (qui, lui, est démonté à la navigation) et en la plaçant ici,
// le `fetch` n'est jamais interrompu : il continue d'alimenter le store en
// arrière-plan. ChatWindow s'abonne au store via `useSyncExternalStore` et
// reflète l'état courant à chaque (re)montage.
//
// Ce module est importé uniquement par des composants client ('use client') et
// s'exécute dans le navigateur.

import { ChatFilterState, Message as MessageType } from '@/types';

export interface ConvState {
  messages: MessageType[];
  loading: boolean; // requête envoyée, en attente du premier token
  streaming: boolean; // tokens en cours de réception
}

const states = new Map<string, ConvState>();
const active = new Set<string>(); // conversations avec un flux en cours
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Abonnement pour `useSyncExternalStore`. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Snapshot pour `useSyncExternalStore`. Renvoie la même référence tant que
 * l'état n'a pas changé (les mutations remplacent l'objet), donc pas de
 * re-render inutile.
 */
export function getState(key: string): ConvState | undefined {
  return states.get(key);
}

export function isStreaming(key: string): boolean {
  return active.has(key);
}

function setState(key: string, next: ConvState) {
  states.set(key, next);
  emit();
}

function update(key: string, fn: (s: ConvState) => ConvState) {
  const prev = states.get(key) ?? { messages: [], loading: false, streaming: false };
  setState(key, fn(prev));
}

/** Initialise l'état depuis le SSR si aucune entrée n'existe encore. */
export function seedIfAbsent(key: string, messages: MessageType[]) {
  if (states.has(key)) return;
  setState(key, { messages, loading: false, streaming: false });
}

/**
 * Remplace les messages par l'état frais de la base — SAUF si un flux est en
 * cours pour cette conversation : on ne doit jamais écraser une réponse en
 * train de se générer (la base ne contient pas encore le message assistant).
 */
export function hydrateFromDb(key: string, messages: MessageType[]) {
  if (active.has(key)) return;
  setState(key, { messages, loading: false, streaming: false });
}

let counter = 0;
function localId(): string {
  counter += 1;
  return `local-${Date.now()}-${counter}`;
}

/**
 * Démarre l'envoi d'un message et le streaming de la réponse pour `key`.
 * `serverConversationId` est l'id transmis à l'API (`null` pour le chat
 * éphémère). La boucle de lecture vit dans le store et survit au démontage de
 * ChatWindow.
 */
export async function sendMessage(
  key: string,
  serverConversationId: string | null,
  text: string,
  filters: ChatFilterState | undefined,
): Promise<void> {
  if (active.has(key)) return; // un flux est déjà en cours pour cette conversation
  active.add(key);

  const userMsg: MessageType = {
    id: localId(),
    role: 'user',
    content: text,
    sources: [],
    created_at: new Date().toISOString(),
  };
  update(key, (s) => ({
    ...s,
    messages: [...s.messages, userMsg],
    loading: true,
    streaming: false,
  }));

  const assistantId = localId();
  let started = false;
  const ensureAssistant = () => {
    if (started) return;
    started = true;
    update(key, (s) => ({
      ...s,
      loading: false,
      streaming: true,
      messages: [
        ...s.messages,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          sources: [],
          created_at: new Date().toISOString(),
        },
      ],
    }));
  };
  const updateAssistant = (fn: (m: MessageType) => MessageType) =>
    update(key, (s) => ({
      ...s,
      messages: s.messages.map((m) => (m.id === assistantId ? fn(m) : m)),
    }));

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        conversation_id: serverConversationId,
        filters,
      }),
    });

    // Erreurs renvoyées hors flux (400/503) : corps JSON classique.
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      ensureAssistant();
      updateAssistant((m) => ({
        ...m,
        content: `⚠️ ${data?.error ?? 'Erreur inconnue'}`,
      }));
      return;
    }

    // Lecture du flux NDJSON : { type: 'delta'|'done'|'error', ... }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        const evt = JSON.parse(line);
        if (evt.type === 'delta') {
          ensureAssistant();
          updateAssistant((m) => ({ ...m, content: m.content + evt.text }));
        } else if (evt.type === 'done') {
          ensureAssistant();
          updateAssistant((m) => ({
            ...m,
            content: evt.text ?? m.content,
            sources: evt.sources ?? [],
          }));
        } else if (evt.type === 'error') {
          ensureAssistant();
          updateAssistant((m) => ({
            ...m,
            content: `⚠️ ${evt.error ?? 'Erreur inconnue'}`,
          }));
        }
      }
    }
  } catch {
    ensureAssistant();
    updateAssistant((m) => ({
      ...m,
      content: m.content || '⚠️ Erreur réseau pendant la requête.',
    }));
  } finally {
    active.delete(key);
    update(key, (s) => ({ ...s, loading: false, streaming: false }));
  }
}
