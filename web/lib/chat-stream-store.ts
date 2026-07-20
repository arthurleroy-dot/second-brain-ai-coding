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

import { ChatFilterState, ChatStep, Message as MessageType, Source } from '@/types';

export interface ConvState {
  messages: MessageType[];
  loading: boolean; // requête envoyée, en attente du premier token
  streaming: boolean; // tokens en cours de réception (ou drain en cours)
  steps: ChatStep[]; // étapes de navigation de l'agent (éphémères)
}

const states = new Map<string, ConvState>();
const active = new Set<string>(); // conversations avec un flux en cours
const listeners = new Set<() => void>();

// Contrôleurs d'annulation des requêtes en cours (bouton Stop). Module-level
// comme `states` : `abortMessage` doit rester appelable après démontage /
// remontage des composants.
const controllers = new Map<string, AbortController>();

let counter = 0;

// Clé du chat éphémère (`/chat` sans id, non persisté). Elle vit au niveau
// module — donc STABLE d'un (dé)montage à l'autre — pour que l'état survive à la
// navigation même en mode dégradé (Supabase absent). `resetEphemeralKey` la fait
// tourner ET purge son entrée, pour repartir vraiment à neuf sur « Nouvelle
// discussion ».
let ephemeralKey = 'ephemeral';

export function getEphemeralKey(): string {
  return ephemeralKey;
}

export function resetEphemeralKey(): void {
  // Stoppe proprement tout flux en cours sur l'ancienne clé : requête annulée,
  // drain arrêté, état purgé — sinon l'animation (module-level) continuerait
  // d'écrire dans une entrée orpheline.
  controllers.get(ephemeralKey)?.abort();
  controllers.delete(ephemeralKey);
  cancelDrain(ephemeralKey);
  states.delete(ephemeralKey);
  active.delete(ephemeralKey);
  counter += 1;
  ephemeralKey = `ephemeral-${counter}`;
  emit();
}

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
  const prev =
    states.get(key) ?? { messages: [], loading: false, streaming: false, steps: [] };
  setState(key, fn(prev));
}

function updateMessageById(key: string, id: string, fn: (m: MessageType) => MessageType) {
  update(key, (s) => ({
    ...s,
    messages: s.messages.map((m) => (m.id === id ? fn(m) : m)),
  }));
}

/** Initialise l'état depuis le SSR si aucune entrée n'existe encore. */
export function seedIfAbsent(key: string, messages: MessageType[]) {
  if (states.has(key)) return;
  setState(key, { messages, loading: false, streaming: false, steps: [] });
}

/**
 * Remplace les messages par l'état frais de la base — SAUF si un flux est en
 * cours pour cette conversation : on ne doit jamais écraser une réponse en
 * train de se générer (la base ne contient pas encore le message assistant).
 * Un drain encore en train d'animer la fin d'une réponse compte comme un flux.
 */
export function hydrateFromDb(key: string, messages: MessageType[]) {
  if (active.has(key) || drains.has(key)) return;
  const cur = states.get(key);
  // Ne pas régresser : le store peut détenir un flux tout juste terminé, pas
  // encore relu depuis la base (course finalize/hydrate). On n'écrase que si la
  // base apporte du neuf.
  if (cur && messages.length <= cur.messages.length) return;
  setState(key, { messages, loading: false, streaming: false, steps: [] });
}

function localId(): string {
  counter += 1;
  return `local-${Date.now()}-${counter}`;
}

// ————————————————————————————————————————————————————————————————
// Lissage du streaming (effet machine à écrire)
//
// Le proxy LiteLLM coalesce les tokens en fragments « taille phrase » : relayés
// tels quels, le texte avance par gros blocs saccadés. On lisse côté client :
// les deltas sont empilés dans une file, et un drain à requestAnimationFrame —
// piloté par le TEMPS écoulé, pas par le framerate — révèle les caractères à
// cadence régulière, en accélérant quand la file gonfle pour ne jamais prendre
// de retard. Le drain vit ici (module-level, comme `states`) pour continuer
// d'animer même si ChatWindow est démonté pendant une navigation.

interface Drain {
  queue: string; // reçu mais pas encore affiché
  raf: number | null;
  assistantId: string;
  lastTs: number;
  finalText: string | null; // posé sur 'done', réconcilié en fin de drain
  finalSources: Source[] | null;
}

const drains = new Map<string, Drain>();

