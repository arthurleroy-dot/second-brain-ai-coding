// Store de suivi d'ingestion, au niveau module (singleton).
//
// Objectif : que le suivi d'un dépôt (« Ingestion en cours… » → « Ingéré dans le
// wiki + coût ») SURVIVE quand l'utilisateur quitte /upload puis y revient — et
// même à un rechargement complet de l'app.
//
// Pourquoi un store module-level et pas l'état local d'UploadForm ?
// La navigation de l'app est client-side (next/link) : la SPA reste vivante d'une
// page à l'autre, mais chaque page.tsx est DÉMONTÉE puis remontée à neuf. Un
// `useState` local est donc détruit à la navigation. En plaçant l'état et sa
// boucle de polling ici (module-level, jamais rechargé), ils survivent au
// démontage. UploadForm/IngestStatus s'y abonnent via `useSyncExternalStore` et
// reflètent l'état courant à chaque (re)montage. C'est le même procédé que le
// chat (`chat-stream-store.ts`), en beaucoup plus simple : le moteur d'ingestion
// est GLOBAL et UNIQUE (un seul run à la fois, verrou fichier), donc un état
// unique suffit — pas de Map par clé.
//
// La source de vérité reste le serveur : l'état d'ingestion est persisté sur
// disque (`.data/ingest-state.json`). Ce store n'en est qu'un MIROIR côté client,
// alimenté par polling. Il ne recrée jamais le travail : il le reflète.
//
// Ce module est importé uniquement par des composants client ('use client') et
// s'exécute dans le navigateur.

import { IngestStep } from '@/types';

export interface IngestView {
  file: string | null; // fichier suivi (nom dans /raw)
  state: 'pending' | 'processing' | 'ingested' | 'error';
  slug: string | null;
  cost: number | null; // USD
  error: string | null;
  // Checklist temps réel des phases du pipeline d'ingestion (extract → analyze →
  // project → write → verify), alimentée par le flux NDJSON /api/ingest-stream.
  // ÉPHÉMÈRE : le polling reste l'autorité de l'état terminal (state/slug/cost).
  steps: IngestStep[];
}

let view: IngestView | null = null; // null = rien à afficher (formulaire vierge)
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
// Contrôleur du flux NDJSON en cours (garde anti-double-connexion). Module-level
// comme `timer` : la boucle de lecture survit au démontage d'UploadForm.
let streamCtl: AbortController | null = null;

function emit() {
  for (const l of listeners) l();
}

/** Abonnement pour `useSyncExternalStore`. */
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Snapshot pour `useSyncExternalStore`. Renvoie la MÊME référence tant que l'état
 * n'a pas changé : `setView` REMPLACE l'objet (ne le mute pas en place), donc pas
 * de re-render inutile ni de boucle infinie.
 */
export function getView(): IngestView | null {
  return view;
}

function setView(next: IngestView | null) {
  view = next;
  emit();
}

