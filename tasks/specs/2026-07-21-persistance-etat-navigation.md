# Persistance d'état à la navigation (bug upload/ingestion + généralisation)

> Spec autosuffisante. L'agent d'implémentation n'a PAS vu la conversation :
> tout le contexte, les chemins, les signatures et les idiomes à répliquer sont ici.

## Contexte

**Demande d'origine (utilisateur, non-développeur) :** « Quand j'upload une nouvelle
ressource, que je quitte la page pour faire autre chose pendant que l'ingestion se
fait, et que je reviens à la page d'upload, je ne suis plus sur le process
d'ingestion mais sur une nouvelle page vierge. Et globalement dans l'application, à
chaque fois que je vais d'une page à l'autre et que je retourne à la page où j'étais
avant, je ne me retrouve pas où j'étais. Ce bug a d'ailleurs déjà été résolu avec la
page de chat. »

**Cause racine (confirmée par lecture du code).** La navigation de l'app (`web/`,
Next.js App Router, aussi packagée en Electron) est 100 % client-side. Seuls
`Sidebar` + `TopBar` vivent dans le layout persistant unique
(`web/app/layout.tsx` — `<main>{children}</main>`) ; **chaque `page.tsx` est démontée
à la navigation puis remontée à neuf**. Il n'existe AUCUN store global / contexte
React / keep-alive dans `web/` — vérifié : 0 `createContext`, 0 `useContext`, 0
Provider, aucune lib de state (pas de Zustand/Redux/Jotai/SWR/TanStack). **Seule
exception : le chat**, qui a déjà résolu exactement ce problème.

- **Chat (déjà résolu, commit `c4817ae`).** L'état vit dans un **store singleton au
  niveau module** : `web/lib/chat-stream-store.ts` (`const states = new Map(...)` en
  portée module). Comme la navigation SPA ne recharge jamais le module JS, cet état
  survit au démontage/remontage. `web/components/chat/ChatWindow.tsx` s'y ré-abonne
  via `useSyncExternalStore` à chaque montage. La boucle de streaming (`fetch`
  reader) vit DANS le module → elle continue même quand `ChatWindow` est démonté.
- **Upload (cassé).** Le fichier suivi est un `useState` local :
  `web/components/upload/UploadForm.tsx:91` (`const [submittedFile, setSubmittedFile]`).
  Détruit au démontage → au retour, `submittedFile` repart à `null`, la garde
  `if (submittedFile)` (`UploadForm.tsx:215`) est fausse → **formulaire vierge**.
  `web/components/upload/IngestStatus.tsx:28-64` poll aussi son propre `useState`
  local. Rien ne re-détecte l'ingestion au remontage.

**Point capital : l'ingestion serveur, elle, survit déjà.** `runIngestion()`
(`web/lib/ingest-local.ts:679-783`) est lancée en fire-and-forget par l'upload
(`web/app/api/upload/route.ts:238`, `void runIngestion().catch(...)`) et **persiste
son état sur disque** dans `<DATA_ROOT>/.data/ingest-state.json` via
`writeIngestState()` (`ingest-local.ts:73`). Le travail n'est jamais perdu — c'est
uniquement la *vue* qui ne se rebranche pas. Le correctif rend la vue upload
**miroir de cet état serveur** + la fait survivre à la navigation via un store
module, dans l'esprit du chat.

Périmètre validé par l'utilisateur : **Partie A (fix upload/ingestion) + Partie B
(généralisation à toutes les pages principales).**

---

## Plan

### Rappels de code existant (à connaître avant de coder)

**`web/lib/ingest-local.ts` — état serveur persistant (NE PAS modifier le moteur) :**
```ts
export interface IngestState {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt?: string; finishedAt?: string;
  pending?: string[];               // fichiers du lot en cours de traitement
  slug?: string;                    // slug du DERNIER fichier ingéré du lot
  error?: string; logTail?: string;
  costUsd?: number;                 // coût total du run
  perFile?: { file: string; costUsd: number }[];
}
export async function readIngestState(): Promise<IngestState> // lit .data/ingest-state.json (idle si absent)
export function lockHeld(): boolean                            // .data/ingest.lock présent ?
```
Transitions écrites par `runIngestion()` : `running` (avec `pending`) au début →
`done` (avec `slug`, `perFile`, `costUsd`) ou `error` à la fin.

