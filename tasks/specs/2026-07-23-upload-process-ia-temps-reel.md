# Process temps réel « ce que fait l'IA » pendant l'upload/ingestion

## Contexte

Demande d'origine (Arthur, verbatim) : « au même titre que le chat, j'aimerais
mettre un process [de réflexion] dans l'upload de nouveaux documents. Il faut
qu'on puisse savoir ce que l'IA fait, donc avec exactement le même UI que le
chat, mais j'ai envie qu'il y ait ça qui soit mis en œuvre pour que ce soit plus
agréable et ergonomique à voir. »

Clarification validée : Arthur veut **les deux** — (1) la **checklist d'étapes**
(spinner → coche) du chat + (2) une **animation « en cours d'écriture » en
direct** sur l'étape longue (l'appel IA qui rédige la fiche).

**Problème actuel.** Quand on dépose un document sur `/upload`, l'ingestion (agent
IA qui écrit la fiche wiki) tourne en arrière-plan et l'UI n'affiche qu'un
**spinner + phrase statique** (`components/upload/IngestStatus.tsx`, état
`processing` = `<Loader2 animate-spin/> Ingestion en cours…`). C'est opaque.

**Ce qui existe déjà (le patron à répliquer).** Le **chat** possède exactement le
mécanisme voulu :
- Transport = **NDJSON sur `ReadableStream`** (PAS SSE), `Content-Type:
  application/x-ndjson`, un objet JSON par ligne `\n`. Événements
  `{type:'delta'|'step'|'done'|'error'}`.
- Route serveur : `web/app/api/chat/route.ts` — `ReadableStream`, helper
  `send(obj)` = `controller.enqueue(encoder.encode(JSON.stringify(obj)+'\n'))`,
  tolérant à la déconnexion (`clientGone`). Appelle
  `runWikiAgent({callbacks:{onText,onStep}})`.
- Boucle agent : `web/lib/chat-agent.ts` — `runWikiAgent`, et surtout
  `consumeTurn()` (~L156-212) qui lit les events bruts du stream Anthropic
  (`content_block_delta` → `text_delta`/`input_json_delta`, `message_delta`,
  `message_stop`) et **tolère le « Premature close » de LiteLLM**.
- Store client : `web/lib/chat-stream-store.ts` — store **module-level singleton**
  consommé via `useSyncExternalStore`, **survit à la navigation** (le reader vit
  dans le module). Lit le NDJSON ligne par ligne (`reader.read()`, ~L397-452),
  route `delta`/`step`/`done`/`error`, maintient `ConvState.steps: ChatStep[]`.
  Le `status` (`reading`→`done`) est **dérivé CÔTÉ CLIENT** (~L417-428) :
  l'arrivée de l'étape N+1 marque N `done` ; le 1er delta / le `done` marque
  toutes les étapes `done`. Effet machine-à-écrire par `drain` piloté à `rAF`.
- UI réutilisable : `web/components/chat/StepTrail.tsx` — composant **présentationnel
  pur** : `steps: ChatStep[]` → checklist, spinner `Loader2` tant que
  `status !== 'done'`, pastille sombre `Check` sinon. Rendu live dans
  `web/components/chat/ChatWindow.tsx` (~L158-162 : bulle grise
  `rounded-2xl bg-gray-100 px-4 py-2.5`), et replié sous la réponse dans
  `web/components/chat/Message.tsx`.
- Type : `web/types/index.ts` — `ChatStep {label, tool, path, status?:'reading'|'done'}`.

**État actuel côté upload/ingestion.**
- UI : `web/components/upload/UploadForm.tsx` (central, ~470 l),
  `web/components/upload/IngestStatus.tsx` (présentationnel, 4 états),
  `web/components/upload/UploadView.tsx`.
- Route upload : `web/app/api/upload/route.ts` — POST multipart, écrit source +
  sidecar dans `raw/`, puis **`void runIngestion().catch(...)` en FIRE-AND-FORGET**
  (~L238), renvoie `{ok, file}`. Ne streame rien.
- Suivi : polling `GET /api/ingest-status?file=<name>` toutes les 5 s
  (`web/app/api/ingest-status/route.ts`). État grossier persisté disque
  `.data/ingest-state.json`.
- Store client : `web/lib/ingest-view-store.ts` — store module-level +
  `useSyncExternalStore`, `IngestView {file, state, slug, cost, error}`,
  `pollOnce` toutes les 5 s, `seedFromServer()` au remontage. Survit navigation
  ET reload. **Aucun champ pour des étapes.** Le moteur d'ingestion est **GLOBAL
  et UNIQUE** (un seul run à la fois, verrou fichier) → un état unique suffit.
