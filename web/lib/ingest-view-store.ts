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

export interface IngestView {
  file: string | null; // fichier suivi (nom dans /raw)
  state: 'pending' | 'processing' | 'ingested' | 'error';
  slug: string | null;
  cost: number | null; // USD
  error: string | null;
}

let view: IngestView | null = null; // null = rien à afficher (formulaire vierge)
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

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
      if (d.state === 'ingested') {
        const c = typeof d.fileCostUsd === 'number' ? d.fileCostUsd : d.costUsd;
        setView({
          file: f,
          state: 'ingested',
          slug: d.slug ?? null,
          cost: typeof c === 'number' ? c : null,
          error: null,
        });
        return; // arrêt (pas de re-arm du timer)
      }
      if (d.state === 'error') {
        setView({ file: f, state: 'error', slug: null, cost: null, error: d.error ?? null });
        return;
      }
      setView({
        file: f,
        state: d.state === 'processing' ? 'processing' : 'pending',
        slug: null,
        cost: null,
        error: null,
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
  setView({ file, state: 'pending', slug: null, cost: null, error: null });
  pollOnce();
}

/** Réinitialise l'affichage (bouton « Déposer un autre document »). */
export function clear() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  setView(null);
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