**`web/app/api/ingest-status/route.ts` — endpoint actuel (exige `?file=`) :**
```ts
// GET /api/ingest-status?file=<nom dans /raw>
// 1) si manifeste wiki/_ingested.json contient file.slug → { state:'ingested', slug, costUsd, fileCostUsd }
// 2) sinon si readIngestState().status==='running' || lockHeld() → { state:'processing' }
// 3) sinon si status==='error' → { state:'error', error }
// 4) sinon → { state:'pending' }
```

**`web/lib/chat-stream-store.ts` — idiome exact à répliquer** (store module + notify) :
```ts
const states = new Map<string, ConvState>();
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
export function subscribe(listener: () => void): () => void {   // pour useSyncExternalStore
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getState(key: string): ConvState | undefined { return states.get(key); }
```
Consommation dans `ChatWindow.tsx:49` :
```ts
const state = useSyncExternalStore(subscribe, () => getState(storeKey), () => undefined);
//                                 ^subscribe  ^getSnapshot            ^getServerSnapshot (undefined → pas de mismatch SSR)
```
`getSnapshot` DOIT renvoyer une référence stable tant que rien n'a changé (les
mutations REMPLACENT l'objet d'état, ne le mutent pas en place) sinon boucle de
re-render infinie. `getServerSnapshot` renvoie `undefined` (ces composants sont
`'use client'` mais rendus au SSR).

---

### Partie A — Suivi d'ingestion qui survit à la navigation *(le bug décrit)*

**A1. Endpoint : mode « global » (sans `file`) pour `/api/ingest-status`.**
Fichier : `web/app/api/ingest-status/route.ts`. Aujourd'hui il renvoie 400 si `file`
manque. Ajouter : si `file` est absent, renvoyer l'état moteur GLOBAL —
```ts
const state = await readIngestState();
const processing = state.status === 'running' || lockHeld();
return Response.json({
  state: processing ? 'processing' : state.status === 'error' ? 'error'
        : state.status === 'done' ? 'done' : 'idle',
  pending: state.pending ?? [],
  slug: state.slug ?? null,
  costUsd: state.costUsd ?? null,
  perFile: state.perFile ?? [],
  error: state.error ?? null,
});
```
Ne change RIEN au comportement quand `file` est fourni (rétro-compatible). But :
permettre de **récupérer un run en cours sans connaître le nom du fichier**.

**A2. Nouveau store module-level `web/lib/ingest-view-store.ts`** (calqué sur
`chat-stream-store.ts`, beaucoup plus simple — un seul moteur d'ingestion global,
donc pas de `Map` par clé, un état unique suffit) :
```ts
export interface IngestView {
  file: string | null;                                   // fichier suivi (nom dans /raw)
  state: 'pending' | 'processing' | 'ingested' | 'error';
  slug: string | null;
  cost: number | null;                                   // USD
  error: string | null;
}
let view: IngestView | null = null;                      // null = rien à afficher (formulaire vierge)
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() { for (const l of listeners) l(); }
export function subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function getView(): IngestView | null { return view; }

function setView(next: IngestView | null) { view = next; emit(); }

// Boucle de polling AU NIVEAU MODULE (reprend IngestStatus.tsx:36-56) : survit au
// démontage du composant. Poll le endpoint FILE-scoped (précis : manifeste →
// slug exact + fileCostUsd). S'arrête à 'ingested' / 'error'.
function pollOnce() {
  const f = view?.file;
  if (!f) return;
  fetch(`/api/ingest-status?file=${encodeURIComponent(f)}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => {
      if (view?.file !== f) return;                      // course : tracking changé entre-temps
      if (d.state === 'ingested') {
        const c = typeof d.fileCostUsd === 'number' ? d.fileCostUsd : d.costUsd;
        setView({ file: f, state: 'ingested', slug: d.slug ?? null, cost: typeof c === 'number' ? c : null, error: null });
        return;                                          // arrêt (pas de re-arm)
      }
      if (d.state === 'error') { setView({ file: f, state: 'error', slug: null, cost: null, error: d.error ?? null }); return; }
      setView({ file: f, state: d.state === 'processing' ? 'processing' : 'pending', slug: null, cost: null, error: null });
      timer = setTimeout(pollOnce, 5000);
    })
    .catch(() => { timer = setTimeout(pollOnce, 5000); });
}

