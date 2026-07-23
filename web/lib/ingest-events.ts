// Émetteur d'événements d'ingestion, au niveau module (singleton, EN MÉMOIRE).
//
// Pourquoi cette pièce existe (et pourquoi elle diffère du chat) :
// le chat tient son flux ouvert pendant toute la requête `POST /api/chat` —
// l'émetteur EST le `controller` du `ReadableStream`, aucun buffer serveur.
// L'ingestion, elle, est lancée en FIRE-AND-FORGET par `POST /api/upload`
// (`void runIngestion().catch(...)`) : elle n'est rattachée à AUCUNE requête.
// Le client n'ouvre le flux de suivi qu'APRÈS le retour du POST, donc APRÈS que
// plusieurs phases ont déjà été émises. D'où ce module : un émetteur qui
// BUFFERISE les événements du run courant et les REJOUE à la (re)connexion.
//
// Hypothèse (identique au moteur d'ingestion) : process serveur unique et
// long-vécu (Electron / `next start`) ; un seul run à la fois (verrou fichier).
// Purement éphémère : aucune écriture disque. Au redémarrage complet du process
// le buffer est perdu — sans gravité, l'état terminal reste lu du disque par le
// polling de `/api/ingest-status`.

// Événement de fil, aligné sur le style du chat (NDJSON, un objet par ligne).
// Le `status` reading|done N'EST PAS transmis : il est dérivé CÔTÉ CLIENT, comme
// pour `ChatStep` (l'arrivée de l'étape N+1 prouve que la N est terminée).
export type IngestEvent =
  | { type: 'step'; id: number; phase: string; label: string; file?: string }
  | { type: 'delta'; text: string } // animation de l'étape IA (jamais rendu en markdown)
  | { type: 'done' }
  | { type: 'error'; error: string };

interface RunLog {
  runId: number;
  events: IngestEvent[];
  terminal: boolean;
}

let current: RunLog | null = null;
const subscribers = new Set<(e: IngestEvent) => void>();
let runSeq = 0;
let stepSeq = 0;

/** Diffuse un événement à tous les abonnés, chacun isolé (un throw n'en coupe pas un autre). */
function broadcast(e: IngestEvent): void {
  for (const fn of subscribers) {
    try {
      fn(e);
    } catch {
      /* un abonné défaillant (flux fermé) ne doit pas casser les autres */
    }
  }
}

/**
 * Ouvre un nouveau run. Appelé APRÈS `acquireLock()` réussi. Remplace `current`
 * par un journal neuf et réinitialise le compteur d'étapes. Ne notifie PAS les
 * anciens abonnés (leur run est terminé/fermé) : ils seront écrasés ici.
 */
export function startRun(): void {
  runSeq += 1;
  stepSeq = 0;
  current = { runId: runSeq, events: [], terminal: false };
}

/** Émet une étape de pipeline (bufferisée + diffusée). No-op si aucun run ouvert. */
export function emitStep(phase: string, label: string, file?: string): void {
  if (!current) return;
  stepSeq += 1;
  const e: IngestEvent = { type: 'step', id: stepSeq, phase, label, ...(file ? { file } : {}) };
  current.events.push(e);
  broadcast(e);
}

/** Émet un delta de texte (animation « en cours d'écriture »). No-op si aucun run ouvert. */
export function emitDelta(text: string): void {
  if (!current) return;
  const e: IngestEvent = { type: 'delta', text };
  current.events.push(e);
  broadcast(e);
}

/**
 * Marque le run terminé avec succès. On CONSERVE `current` (avec `terminal:true`)
 * pour qu'une connexion tardive rejoue la liste complète + l'événement terminal.
 */
export function emitDone(): void {
  if (!current) return;
  const e: IngestEvent = { type: 'done' };
  current.events.push(e);
  current.terminal = true;
  broadcast(e);
}

/** Marque le run terminé en erreur (même conservation que `emitDone`). */
export function emitError(error: string): void {
  if (!current) return;
  const e: IngestEvent = { type: 'error', error };
  current.events.push(e);
  current.terminal = true;
  broadcast(e);
}

/**
 * Instantané du run courant : `runId`, COPIE superficielle du tableau `events`
 * (le tableau interne ne doit pas fuiter), et l'indicateur `terminal`. `null` si
 * aucun run n'a jamais été ouvert dans ce process.
 */
export function snapshot(): { runId: number; events: IngestEvent[]; terminal: boolean } | null {
  if (!current) return null;
  return { runId: current.runId, events: [...current.events], terminal: current.terminal };
}

/**
 * Abonnement pour la route de flux. La route fait `snapshot()` puis `subscribe()`
 * SANS aucun `await` entre les deux : JS mono-thread + les emits n'ont lieu qu'aux
 * points `await` de `runIngestion` → aucun événement ne peut s'intercaler, ni trou
 * ni doublon. Renvoie une fonction de désabonnement.
 */
export function subscribe(fn: (e: IngestEvent) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