const CPS_BASE = 90; // vitesse « repos » (caractères/seconde)
const CPS_MAX = 1400; // plafond anti-dump quand la file gonfle
const FRAME_MS = 32; // révélation à ~30 fps : fluide, moitié moins de re-parses markdown

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Nombre de caractères à révéler pour `elapsedMs` : croisière à CPS_BASE,
 * accélérée pour viser une file vidée en ~250 ms, plafonnée à CPS_MAX.
 */
function revealCount(queueLen: number, elapsedMs: number): number {
  const cps = Math.min(CPS_MAX, Math.max(CPS_BASE, queueLen / 0.25));
  return Math.max(1, Math.round((cps * elapsedMs) / 1000));
}

function scheduleTick(key: string) {
  const d = drains.get(key);
  if (!d || d.raf !== null) return;
  d.raf = requestAnimationFrame(() => {
    d.raf = null;
    tick(key);
  });
}

function tick(key: string) {
  const d = drains.get(key);
  if (!d) return;

  const now = nowMs();
  const elapsed = now - d.lastTs;
  // Accumulateur de temps : on ne révèle qu'à ~30 fps même si rAF tourne à 60.
  if (elapsed < FRAME_MS) {
    scheduleTick(key);
    return;
  }

  if (d.queue.length > 0) {
    const n = revealCount(d.queue.length, elapsed);
    const chunk = d.queue.slice(0, n);
    d.queue = d.queue.slice(n);
    d.lastTs = now;
    updateMessageById(key, d.assistantId, (m) => ({ ...m, content: m.content + chunk }));
  }

  if (d.queue.length === 0 && d.finalText !== null) {
    // Fin du drain : réconciliation avec le texte canonique du serveur (bloc
    // SOURCES retiré, sources hydratées) et fin OFFICIELLE du streaming — le
    // toggle Stop→Envoyer ne bascule qu'ici, pas à l'arrivée réseau du 'done'.
    const { assistantId, finalText, finalSources } = d;
    drains.delete(key);
    updateMessageById(key, assistantId, (m) => ({
      ...m,
      content: finalText,
      sources: finalSources ?? m.sources,
    }));
    update(key, (s) => ({ ...s, streaming: false }));
    return;
  }

  // File encore pleine : on continue. File vide sans finalText : le drain
  // s'endort, le prochain enqueueDelta le réveillera.
  if (d.queue.length > 0) scheduleTick(key);
}

function enqueueDelta(key: string, assistantId: string, text: string) {
  // Garde SSR / environnement sans rAF : affichage direct, sans lissage.
  if (typeof requestAnimationFrame === 'undefined') {
    updateMessageById(key, assistantId, (m) => ({ ...m, content: m.content + text }));
    return;
  }
  let d = drains.get(key);
  if (!d) {
    d = { queue: '', raf: null, assistantId, lastTs: nowMs(), finalText: null, finalSources: null };
    drains.set(key, d);
  }
  d.queue += text;
  scheduleTick(key);
}

/**
 * Pose le texte final (événement 'done' du serveur) : le drain finit d'animer
 * la file puis réconcilie. `streaming` ne repasse à false qu'à ce moment-là.
 */
function finishDrain(key: string, assistantId: string, text: string, sources: Source[]) {
  const d = drains.get(key);
  if (!d || typeof requestAnimationFrame === 'undefined') {
    // Aucun delta reçu (réponse sans texte diffusable) ou pas de rAF :
    // réconciliation immédiate.
    cancelDrain(key);
    updateMessageById(key, assistantId, (m) => ({ ...m, content: text, sources }));
    update(key, (s) => ({ ...s, streaming: false }));
    return;
  }
  d.finalText = text;
  d.finalSources = sources;
  scheduleTick(key);
}

/**
 * Fige l'affichage d'un coup (erreur ou Stop) : dumpe ce qui restait en file —
 * ou le texte final s'il était déjà connu — et supprime le drain.
 */
function flushDrain(key: string) {
  const d = drains.get(key);
  if (!d) return;
  cancelDrain(key);
  if (!states.has(key)) return; // clé purgée (« Nouvelle discussion ») : rien à écrire
  if (d.finalText !== null) {
    const { finalText, finalSources } = d;
    updateMessageById(key, d.assistantId, (m) => ({
      ...m,
      content: finalText,
      sources: finalSources ?? m.sources,
    }));
  } else if (d.queue) {
    const { queue } = d;
    updateMessageById(key, d.assistantId, (m) => ({ ...m, content: m.content + queue }));
  }
}