export function startTracking(file: string) {            // appelé au succès du POST /api/upload
  if (timer) { clearTimeout(timer); timer = null; }
  setView({ file, state: 'pending', slug: null, cost: null, error: null });
  pollOnce();
}

export function clear() {                                // bouton « Déposer un autre document »
  if (timer) { clearTimeout(timer); timer = null; }
  setView(null);
}

// Au premier montage, si le store est vide : demander l'état GLOBAL. N'ADOPTER
// qu'un run RÉELLEMENT en cours (sinon on ré-afficherait un 'done' périmé à chaque
// visite). Récupère aussi après un rechargement complet de l'app.
export async function seedFromServer() {
  if (view) return;                                      // déjà quelque chose à afficher
  try {
    const d = await fetch('/api/ingest-status', { cache: 'no-store' }).then((r) => r.json());
    if (d.state === 'processing' && Array.isArray(d.pending) && d.pending.length > 0) {
      startTracking(d.pending[0]);                       // lot mono-fichier = cas courant
    }
  } catch { /* ignore */ }
}
```

**A3. Brancher les composants sur le store.**
- `web/components/upload/UploadForm.tsx` :
  - Supprimer `const [submittedFile, setSubmittedFile] = useState<string|null>(null)` (ligne 91).
  - Lire la vue via `const ingest = useSyncExternalStore(subscribe, getView, () => null)`
    (imports depuis `@/lib/ingest-view-store`).
  - Au montage : `useEffect(() => { seedFromServer(); }, [])`.
  - Au succès du POST (ligne 204, `setSubmittedFile(data.file)`) → `startTracking(data.file)`.
  - La garde d'affichage (ligne 215) devient `if (ingest)` au lieu de `if (submittedFile)` ;
    passer `<IngestStatus />` sans prop `file` (il lit le store), OU lui passer `ingest` en props.
  - `reset()` (ligne 120-136) : remplacer `setSubmittedFile(null)` par `clear()`.
  - Note `displayName` (ligne 116-117) : conserver l'affichage du nom déposé. En
    reprise (`seedFromServer`), `file`, `title`, etc. du formulaire sont vides →
    afficher `ingest.file` comme nom de repli.
- `web/components/upload/IngestStatus.tsx` : devient **présentationnel**. Supprimer
  son `useState`+`useEffect` de polling (lignes 28-64) ; il lit l'état depuis le
  store (`useSyncExternalStore(subscribe, getView, () => null)`) ou le reçoit en
  props depuis `UploadForm`. Conserver le rendu existant (loader « Ingestion en
  cours… », « Ingéré dans le wiki » + `formatCost` + lien `/sources/<slug>`).
  Conserver la fonction `formatCost` (lignes 14-20).

Résultat : quitter `/upload` pendant l'ingestion et revenir → suivi en direct
conservé, jusqu'à « Ingéré dans le wiki + coût ». Bonus : un rechargement complet de
l'app récupère aussi le run en cours (via `seedFromServer`).

---

### Partie B — Généralisation « je retrouve toujours ma place »

On emballe le principe du store module dans **deux hooks réutilisables**, appliqués
en opt-in aux pages principales.

**B1. `web/lib/use-persistent-state.ts`** — `usePersistentState<T>(key, initial)`,
API identique à `useState` mais l'état survit à la navigation (Map module-level) :
```ts
'use client';
import { useCallback, useState } from 'react';