- Moteur : `web/lib/ingest-local.ts` — `runIngestion()` (~L714) : `acquireLock()`,
  `writeIngestState({status:'running'})`, boucle `for (const file of pending)`
  (~L746-783), séquentiellement par fichier : (1) `extractSourceText(file)`
  (extraction locale ; PDF via `unpdf`, gratuit), (2) `readRawSidecar` /
  `parseSidecar` / `resolveDeclarations`, (3) `buildUserMessage`, (4)
  `callModel(system, user)` (~L393 : **`.messages.create().withResponse()`
  NON-STREAMÉ**, UN appel par ressource, PAS d'agent, PAS de tool calls, PAS de
  thinking ; via `getAnthropic()`/`getModel()` de `web/lib/claude.ts` — même client
  que le chat, `baseURL` = gateway LiteLLM), (5) `ingestOne(...)` (projection
  déterministe en `FileOp[]`), (6) `applyFileOps(ops)`. Après la boucle :
  `runWikiVerify()`, calcul coût, `writeIngestState({status:'done'|'error'})`. Une
  fonction locale `log(s)` (~L727) append dans `.data/ingest.log` des lignes déjà
  structurées par phase. Le coût gateway est lu de l'en-tête HTTP
  `x-litellm-response-cost` (récupéré via `.withResponse()`, ~L407).

**Contrainte de coût (cardinale).** Le refactor récent (commit `d236a23`) a fait
chuter le coût de **6,64 $ → ~0,12 $/ressource**. Deux garde-fous absolus dans
cette feature :
1. **Aucun extended thinking** (`thinking`) — tokens facturés en plus.
2. Le passage de `callModel` en streaming **ne change pas** le coût (mêmes tokens),
   MAIS il faut **re-capter** l'en-tête `x-litellm-response-cost` + le `usage`,
   sinon le calcul du coût casse.

---

## Plan

### 0. Ce qui rend ce cas différent du chat (et dicte l'architecture)

Le chat tient son stream ouvert pendant toute la requête `POST /api/chat` :
l'émetteur EST le `controller` du `ReadableStream`, aucun buffer serveur. Ici,
`runIngestion()` est lancé en **fire-and-forget** par `POST /api/upload`
(`web/app/api/upload/route.ts:238`) et n'est rattaché à **aucune** requête. Le
client n'ouvrira le stream qu'**après** le retour du POST, donc **après** que
plusieurs phases ont déjà été émises. D'où la seule pièce nouvelle indispensable :
un **émetteur module-level qui bufferise les events du run courant et les rejoue
à la (re)connexion**. Tout le reste est un copier-adapter du chat.

Le moteur (`runIngestion`, le lock `acquireLock`/`lockHeld`, l'état disque
`writeIngestState`) est **déjà** un singleton module-level dans le process serveur
long-vécu (Electron / `next start`). L'émetteur suit exactement la même hypothèse
de process unique.

### 1. `web/types/index.ts` — base de type partagée

Extraire une base minimale pour que `StepTrail` accepte les deux formes :
```ts
export interface TrailStep { label: string; status?: 'reading' | 'done'; detail?: string; }
export interface ChatStep extends TrailStep { tool: string; path: string; }   // remplace la déf. actuelle (~L84-92)
export interface IngestStep extends TrailStep { phase?: string; file?: string; }
```
`detail?` (nouveau) porte le texte d'animation de l'étape IA (ex. compteur de
caractères). `ChatStep`/`IngestStep` satisfont tous deux `TrailStep`.

### 2. `web/lib/ingest-events.ts` — NOUVEAU : émetteur singleton (mémoire)

Importé par le producteur (`ingest-local.ts`) et les consommateurs
(`ingest-stream/route.ts`). Aucune écriture disque, purement éphémère.
```ts
// Event de fil, aligné sur le style du chat. Le `status` reading|done N'EST PAS
// transmis : il est dérivé CÔTÉ CLIENT (comme ChatStep).
export type IngestEvent =
  | { type: 'step'; id: number; phase: string; label: string; file?: string }
  | { type: 'delta'; text: string }        // animation de l'étape IA (jamais rendu en markdown)
  | { type: 'done' }
  | { type: 'error'; error: string };

interface RunLog { runId: number; events: IngestEvent[]; terminal: boolean; }

let current: RunLog | null = null;
const subscribers = new Set<(e: IngestEvent) => void>();
let runSeq = 0;
let stepSeq = 0;
```
API :
- `startRun(): void` — appelé **après** `acquireLock()` réussi. Remplace `current`
  par un `RunLog` neuf (`events:[]`, `terminal:false`), `runSeq += 1`,
  `stepSeq = 0`. **Ne notifie pas** les anciens subscribers (déjà terminés/fermés).
- `emitStep(phase, label, file?): void` — `stepSeq += 1` ; `{type:'step',
  id:stepSeq, phase, label, file}` ; `current.events.push(e)` ; broadcast à tous
  les subscribers (try/catch par subscriber).