// Boucle de polling AU NIVEAU MODULE (reprend l'ancien useEffect d'IngestStatus) :
// survit au démontage du composant. Poll le endpoint FILE-scoped (précis :
// manifeste → slug exact + fileCostUsd). S'arrête à 'ingested' / 'error'.
function pollOnce() {
  const f = view?.file;
  if (!f) return;
  fetch(`/api/ingest-status?file=${encodeURIComponent(f)}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      if (view?.file !== f) return; // course : le fichier suivi a changé entre-temps
      // Préserve toujours la checklist déjà reçue : chaque poll ne fait autorité
      // que sur state/slug/cost/error, jamais sur `steps` (alimentés par le flux).
      const steps = view?.steps ?? [];
      if (d.state === 'ingested') {
        const c = typeof d.fileCostUsd === 'number' ? d.fileCostUsd : d.costUsd;
        // Le polling est l'autorité qui ARRÊTE le fil une fois l'état terminal atteint.
        disconnectStream();
        setView({
          file: f,
          state: 'ingested',
          slug: d.slug ?? null,
          cost: typeof c === 'number' ? c : null,
          error: null,
          steps,
        });
        return; // arrêt (pas de re-arm du timer)
      }
      if (d.state === 'error') {
        disconnectStream();
        setView({ file: f, state: 'error', slug: null, cost: null, error: d.error ?? null, steps });
        return;
      }
      setView({
        file: f,
        state: d.state === 'processing' ? 'processing' : 'pending',
        slug: null,
        cost: null,
        error: null,
        steps,
      });
      timer = setTimeout(pollOnce, 5000);
    })
    .catch(() => {
      timer = setTimeout(pollOnce, 5000);
    });
}

/** Démarre le suivi d'un fichier (appelé au succès du POST /api/upload). */
export function startTracking(file: string) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  setView({ file, state: 'pending', slug: null, cost: null, error: null, steps: [] });
  pollOnce(); // autorité de l'état terminal (state/slug/cost)
  connectStream(); // fil temps réel qui peuple `steps`
}

/** Réinitialise l'affichage (bouton « Déposer un autre document »). */
export function clear() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  disconnectStream();
  setView(null);
}

// ————————————————————————————————————————————————————————————————
// Flux NDJSON temps réel (/api/ingest-stream) → peuple `view.steps`.
//
// Même lecture ligne-à-ligne que le chat (`chat-stream-store.ts`), MAIS sans le
// lissage machine-à-écrire : on ne rend pas de markdown, juste une checklist +
// un compteur de caractères en `detail`. Le `status` reading→done est dérivé ici
// (comme le chat) : l'arrivée de l'étape N+1 coche la N.

/** Compteur de caractères rédigés → texte d'animation muté de l'étape IA. */
function formatGen(n: number): string {
  const grouped = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `L'IA rédige… ${grouped} caractère${n > 1 ? 's' : ''}`;
}

async function connectStream() {
  if (streamCtl) return; // déjà connecté (garde anti-double-connexion)
  const ctl = new AbortController();
  streamCtl = ctl;
  let genChars = 0; // caractères cumulés de l'étape IA en cours (reset à chaque step)

  try {
    const res = await fetch('/api/ingest-stream', { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok || !res.body) return; // aucun run côté serveur : le polling suffit
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

        let evt: any;
        try {
          evt = JSON.parse(line);
        } catch {
          continue; // ligne partielle/corrompue : on ignore
        }

        if (evt.type === 'step') {
          genChars = 0;
          const cur = view;
          if (!cur) continue; // désabonné/purgé entre-temps
          // Dérivation reading→done : l'arrivée de l'étape N+1 coche la N (comme le chat).
          setView({
            ...cur,
            steps: [
              ...cur.steps.map((s) => ({ ...s, status: 'done' as const })),
              { label: evt.label, phase: evt.phase, file: evt.file, status: 'reading' as const },
            ],
          });
        } else if (evt.type === 'delta') {
          genChars += String(evt.text ?? '').length;
          const cur = view;
          if (!cur || cur.steps.length === 0) continue;
          const last = cur.steps[cur.steps.length - 1];
          if (last.status !== 'reading') continue; // le detail n'orne que l'étape active
          const steps = cur.steps.slice();
          steps[steps.length - 1] = { ...last, detail: formatGen(genChars) };
          setView({ ...cur, steps });
        } else if (evt.type === 'done' || evt.type === 'error') {
          const cur = view;
          if (cur) {
            setView({
              ...cur,
              steps: cur.steps.map((s) => ({ ...s, status: 'done' as const, detail: undefined })),
            });
          }
          try {
            await reader.cancel();
          } catch {
            /* déjà fermé */
          }
          // Bascule l'état terminal (ingested/error) SANS attendre le tick 5 s ;
          // pollOnce coupera aussi le fil (il est l'autorité terminale).
          pollOnce();
          return;
        }
      }
    }
  } catch {
    /* abort volontaire ou réseau : le polling reste l'autorité de l'état terminal */
  } finally {
    if (streamCtl === ctl) streamCtl = null;
  }
}

function disconnectStream() {
  streamCtl?.abort();
  streamCtl = null;
}

// Au premier montage, si le store est vide : demander l'état GLOBAL. N'ADOPTER
// qu'un run RÉELLEMENT en cours (`processing` + `pending` non vide), sinon on
// ré-afficherait un 'done' périmé (persisté sur disque entre sessions) à chaque
// visite de /upload. Récupère aussi un run en cours après un rechargement complet.
export async function seedFromServer() {
  if (view) return; // déjà quelque chose à afficher
  try {
    const d = await fetch('/api/ingest-status', { cache: 'no-store' }).then((r) => r.json());
    if (d.state === 'processing' && Array.isArray(d.pending) && d.pending.length > 0) {
      startTracking(d.pending[0]); // lot mono-fichier = cas courant
    }
  } catch {
    /* ignore : réseau indisponible, formulaire vierge */
  }
}