const store = new Map<string, unknown>();                // survit à la navigation SPA

export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  // Lazy init : restaure depuis le store au (re)montage.
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const set = useCallback((v: T | ((p: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      store.set(key, next);
      return next;
    });
  }, [key]);
  return [value, set];
}
```
> Note : une seule instance de page consomme une clé à la fois (la page précédente
> est démontée avant le retour), donc `useState` + lazy-init depuis la `Map` suffit —
> pas besoin de `useSyncExternalStore` ici. Option (si survie au reload complet
> souhaitée) : adosser `store` à `sessionStorage` (lecture au 1er accès, écriture
> dans `set`). À NE FAIRE que pour les états sérialisables et légers.

**B2. `web/lib/use-scroll-restoration.ts`** — sauve/restaure `scrollTop` du conteneur
scrollable :
```ts
'use client';
import { useEffect, useRef } from 'react';
const scrollStore = new Map<string, number>();
export function useScrollRestoration<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && scrollStore.has(key)) el.scrollTop = scrollStore.get(key)!;
    return () => { if (el) scrollStore.set(key, el.scrollTop); };
  }, [key]);
  return ref;                                            // à poser sur le conteneur `overflow-y-auto`
}
```

**B3. Application opt-in aux pages principales.** Pour CHAQUE page ci-dessous :
(1) remplacer les `useState` d'UI qui méritent de survivre (filtres, recherche,
onglet actif) par `usePersistentState('<page>:<champ>', initial)` ; (2) poser
`useScrollRestoration('<page>:scroll')` sur le conteneur scrollable racine.
- `sources` (`web/app/sources/page.tsx` + composant liste) — **exemple de référence** :
  filtre (déjà partiellement piloté par l'URL `?filter=needs_review` via des `<Link>`
  du TopBar — garder l'URL comme source pour ce filtre-là ; persister recherche
  texte + scroll), scroll de la liste.
- `wiki` (`web/app/wiki/page.tsx`) — recherche/filtre + scroll.
- `graph` (`web/app/graph/page.tsx`) — scroll (+ zoom/pan si l'état est en `useState`).
- `explore` (`web/app/explore/page.tsx`) — requête + résultats + scroll.
- `entities` (`web/app/entities/page.tsx`) — filtre + scroll.
- `themes` (`web/app/themes/page.tsx`) — scroll (+ filtre éventuel).
- `upload` (`web/components/upload/UploadView.tsx`) — poser `useScrollRestoration`
  sur le `<div className="h-full overflow-y-auto">` (ligne 17). Les champs du
  formulaire peuvent optionnellement être persistés via `usePersistentState`, mais
  la Partie A couvre déjà l'essentiel (le suivi d'ingestion).

> L'agent DOIT ouvrir chaque `page.tsx`/composant pour recenser les `useState`
> réellement utiles à persister. Ne PAS persister un état dérivé/rechargé du serveur
> qui doit rester frais (ex. listes rechargées à chaque montage) — seulement l'état
> d'UI (filtres, recherche, onglet, scroll).

**Clés de persistance** : chaînes stables `'<page>:<champ>'` (ex. `'sources:search'`,
`'sources:scroll'`). Ne jamais les renommer (comme les slugs du wiki : renommer =
perdre l'état). Documenter la convention en tête de `use-persistent-state.ts`.

---

## Décisions

- **Store module-level plutôt que React Context / lib de state (Partie A & B).**
  C'est le pattern DÉJÀ éprouvé du chat dans ce repo (`chat-stream-store.ts`), il
  survit à la navigation SPA sans dépendance, et l'ancien `web/lib/chat-context.ts`
  (approche Context) a justement été SUPPRIMÉ au profit du store module (commit
  `c4817ae`). Alternatives écartées : Context (ne survit pas au démontage du
  provider si placé dans la page ; le mettre dans le layout imposerait de tout
  hisser) ; Zustand/Jotai (dépendance inutile, le repo n'en a aucune) ; keep-alive
  de l'arbre (non supporté proprement par l'App Router).

- **Vue upload = miroir de l'état serveur, pas re-streaming (Partie A).** L'ingestion
  est un moteur GLOBAL UNIQUE déjà persisté sur disque avec verrou fichier. Inutile
  de recopier la complexité du chat (drain rAF, NDJSON, AbortController) : un simple
  polling module-level suffit. Bonus vs chat : `seedFromServer` récupère aussi après
  un **rechargement complet** de l'app (le chat ne récupère le live que via ses
  fichiers JSON par conversation).

- **`seedFromServer` n'adopte qu'un run `processing`.** Sinon un `status:'done'`
  périmé (persistant sur disque entre sessions) ré-afficherait « Ingéré dans le
  wiki » à chaque ouverture de `/upload`. Un `done`/`idle`/`error` ancien ⇒
  formulaire vierge.

- **Polling file-scoped pour le suivi, global uniquement pour la reprise.** Le
  endpoint file-scoped consulte le manifeste → slug EXACT + `fileCostUsd` du fichier
  déposé. Le mode global ne sert qu'à retrouver *quel* fichier reprendre
  (`pending[0]`).

- **`IngestStatus` rendu présentationnel.** Le polling déménage dans le store
  (source unique de vérité). Évite deux boucles de polling concurrentes.

- **Partie B : `useState` + lazy-init depuis `Map`, pas `useSyncExternalStore`.**
  Une clé n'a qu'un consommateur à la fois (page précédente démontée avant retour),
  donc pas besoin d'abonnement multi-consommateur. Plus simple, suffisant.

- **Filtre `sources` : garder l'URL comme source pour `?filter=`.** Le TopBar y
  pointe déjà via `<Link href="/sources?filter=needs_review">`. On ne double pas
  cette source ; on persiste seulement l'état d'UI non porté par l'URL (recherche,
  scroll).

## Hors périmètre

- **Ne PAS toucher au moteur d'ingestion serveur** (`runIngestion`,
  `writeIngestState`, verrou) : il fonctionne et persiste déjà. Seul l'ajout du mode
  « global » à `/api/ingest-status` est autorisé côté serveur.
- **Ne PAS toucher au chat** (`chat-stream-store.ts`, `ChatWindow.tsx`, cookie
  `active-conversation`) : déjà résolu, on le prend comme modèle.
- **Pas de keep-alive d'arbres React entiers** (impossible proprement en App Router
  sans hacks fragiles). On persiste l'état qui compte, pas le DOM.
- **Reprise multi-fichiers d'un lot après reload : limitée** — `seedFromServer`
  suit `pending[0]`. Le cas courant (dépôt unitaire) est exact ; un lot multi-fichiers
  rouvert après reload n'affichera que le premier. Acceptable (dépôt unitaire = norme).
- **Pas de nouvelle dépendance npm.** Aucune lib de state / cache.
- **Pas de persistance disque de l'état d'UI de Partie B** (sauf `sessionStorage`
  optionnel explicitement noté) : la survie à la navigation SPA suffit à la demande.

## Todo

- [x] **A1 — Mode global de `/api/ingest-status`.** Modifier
  `web/app/api/ingest-status/route.ts` : sans `?file=`, renvoyer l'état moteur global
  (`readIngestState()` + `lockHeld()`) au format `{ state, pending, slug, costUsd, perFile, error }`.
  *Vérif :* pendant une ingestion, `curl 'http://localhost:3000/api/ingest-status'`
  (sans `file`) renvoie `state:'processing'` + `pending` non vide ; hors ingestion,
  `state:'idle'` ou `'done'`. `curl '...?file=<nom>'` garde son comportement d'avant.

- [x] **A2 — Store `web/lib/ingest-view-store.ts`.** Créer le store module-level
  (`IngestView`, `subscribe`, `getView`, `startTracking`, `clear`, `seedFromServer`,
  polling module-level file-scoped). *Vérif :* `cd web && npm run build` compile
  (typecheck OK) ; relire pour confirmer que `getView` renvoie une référence stable
  entre deux emit sans changement.

- [x] **A3 — Brancher `UploadForm` + `IngestStatus` sur le store.** Supprimer le
  `useState` `submittedFile`, lire via `useSyncExternalStore`, `startTracking` au
  POST OK, `seedFromServer` au montage, `clear` dans `reset`. Rendre `IngestStatus`
  présentationnel. *Vérif end-to-end (OBLIGATOIRE, cf. règle « prouver, pas
  affirmer ») :* `cd web && npm run dev` → déposer un fichier ; dès « Ingestion en
  cours… », cliquer `/chat` ou `/wiki` dans la barre latérale, revenir sur `/upload`
  → **le suivi est toujours là et se met à jour** jusqu'à « Ingéré dans le wiki +
  coût » avec lien « Voir la fiche ». Fournir la trace (logs/DOM observé).

- [x] **A4 — Non-régression + reprise après reload.** *Vérif :* (a) après un run
  terminé, ouvrir `/upload` à neuf → **formulaire vierge** (pas de vieux « done ») ;
  (b) relancer un dépôt, puis **recharger complètement** la page pendant l'ingestion
  → le suivi se reconstruit depuis le serveur.

- [x] **B1 — Hook `web/lib/use-persistent-state.ts`.** Créer `usePersistentState`
  (Map module + lazy-init). *Vérif :* `npm run build` OK.

- [x] **B2 — Hook `web/lib/use-scroll-restoration.ts`.** Créer `useScrollRestoration`
  (Map module, restore au montage / save au démontage). *Vérif :* `npm run build` OK.

- [x] **B3 — Appliquer à `sources` (page de référence).** Persister recherche +
  scroll via les deux hooks (garder l'URL pour `?filter=`). *Vérif end-to-end :* sur
  `/sources`, taper une recherche + défiler, aller sur `/graph`, revenir → recherche
  ET position de défilement conservées. Fournir la trace.

- [x] **B4 — Appliquer aux pages restantes.** Répéter le motif B3 sur `wiki`,
  `graph`, `explore`, `entities`, `themes`, et le scroll de `upload`
  (`UploadView`). Ouvrir chaque page pour recenser l'état d'UI utile. *Vérif :* pour
  au moins DEUX de ces pages, démontrer la conservation filtre/scroll au
  va-et-vient (même protocole que B3).

- [x] **Vérif finale.** `cd web && npm run build` passe (typecheck inclus). Relire
  `tasks/lessons.md` et y noter tout pattern appris. Confirmer qu'aucun fichier hors
  `web/` (moteur, chat) n'a été modifié à part `web/app/api/ingest-status/route.ts`.

---

## Bilan

### Ce qui a été fait (conforme au plan)
- **A1** `web/app/api/ingest-status/route.ts` : mode global (sans `?file=`) ajouté,
  file-scoped inchangé.
- **A2** `web/lib/ingest-view-store.ts` : store module-level (état + polling), calqué
  sur `chat-stream-store.ts`.
- **A3** `UploadForm` branché via `useSyncExternalStore` + `seedFromServer` au montage +
  `startTracking` au POST + `clear` dans `reset` ; `IngestStatus` rendu présentationnel
  (props, plus de polling propre) + branche d'affichage d'erreur ajoutée.
- **B1** `web/lib/use-persistent-state.ts`, **B2** `web/lib/use-scroll-restoration.ts` créés.
- **B4** scroll restauré sur `sources`, `wiki`, `explore`, `entities`, `themes`, `upload`.

### Écarts au plan (et pourquoi)
1. **La reconnaissance a révélé qu'aucune page B n'a de recherche/filtre/onglet en
   `useState` à persister** : filtres `sources` = URL ; `wiki`/`explore`/`entities`/`themes`
   = grilles serveur sans état d'UI. Le seul état « où j'étais » réel et universel est le
   **scroll**. Donc B3/B4 = restauration de scroll (+ le cas filtres ci-dessous).
   Conséquence : **`usePersistentState` (B1) n'a aucun consommateur dans ce lot** — créé
   comme utilitaire documenté (livrable de la spec), prêt à l'emploi, mais non utilisé.
2. **Filtres `sources` : décision produit d'Arthur (opt. 2) → les faire survivre à la
   barre latérale.** Implémenté PROPREMENT sans 2ᵉ source de vérité : nouveau store
   `web/lib/sources-nav-store.ts` mémorise la dernière query ; `Sidebar` reconstruit le
   lien `/sources?<query>` (l'URL reste la source unique). Écart au plan qui disait
   « garder l'URL, ne pas doubler » — le doublage a été évité, mais `Sidebar.tsx` (hors
   liste initiale) a dû être touché.
3. **`graph` non traité** : canvas sans conteneur défilable + zoom/pan dans la librairie
   (pas en `useState`) → rien de fiable à restaurer. La spec le conditionnait déjà à
   « si l'état est en useState ».
4. **`useScrollRestoration` : version robuste ≠ croquis naïf de la spec.** Le croquis
   « set au montage / save au démontage » NE MARCHE PAS ici (données async + le navigateur
   remet `scrollTop` à 0 au démontage). Deux corrections trouvées **par pilotage Chrome
   réel** : (a) ré-appliquer la position tant que le contenu grandit (fenêtre rAF bornée) ;
   (b) **ne jamais sauver au cleanup** (écrasait la bonne valeur par 0) — l'écouteur
   `scroll` tient le store à jour en continu. Bug (a)+(b) constaté puis re-testé OK.
5. **`IngestStatus`** a perdu ses props `file`/`onResolved` (inutilisées) et gagné un
   affichage d'état `error`.

### Preuves (aucune affirmation non démontrée)
- `tsc --noEmit` sur le vrai `web/` : **exit 0**.
- Test store (fetch simulé, vrai module) : **8/8** — machine à états, arrêt du polling,
  référence stable, et garde « seed n'adopte qu'un run `processing` ».
- Test du handler `/api/ingest-status` (vrai code, `DATA_ROOT` isolé) : **5/5**.
- Pilotage **Chrome headless (CDP)** sur instance ISOLÉE (copie de `web/`, port 3005,
  données isolées, état d'ingestion simulé — zéro coût LLM, serveur concurrent intact) :
  **6/6** — scroll `sources` 150 px et `wiki` 120 px restaurés ; filtres `sources` rejoués
  par la sidebar ; suivi d'upload conservé au va-et-vient SPA ; reconstruit après
  rechargement complet ; `done` périmé NON ré-affiché.
- **Build Next** validé via la copie isolée (mêmes sources). Le `next build` du vrai
  `web/` a été **délibérément évité** : une autre session Claude faisait tourner un
  `npm run start` sur `.next`/port 3000 — rebuilder l'aurait corrompu (cf. lessons.md).

### Fichiers touchés (périmètre)
Créés : `web/lib/ingest-view-store.ts`, `web/lib/use-persistent-state.ts`,
`web/lib/use-scroll-restoration.ts`, `web/lib/sources-nav-store.ts`.
Modifiés : `web/app/api/ingest-status/route.ts`, `web/components/upload/{UploadForm,IngestStatus,UploadView}.tsx`,
`web/components/Sidebar.tsx`, `web/components/sources/SourceList.tsx`,
`web/components/wiki/TopicGrid.tsx`, `web/components/explore/ExploreView.tsx`,
`web/components/entities/EntitiesView.tsx`, `web/components/themes/ThemesView.tsx`.
Aucun fichier moteur (`ingest-local`, `wiki-mutate`) ni chat modifié. NB : `EntitiesView`
et `ThemesView` sont aussi touchés par une session concurrente (feature suppression) —
mes ajouts (scroll) ont fusionné proprement, à isoler au commit.