- `emitDelta(text): void` — push + broadcast.
- `emitDone()` / `emitError(error)` — push l'event terminal, `current.terminal =
  true`, broadcast. On **conserve** `current` (avec `terminal:true`) pour qu'une
  connexion tardive rejoue la liste complète + le terminal.
- `snapshot(): { runId, events: IngestEvent[], terminal } | null` — renvoie
  `current` (copie superficielle du tableau `events`) ou `null`.
- `subscribe(fn): () => void` — `subscribers.add(fn)` ; renvoie un unsubscribe.

**Atomicité rejeu → live (piège clé)** : la route fait, **sans aucun `await`
entre les deux**, `snapshot()` puis `subscribe()`. JS mono-thread + `emitStep`
appelé seulement aux points `await` de `runIngestion` → aucun event ne peut
s'intercaler → ni trou ni doublon. **Multi-subscribers** : `Set` → plusieurs
onglets/GET OK. **Nettoyage** : pas de reset explicite en fin de run (buffer gardé
pour reconnect tardif) ; écrasé au `startRun()` suivant. **Fin de process** :
buffer perdu au redémarrage complet — sans gravité, l'état terminal reste lu du
disque par le polling.

### 3. `web/lib/ingest-local.ts` — points d'émission (site `/api/upload` INCHANGÉ)

Ne **pas** changer la signature de `runIngestion()` : il importe `ingest-events`
et émet directement, comme il utilise déjà `acquireLock`/`writeIngestState`.
Le site d'appel `void runIngestion().catch(...)` dans
`web/app/api/upload/route.ts:238` reste **inchangé**.

1. Après `if (!acquireLock()) return;` (~L715) et l'entrée du `try` : appeler
   `events.startRun()` **juste avant** `writeIngestState({status:'running'})`
   (~L723). Cas `pending.length === 0` (~L719-722) : après
   `writeIngestState({status:'done'})`, `events.emitDone()` puis `return`.
2. **Doubler `log()` sans casser le fichier** : garder le `const log` existant
   (~L727-733) intact. Ajouter un helper :
   ```ts
   const phase = (phaseKey: string, label: string, forFile?: string) => {
     log(`[phase] ${forFile ?? ''} ${phaseKey}: ${label}`); // trace debug fichier
     events.emitStep(phaseKey, label, forFile);              // fil temps réel UI
   };
   ```
   Les `log()` techniques (tokens/coût, ~L759-777) restent **fichier-only**.
3. Points d'émission dans `for (const file of pending)` (~L746-783). `multi =
   pending.length > 1` ; label préfixé du basename si `multi`, sinon nu :
   - **avant** `extractSourceText(file)` (~L748) → `phase('extract', 'Extraction du texte', file)`
   - **avant** `callModel(system, user)` (~L755) → `phase('analyze', "Analyse et rédaction par l'IA", file)`
   - **avant** `ingestOne(...)` (~L765) → `phase('project', 'Structuration de la fiche', file)`
   - **avant** `applyFileOps(ops)` (~L774) → `phase('write', 'Écriture dans le wiki', file)`
   - dans le `catch` par-fichier (~L778) → **pas** d'`emitStep` (pas d'event
     error par-fichier dans le contrat) : `log()` seulement.
4. Phase run-level **avant** `runWikiVerify()` (~L785) →
   `phase('verify', 'Mise à jour des index et vérification')` (sans `file`).
5. Terminaux alignés sur les branches existantes :
   - `perFile.length === 0` → `writeIngestState({status:'error'})` puis
     `events.emitError(errors.join(' | ') || 'Aucune ressource ingérée')`.
   - succès → `writeIngestState({status:'done'})` puis `events.emitDone()`.
   - `catch` global (~L808) → après `writeIngestState({status:'error'})`,
     `events.emitError(e?.message ?? 'erreur inconnue')`.

**Scoping multi-fichiers** : chaque event porte `file`. Liste séquentielle
`extract(f1)…write(f1) extract(f2)…write(f2) verify`. Si `multi`, préfixer le
label du basename (ex. `"napkin.pdf — Analyse et rédaction par l'IA"`). Mono-fichier
= cas courant (4 steps + verify).

### 4. `web/lib/ingest-local.ts` — `callModel` en STREAMING (animation « écriture »)

`callModel` (~L393) passe de `.messages.create(...).withResponse()` à un appel
**streaming** tout en **préservant le coût** :
- `getAnthropic().messages.create({ ...mêmes params (model, max_tokens:16000,
  system avec cache_control:{type:'ephemeral'}, messages)..., stream: true })
  .withResponse()` → renvoie `{ data: Stream<RawMessageStreamEvent>, response }`.
  **`response.headers` reste disponible** → on y relit `x-litellm-response-cost`
  (⚠ non-régression coût, garde-fou n°1).
- Itérer `data` en réutilisant la logique de `web/lib/chat-agent.ts`
  `consumeTurn` (~L156-212) : accumuler `rawText` depuis
  `content_block_delta`/`text_delta` ; capter `usage` (`message_start` → input
  tokens ; `message_delta` → output tokens ; `message_stop`) ; tolérer le
  « Premature close » LiteLLM. À chaque delta de texte : `events.emitDelta(delta)`.
- **Aucun `thinking`.** `parseGeneration(rawText)` en aval est **identique**.
- `callModel` peut prendre un petit callback `onDelta` (ou émettre directement)
  pour rester testable. Retourne toujours `{ markdown, detectedNew, usage,
  gatewayCost, rawText }` (même `GenResult`, valeurs re-captées du stream).

### 5. `web/app/api/ingest-stream/route.ts` — NOUVEAU (miroir de `app/api/chat/route.ts`)

```ts
import { NextRequest } from 'next/server';
import { snapshot, subscribe, type IngestEvent } from '@/lib/ingest-events';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let unsub = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let gone = false;
      const send = (o: IngestEvent) => {
        if (gone) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(o) + '\n')); }
        catch { gone = true; }
      };
      const close = () => { unsub(); try { controller.close(); } catch {} };

      const snap = snapshot();
      if (!snap) { close(); return; }              // aucun run : le client retombe sur le polling
      for (const e of snap.events) send(e);         // REJEU du buffer
      if (snap.terminal) { close(); return; }       // run déjà fini : rejeu + fermeture

      // Pas d'await entre snapshot() et subscribe() → pas de trou/doublon.
      unsub = subscribe((e) => {
        send(e);
        if (e.type === 'done' || e.type === 'error') close();
      });

      req.signal.addEventListener('abort', () => { gone = true; close(); });
    },
    cancel() { unsub(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
```
`unsub` au scope de `GET` (partagé `start`/`cancel`). Déconnexion client → `abort`
+ `enqueue` qui throw → `gone` + `close` (miroir du `clientGone` du chat). Fin de
stream sur terminal. Aucune écriture disque, aucun appel modèle.

### 6. `web/lib/ingest-view-store.ts` — champ `steps` + connexion au flux

Garder **tout le polling terminal intact** (autorité de `state/slug/cost/error`).
1. `IngestView` += `steps: IngestStep[]`.
2. Module-level : `let streamCtl: AbortController | null = null;` (garde
   anti-double-connexion).
3. **Préserver `steps` à travers le polling** : dans les 3 `setView(...)` de
   `pollOnce` (~L75, L84, L88) et dans `startTracking` (~L108), ajouter
   `steps: view?.steps ?? []` (sinon chaque poll écrase la liste).
4. `connectStream()` (nouveau) : si `streamCtl` présent → return. Sinon
   `streamCtl = new AbortController()`, `fetch('/api/ingest-stream',
   { signal, cache:'no-store' })`, puis boucle reader NDJSON **copiée de
   `chat-stream-store.ts:397-452`** mais **sans drain/typewriter** :
   - `step` → `setView({ ...view, steps: [...view.steps.map(s=>({...s,
     status:'done'})), { label, phase, file, status:'reading' }] })` (identique
     à la logique chat ~L422-428).
   - `delta` → **ne touche pas** l'array `steps` structurellement : met à jour le
     `detail` de la **dernière** step (`reading`) avec un compteur de caractères
     cumulés (ex. `detail: "L'IA rédige… 1 240 caractères"`). Chunky (LiteLLM
     coalesce) → peu d'updates, pas de throttle nécessaire.
   - `done`/`error` → `setView({ ...view, steps: view.steps.map(s=>({...s,
     status:'done', detail: undefined})) })`, fermer le reader, **et déclencher un
     `pollOnce()` immédiat** (bascule l'état terminal sans attendre le tick 5 s).
   - `finally` → `streamCtl = null`.
5. `disconnectStream()` (nouveau) : `streamCtl?.abort(); streamCtl = null;`.
6. Câblage :
   - `startTracking(file)` (~L103) : après `setView(pending)`, appeler `pollOnce()`
     **et** `connectStream()`.
   - `seedFromServer()` (~L125) : branche `d.state === 'processing'` appelle déjà
     `startTracking(...)` → un reload en cours de run rejoue le buffer (même process).
   - `pollOnce` : quand `state` devient `ingested`/`error`, appeler
     `disconnectStream()` (le polling reste l'autorité qui arrête le fil).
   - `clear()` (~L113) : `disconnectStream()` + `setView(null)`.

Le lissage machine-à-écrire, `drains`, `AbortController` de Stop du chat ne sont
**pas** repris.

### 7. `web/components/chat/StepTrail.tsx` — prop élargie + `detail`

Type de prop `{ steps }: { steps: TrailStep[] }` (au lieu de `ChatStep[]`).
Comportement inchangé ; ajouter le rendu optionnel de `s.detail` en style muté
(ex. `text-gray-400`) après le label, avec un point animé, pour l'étape en cours.
**Réutilisé tel quel** par le chat (il ne passe pas de `detail`).

### 8. `web/components/upload/IngestStatus.tsx` — rendu identique au chat

Ajouter `steps?: IngestStep[]` aux props. Quand `state === 'processing'` **et**
`steps?.length` : rendre `<StepTrail steps={steps}/>` dans **la même bulle grise
arrondie que le chat** (copie de `ChatWindow.tsx:159-162`) :
```tsx
{state === 'processing' && steps && steps.length > 0 ? (
  <div className="rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400">
    <StepTrail steps={steps} />
  </div>
) : (
  /* … spinner Loader2 + "Ingestion en cours…" existant (fallback avant 1re step) … */
)}
```
Le paragraphe explicatif `/raw` peut rester sous la bulle. Branches
`ingested`/`error` inchangées.

### 9. `web/components/upload/UploadForm.tsx` — passer les steps

Dans le rendu `<IngestStatus .../>` (~L244-249) : ajouter `steps={ingest.steps}`.
Rien d'autre.

### Contrat NDJSON `/api/ingest-stream` (résumé)

`{type:'step', id, phase, label, file?}` · `{type:'delta', text}` (animation,
jamais markdown) · `{type:'done'}` · `{type:'error', error}`. Le `status`
(`reading`/`done`) est **dérivé côté client**, exactement comme `ChatStep`.

### Ordre d'implémentation

1 (types) → 2 (émetteur) → 3+4 (émissions + streaming `callModel`) → 5 (route) →
6 (store) → 7+8+9 (UI) → 10 (tests).

---

## Décisions

- **Réutiliser le mécanisme streaming du chat (NDJSON + `StepTrail`)** plutôt que
  de réinventer. _Alternative écartée :_ enrichir `.data/ingest-state.json` avec un
  tableau de steps et poller plus vite. _Raison :_ le polling reste saccadé
  (cadence 5 s trop grossière, pas de token-level) et ne donne pas le rendu
  « identique au chat » demandé.
- **Étapes = phases déterministes du pipeline** (extract → analyze → project →
  write → verify), PAS un faux « thinking ». _Alternative écartée :_ activer
  l'extended thinking pour streamer un vrai raisonnement. _Raison :_ tokens de
  thinking facturés en plus → contredit frontalement le refactor coût
  (6,64 $→0,12 $). Choix honnête (les phases affichées sont réelles) et gratuit.
- **Émetteur serveur en mémoire + rejeu du buffer via nouvel endpoint NDJSON**
  (`/api/ingest-stream`), miroir du chat. _Raison :_ l'ingestion est
  fire-and-forget, détachée de toute requête ; le client se connecte APRÈS le
  début → sans buffer + rejeu, on raterait les premières phases. C'est la SEULE
  pièce nouvelle indispensable.
- **Approche additive faible risque** : garder le polling `/api/ingest-status`
  intact comme **autorité de l'état terminal** (`state/slug/cost/error`, lecture
  de `wiki/_ingested.json`), et ajouter le stream **uniquement** pour peupler
  `steps`. _Alternative écartée :_ tout migrer sur le stream (terminal compris).
  _Raison :_ réécrirait la logique terminale déjà solide (`seedFromServer`,
  adoption d'un run au remontage, `_ingested.json`), risque de régression, viole
  « ne toucher que le nécessaire ».
- **Ne PAS changer la signature de `runIngestion()` ni le site d'appel
  `/api/upload`** : émettre directement via le singleton `ingest-events`.
  _Alternative écartée :_ injecter des callbacks `{onStep, onText}` dans
  `runIngestion`. _Raison :_ plus intrusif ; le singleton est cohérent avec
  l'usage existant de `acquireLock`/`writeIngestState`, et les tests s'abonnent
  via `subscribe()`.
- **Animation « en cours d'écriture » sur l'étape IA (choix explicite d'Arthur :
  « les deux »)** → `callModel` passe en streaming. On **n'affiche PAS** le
  markdown brut de la fiche. _Alternatives écartées :_ (a) simple spinner sans
  animation — rejeté par Arthur qui veut le rendu vivant ; (b) afficher le texte
  brut généré — rejeté car il contient des balises techniques `<resource>…` +
  un bloc JSON `<detected-new>…` illisibles. _Retenu :_ indicateur vivant =
  compteur de caractères générés (`detail` sur la step), honnête et léger.
- **Le streaming ne change pas le coût**, mais impose de **re-capter**
  `x-litellm-response-cost` (via `.withResponse()` sur l'appel `stream:true`) et
  le `usage` (depuis `message_start`/`message_delta`). _Raison :_ garde-fou de
  non-régression du coût (~0,12 $/ressource). C'est la vérification n°1.
- **`status` dérivé côté client** (pas transmis sur le fil), exactement comme
  `ChatStep`. _Raison :_ phases séquentielles → l'arrivée de la step N+1 prouve
  que N est finie ; réutilise la logique éprouvée du chat.

---

## Hors périmètre

- **Afficher le texte brut** de la fiche en cours de génération (balises
  `<resource>` / JSON `<detected-new>` illisibles) : on n'affiche qu'un
  indicateur d'écriture (compteur de caractères), jamais le markdown.
- **Extended thinking** (`thinking`) : exclu (coût en tokens).
- **Persistance disque des steps** : éphémères par conception (perdues au
  redémarrage complet du process ; l'état terminal reste lu du disque).
- **Modifier le déclenchement fire-and-forget de `/api/upload`** ou la logique de
  **polling terminal** (`ingest-status`, `_ingested.json`, `seedFromServer`).
- **Reprise fine après redémarrage complet du serveur** pendant un run : on
  retombe sur le polling grossier « Ingestion en cours… » (dégradation acceptée).

---

## Todo

- [x] **1. Types** (`web/types/index.ts`) : ajouter `TrailStep {label, status?,
  detail?}`, faire `ChatStep extends TrailStep` (garder `tool`, `path`), ajouter
  `IngestStep extends TrailStep {phase?, file?}`.
  _Vérif :_ `cd web && npx tsc --noEmit` passe (aucune régression de type sur
  l'usage existant de `ChatStep` dans le chat). ✅ `TSC_EXIT=0`.

- [x] **2. Émetteur** (`web/lib/ingest-events.ts`, NOUVEAU) : implémenter
  `IngestEvent`, `startRun`, `emitStep`, `emitDelta`, `emitDone`, `emitError`,
  `snapshot`, `subscribe` selon §2.
  _Vérif :_ test unitaire (voir todo 10) : après `startRun()` + `emitStep`×3,
  `snapshot().events` rejoue les 3 dans l'ordre ; un subscriber ajouté après reçoit
  les emits suivants ; `emitDone()` met `terminal:true` ; `startRun()` remet
  `stepSeq`/buffer à zéro. ✅ `ingest-events.test.ts` (a)–(f) verts.

- [x] **3. Émissions dans `runIngestion`** (`web/lib/ingest-local.ts`) :
  `startRun()` après lock ; helper `phase()` doublant `log()`+`emitStep()` ;
  émissions aux 4 phases (extract/analyze/project/write) + `verify` ; terminaux
  `emitDone`/`emitError` sur les 3 branches. Site `/api/upload` **inchangé**.
  _Vérif :_ lancer un run réel (todo « app réelle ») et `curl -N
  http://localhost:3000/api/ingest-stream` pendant → voir le NDJSON
  `step(extract)…step(analyze)…step(verify)…done` dans l'ordre.
  → **Code posé** (émissions + `startRun` en tête de `try` — cf. Bilan) ; contrat
  NDJSON prouvé par `ingest-events.test.ts` + `ingest-view-store.test.ts`.
  **Curl live à faire par Arthur** (choix : test manuel).

- [x] **4. `callModel` en streaming** (`web/lib/ingest-local.ts`) : passer à
  `.messages.create({...,stream:true}).withResponse()`, itérer `data` (logique
  `consumeTurn`), accumuler `rawText` + `usage`, relire
  `x-litellm-response-cost` sur `response.headers`, `emitDelta` par delta. Aucun
  `thinking`. `GenResult` inchangé.
  _Vérif CRITIQUE (non-régression coût) :_ ingérer un même document sur cette
  branche et sur `main`, comparer le coût affiché (`~0,12 $`, écart nul à
  quelques % près) ; confirmer que `.data/ingest.log` montre bien un coût gateway
  non nul (l'en-tête a été relu). Vérifier qu'aucun paramètre `thinking` n'est
  passé.
  → **Loop extraite en `consumeModelStream` (exportée) + testée** : re-capture
  `usage` (input via `message_start`, output final via `message_delta`), deltas
  relayés, repli `estimateCost = 0,12 $`, tolérance « Premature close ». Aucun
  `thinking` passé (vérifié dans le code). **Non-régression coût neutralisée par
  construction** : config actuelle = Anthropic **direct** (`baseUrl` vide) → l'en-tête
  `x-litellm-response-cost` n'a jamais existé sur cette route → coût = estimation
  par tokens, identique avant/après (mêmes tokens). Comparaison live avec `main`
  non nécessaire ici ; à re-confirmer le jour où une gateway LiteLLM est branchée.

- [x] **5. Route stream** (`web/app/api/ingest-stream/route.ts`, NOUVEAU) : GET
  miroir chat (rejeu `snapshot()` + `subscribe`, fermeture sur terminal/abort,
  headers NDJSON), selon §5.
  _Vérif :_ `curl -N http://localhost:3000/api/ingest-stream` **hors run** → ferme
  immédiatement (aucun run). Pendant un run → rejeu des events déjà passés puis
  live jusqu'à `done`. Ouvrir 2 `curl` simultanés → les deux reçoivent le flux.
  → **Route posée + enregistrée au build** (`ƒ /api/ingest-stream`). **Curl live à
  faire par Arthur** (choix : test manuel).

- [x] **6. Store** (`web/lib/ingest-view-store.ts`) : `IngestView.steps`,
  `connectStream`/`disconnectStream` (reader NDJSON sans drain), dérivation
  `reading→done`, `delta`→`detail` (compteur de caractères), `pollOnce()` immédiat
  au terminal, préservation de `steps` dans tous les `setView` du polling,
  câblage `startTracking`/`seedFromServer`/`clear`/`pollOnce`.
  _Vérif :_ test store style `chat-stream-store.test.ts` (FakeBody NDJSON) : une
  séquence `step,step,done` produit `steps` avec les 2 en `done` ; un `delta`
  met à jour `detail` de la dernière step `reading`. ✅ `ingest-view-store.test.ts`
  (2 tests) verts.

- [x] **7. `StepTrail`** (`web/components/chat/StepTrail.tsx`) : prop `TrailStep[]`,
  rendu optionnel de `detail` en style muté + point animé.
  _Vérif :_ `npx tsc --noEmit` passe ; le chat rend toujours ses steps
  identiquement (todo « app réelle », onglet chat) ; une step avec `detail` affiche
  le texte muté. ✅ `TSC_EXIT=0` (le chat passe toujours `ChatStep`, compatible
  `TrailStep`). Rendu chat inchangé (aucun `detail` côté chat). Visuel à confirmer
  par Arthur.

- [x] **8. `IngestStatus`** (`web/components/upload/IngestStatus.tsx`) : prop
  `steps?`, rendu `<StepTrail/>` dans la bulle grise du chat quand `processing` +
  steps, fallback spinner sinon.
  _Vérif :_ visuellement identique à la bulle de chargement du chat (mêmes classes
  `rounded-2xl bg-gray-100 px-4 py-2.5`). ✅ Mêmes classes copiées de
  `ChatWindow.tsx:159-162` (vérifié dans le code). Visuel à confirmer par Arthur.

- [x] **9. `UploadForm`** (`web/components/upload/UploadForm.tsx`) : passer
  `steps={ingest.steps}` à `<IngestStatus/>`.
  _Vérif :_ dépôt d'un document → la checklist apparaît et se remplit en direct.
  → **Prop câblée** (`steps={ingest.steps}`, `TSC_EXIT=0`). Observation live du
  dépôt à faire par Arthur (choix : test manuel).

- [x] **10. Tests unitaires** (`web/lib/__tests__/ingest-events.test.ts`, NOUVEAU,
  style `chat-stream-store.test.ts` avec `node:test`) : (a) rejeu ordonné après
  `startRun`+`emitStep`×N ; (b) subscriber tardif reçoit le rejeu complet via
  `snapshot` ; (c) `emitDone`→`terminal:true`, `snapshot` rejoue + terminal ;
  (d) `startRun()` remet `stepSeq`/buffer à zéro ; (e) multi-subscribers reçoivent
  tous le broadcast.
  _Vérif :_ `cd web && npm test` — la nouvelle suite passe, aucune régression des
  suites existantes (`chat-stream-store.test.ts`, `chat-agent.test.ts`). ✅ 12
  nouveaux tests verts (7 émetteur + 2 store + 3 `consumeModelStream`) ; chat-stream/
  chat-agent inchangés. Seul échec : `wiki-tools` (compteur 13 figé vs 16 fiches
  réelles) — **pré-existant, data-dépendant, hors diff** (cf. Bilan).

- [~] **11. Vérification end-to-end (app réelle)** : `cd web && npm run dev` (ou
  l'app Electron). Sur `/upload`, déposer un vrai PDF. **Observer** la checklist
  se dérouler : `Extraction du texte` (coche rapide) → `Analyse et rédaction par
  l'IA` **avec compteur de caractères qui monte en direct** → `Structuration de la
  fiche` → `Écriture dans le wiki` → `Mise à jour des index et vérification` →
  toutes cochées → bloc succès + coût. Puis tester **survie navigation** (quitter
  `/upload` et revenir pendant le run → steps toujours là) et **survie reload**
  (hard reload pendant le run → rejeu). Capturer une preuve (logs/curl/description
  du comportement observé) — ne pas déclarer « terminé » sans cette preuve.
  → **DÉLÉGUÉ À ARTHUR** (décision explicite : « je veux tester la fonctionnalité
  moi-même »). Le comportement est prouvé au niveau logique (12 tests) + build de
  prod vert ; l'observation visuelle live et le run payant réel restent à sa main.

---

## Bilan

**Fait (conforme au plan).**
- **§1 Types** : `TrailStep` (base) + `ChatStep extends TrailStep` + `IngestStep`
  dans `web/types/index.ts`. Typecheck vert, chat inchangé.
- **§2 Émetteur** `web/lib/ingest-events.ts` (NOUVEAU) : singleton mémoire, buffer +
  rejeu + broadcast multi-subscriber, tolérant aux subscribers défaillants. 7 tests.
- **§3 Émissions** dans `runIngestion` : helper `phase()` (double `log()` +
  `emitStep()`), 4 phases + `verify`, terminaux `emitDone`/`emitError` sur les 3
  branches. Site `/api/upload` **strictement inchangé**.
- **§4 `callModel` en streaming** : `stream:true` + `.withResponse()` ; boucle de
  consommation extraite en **`consumeModelStream` (exportée, testée)** ; re-capture
  `usage`, deltas relayés, aucun `thinking`. 3 tests dédiés.
- **§5 Route** `app/api/ingest-stream/route.ts` (NOUVEAU) : miroir chat, rejeu +
  subscribe atomiques, fermeture terminal/abort. Enregistrée au build.
- **§6 Store** : `steps` + `connectStream`/`disconnectStream`, dérivation
  reading→done, `delta`→compteur `detail`, préservation de `steps` à chaque poll,
  `pollOnce()` immédiat au terminal. 2 tests (FakeBody NDJSON).
- **§7–§9 UI** : `StepTrail` élargi à `TrailStep[]` + rendu `detail` (point animé,
  texte muté) ; `IngestStatus` rend la checklist dans la **bulle grise identique au
  chat** ; `UploadForm` passe `steps={ingest.steps}`.
- **§10 Tests** : `ingest-events.test.ts` (7) + `ingest-view-store.test.ts` (2) +
  3 tests `consumeModelStream` dans `ingest-local.test.ts` = **12 verts**.
- **Preuves globales** : `tsc --noEmit` = 0 ; `next build` de prod **vert** (route
  `ƒ /api/ingest-stream` enregistrée, `/upload` 9,6 kB) dans une instance isolée.

**Déviations vs plan (assumées, documentées).**
1. **`startRun()` placé en TÊTE du `try`** (avant `detectPending`), pas juste avant
   `writeIngestState({status:'running'})` comme écrit au §3.1. _Pourquoi :_ pour que
   TOUTE branche terminale — y compris `pending.length===0` et le `catch` global —
   puisse émettre son `emitDone`/`emitError` sur un run réellement ouvert (sinon
   ils seraient des no-op). Satisfait la seule contrainte dure du §2 (« après
   `acquireLock()` »). Aucun impact sur l'atomicité rejeu→live.
2. **Extraction de `consumeModelStream`** (exportée) hors de `callModel`. _Pourquoi :_
   le §4 autorise explicitement « rester testable » ; l'extraction permet de prouver
   la re-capture `usage`/deltas/`Premature close` **sans appel payant**. `callModel`
   garde la lecture de l'en-tête coût (qui, elle, exige la vraie `response`).
3. **Rendu de `detail` gardé sur `!done`** dans `StepTrail` (le §7 dit « pour l'étape
   en cours ») : un compteur ne s'affiche que sur l'étape active, jamais sur une
   étape déjà cochée — cohérent avec l'intention.
4. **Test store en plus** (`ingest-view-store.test.ts`) : le §10 ne listait que
   `ingest-events.test.ts`, mais le **critère de vérif du §6** réclamait un test store
   (FakeBody) — je l'ai donc ajouté pour couvrir ce critère.

**Non-régression coût (le risque n°1 annoncé).** Neutralisée **par construction** sur
la config actuelle : `ai-settings.baseUrl` est **vide** → Anthropic **direct**, pas
la gateway LiteLLM → l'en-tête `x-litellm-response-cost` n'a **jamais** existé sur
cette route → le coût est **déjà** l'estimation par tokens, avant comme après. Le
streaming ne change pas les tokens ⇒ coût identique. À re-mesurer le jour où une
gateway LiteLLM sera rebranchée (le code relit bien l'en-tête si présent).

**Hors de mon diff (à laisser à Arthur).** `wiki-tools.test.ts` échoue (« 13 fiches »
figées vs **16** réelles) : compteur codé en dur cassé par des ressources ajoutées
par une **autre session Claude** (`raw/note*.txt`, `wiki/resources/finops-*.md`, …,
non suivies). Mon diff ne touche ni `list_wiki_folder` ni `wiki/resources/`. Conforme
à `lessons.md` (21/07) : je n'impute pas ce test à mon code et je ne le « corrige »
pas dans mon commit.

**Reste à faire par Arthur.** Observation visuelle en app réelle (checklist qui se
remplit + compteur qui monte + survie navigation/reload) et, s'il le souhaite, un run
payant réel. Aucun code en attente.

---

Fichier créé : `tasks/specs/2026-07-23-upload-process-ia-temps-reel.md`

Nouvelle session : `/implement @tasks/specs/2026-07-23-upload-process-ia-temps-reel.md`