/** Arrête l'animation et oublie le drain, sans toucher à l'état affiché. */
function cancelDrain(key: string) {
  const d = drains.get(key);
  if (!d) return;
  if (d.raf !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(d.raf);
  drains.delete(key);
}

/**
 * Fin de la requête (finally de sendMessage) : un drain qui détient déjà le
 * texte final termine son animation (c'est lui qui remettra `streaming` à
 * false) ; sinon (abort, erreur) on fige tout de suite.
 */
function settleDrain(key: string) {
  const d = drains.get(key);
  if (d && d.finalText !== null && typeof requestAnimationFrame !== 'undefined') {
    update(key, (s) => ({ ...s, loading: false }));
    scheduleTick(key);
  } else {
    flushDrain(key);
    update(key, (s) => ({ ...s, loading: false, streaming: false, steps: [] }));
  }
}

/**
 * Interrompt la génération en cours pour `key` (bouton Stop). L'annulation du
 * fetch se propage au serveur (req.signal) : la route coupe le stream Anthropic
 * et persiste le texte partiel — l'affichage et la base restent cohérents au
 * rechargement.
 */
export function abortMessage(key: string): void {
  controllers.get(key)?.abort();
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
  const controller = new AbortController();
  controllers.set(key, controller);

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
    steps: [],
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
      // Premier texte reçu : la navigation est finie, toutes les étapes sont lues.
      steps: s.steps.map((st) =>
        st.status === 'done' ? st : { ...st, status: 'done' as const },
      ),
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
    updateMessageById(key, assistantId, fn);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        conversation_id: serverConversationId,
        filters,
      }),
      // Le bouton Stop aborte ce fetch, ce qui signale AUSSI l'annulation au
      // serveur (req.signal) : le LLM est coupé, le partiel persisté.
      signal: controller.signal,
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

    // Lecture du flux NDJSON : { type: 'delta'|'step'|'done'|'error', ... }
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
          // Pas d'affichage direct : la file + le drain lissent la cadence.
          enqueueDelta(key, assistantId, evt.text);
        } else if (evt.type === 'step') {
          // Étape de navigation : l'agent exécute ses outils séquentiellement,
          // donc l'arrivée de l'étape N+1 prouve que la N est terminée.
          // Ne déclenche PAS ensureAssistant (loading reste vrai jusqu'au
          // premier delta de texte).
          update(key, (s) => ({
            ...s,
            steps: [
              ...s.steps.map((st) => ({ ...st, status: 'done' as const })),
              { label: evt.label, tool: evt.tool, path: evt.path, status: 'reading' as const },
            ],
          }));
        } else if (evt.type === 'done') {
          ensureAssistant();
          // Attache la checklist (toutes les étapes lues) au message — trace
          // repliable, non persistée — puis vide la liste live.
          const finishedSteps = (states.get(key)?.steps ?? []).map((st) => ({
            ...st,
            status: 'done' as const,
          }));
          if (finishedSteps.length > 0) {
            updateAssistant((m) => ({ ...m, steps: finishedSteps }));
          }
          update(key, (s) => ({ ...s, steps: [] }));
          finishDrain(key, assistantId, evt.text ?? '', evt.sources ?? []);
        } else if (evt.type === 'error') {
          flushDrain(key);
          ensureAssistant();
          updateAssistant((m) => ({
            ...m,
            content: `⚠️ ${evt.error ?? 'Erreur inconnue'}`,
          }));
          update(key, (s) => ({ ...s, steps: [] }));
        }
      }
    }
  } catch {
    if (controller.signal.aborted) {
      // Stop volontaire : on fige le texte partiel tel quel (le serveur le
      // persiste de son côté) — surtout PAS de message d'erreur. Avant le
      // premier token, il n'y a ni bulle ni drain : seule la question reste.
      flushDrain(key);
    } else {
      ensureAssistant();
      updateAssistant((m) => ({
        ...m,
        content: m.content || '⚠️ Erreur réseau pendant la requête.',
      }));
    }
  } finally {
    active.delete(key);
    controllers.delete(key);
    if (states.has(key)) {
      settleDrain(key);
    } else {
      // « Nouvelle discussion » a purgé la clé pendant le vol : ne pas
      // recréer d'entrée orpheline.
      cancelDrain(key);
    }
  }
}
