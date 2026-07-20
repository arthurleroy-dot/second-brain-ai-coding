# Refonte UX du chat — streaming fluide, bouton Stop, barre ergonomique, checklist ressources

> Spec autosuffisante destinée à une session d'implémentation vierge. Tout le
> contexte technique nécessaire est ci-dessous ; ne rien redemander.

## Contexte

### Demande d'origine de l'utilisateur (non-développeur)
Améliorer l'expérience du chat sur quatre points :
1. La réponse se génère « par blocs » (un mot, puis une phrase) — effet buggé.
   Vouloir un défilé régulier **token après token**, comme Claude/ChatGPT.
2. Pouvoir **interrompre** une génération en cours via un bouton Stop (carré,
   type ChatGPT) qui remplace le bouton Envoyer pendant la génération.
3. **Barre de saisie plus ergonomique**, style Apple/ChatGPT.
4. **Ressources examinées** affichées joliment de haut en bas, avec les fichiers
   explorés qui se **cochent** une fois lus (façon checklist).

### État actuel du code (établi par exploration — fiable)

**Pipeline de streaming.** Format **NDJSON** (pas SSE), un objet JSON par ligne.
- `web/app/api/chat/route.ts` renvoie un `ReadableStream<Uint8Array>` ;
  `Content-Type: application/x-ndjson`. Émetteur `send(obj)` (~l.73-80) protégé
  par try/catch avec flag `clientGone`. Types d'événements :
  `{type:'delta',text}` (~l.147), `{type:'step',label,tool,path}` (~l.151),
  `{type:'done',text,sources}` (~l.131), `{type:'error',error}` (~l.165).
  `emittableLength` (~l.191-204) retient ≤7 derniers caractères pour ne pas
  laisser fuiter le marqueur `SOURCES:`. `maxDuration=300`, `deadlineMs=Date.now()+280_000`.
  Le message **user** est persisté AVANT le stream ; l'assistant seulement via
  `finalize()`. Le serveur **continue volontairement** de consommer le flux
  Anthropic même si le client part (commentaire explicite ~l.67-71) et persiste
  la réponse **complète**. `finalize()` fait `if (!rawText.trim()) return false`
  → sait déjà persister un texte partiel.
- `web/lib/chat-agent.ts` : boucle agentique manuelle (SDK Anthropic 0.39,
  `client.messages.stream({model,max_tokens:8000,system,messages,tools})`, ~l.252-258).
  `MAX_ITERATIONS=15` (l.113). 2 tools : `read_wiki_page({path})`,
  `list_wiki_folder({path})` (l.14-40). `onStep({label,tool,path})` émis **AVANT**
  `await executeWikiTool` (~l.309 puis 310) — un seul événement par outil, au
  lancement, pas d'état « terminé ». `stepLabel` (~l.211-215) = `Exploration du
  dossier <path||racine>` ou `Lecture de <path>`. `consumeTurn` (~l.153-209)
  reconstruit le tour via l'itérateur d'événements bruts (jamais `finalMessage()`,
  car LiteLLM ferme souvent en « premature close » APRÈS `message_stop`). La boucle
  `for (attempt…)` re-tente le stream sur erreur en début de flux.
- `web/lib/claude.ts` : client `@anthropic-ai/sdk`, `baseURL` → proxy **LiteLLM**
  compatible Anthropic. Modèle `claude-sonnet-4-6` par défaut. **Le proxy LiteLLM
  coalesce les tokens** en fragments « taille phrase » → c'est la cause racine de
  l'effet saccadé. **Vérifié :** `messages.stream(body, options?)` accepte
  `options.signal?: AbortSignal` (SDK 0.39, `core.d.ts:204`). `NextRequest` expose
  `req.signal`.
- `web/lib/chat-stream-store.ts` : **store singleton module-level** (raison :
  faire survivre le streaming à la navigation client-side ; la boucle de lecture
  vit hors du cycle de vie du composant). `ConvState { messages, loading, streaming,
  steps }`. Maps module-level `states`, `active`, `Set listeners`. Fonctions :
  `getState(key)`, `subscribe`, `emit`, `isStreaming(key)`, `sendMessage(key,
  serverConversationId, text, filters)`, `resetEphemeralKey()`, `getEphemeralKey()`,
  `seedIfAbsent`, `hydrateFromDb`. `sendMessage` (l.120-249) : garde-fou
  `if (active.has(key)) return`, `fetch('/api/chat', {method:'POST', body})` **SANS
  signal**, boucle de lecture `reader.read()` + split `\n` (l.198-238), `delta` →
  `ensureAssistant()` + `updateAssistant(m=>({...m, content:m.content+evt.text}))`,
  `step` → append à `state.steps` (ne déclenche PAS `ensureAssistant`), `done` →
  écrit content/sources + `steps:[]`, `error` → message ⚠️ + `steps:[]`.
  `finally` (l.245-248) : `active.delete(key)` + `loading/streaming/steps` remis à
  `false/[]`. **AUCUN AbortController nulle part.** Aucun throttle / rAF / setTimeout /
  débit artificiel : la cadence brute d'arrivée est affichée telle quelle → React 18
  fusionne les setState par paquet réseau → effet « par blocs ».
- `web/components/chat/ChatWindow.tsx` : orchestrateur client, s'abonne via
  `useSyncExternalStore(subscribe, ()=>getState(storeKey), ()=>undefined)`. Dérive
  `messages/loading/streaming/steps`. `handleSend` (l.92-129) : pour conversation
  existante `void sendMessage(existing, existing, text, activeFilters)` ; pour
  éphémère, crée la conversation (`POST /api/conversations`), adopte l'uuid
  (`setAdoptedId`), `window.history.replaceState`. Passe à `InputBar`
  `disabled={loading || streaming || sending}` (l.158). Composant local
  **`StepTrail`** (l.167-185) : liste `space-y-1`, icône `Folder`/`BookOpen` par
  tool, dernière ligne `text-gray-600` sinon `text-gray-400`, **pas d'état coché**.
  Rendu inline dans la bulle de chargement (l.149-155), disparaît à la réponse.
  `useEffect` de scroll dépend de `[messages, loading, steps.length]`.
- `web/components/chat/InputBar.tsx` : props `{onSend:(text)=>void; disabled?}`.
  `<textarea rows={1} className="max-h-32 flex-1 resize-none …">` **SANS auto-resize**.
  Enter=envoie (preventDefault), Shift+Enter=newline. Bouton Send (`lucide-react`
  `Send size={16}`, `bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40`,
  `disabled={disabled || !input.trim()}`). Mic (Web Speech API, gauche), Paperclip
  `<Link href="/upload">`. Container `flex items-end gap-2 rounded-2xl border
  border-gray-300 bg-white px-3 py-2 focus-within:border-gray-400`. Reçoit un SEUL
  booléen `disabled` — ne sait pas POURQUOI il est bloqué.
- `web/components/chat/Message.tsx` : bulle. User = `bg-blue-600 text-white` à
  droite ; assistant = `bg-gray-100` à gauche via `<ReactMarkdown remarkPlugins=
  {[remarkGfm]}>{message.content}</ReactMarkdown>` (**re-parse markdown intégral à
  chaque changement de content** — point chaud perf). Chips de sources via
  `SourceChip.tsx`. **Pas de `React.memo`.**
- `web/types/index.ts` : `Source` (l.17-34 : `slug,title,type,author,date,url,
  topics,origin,file_path,source_file`), `Message {id,role,content,sources:Source[],
  created_at}` (l.61-67), `ChatStep {label,tool,path}` (l.77-83, éphémère, non
  persisté).
- `web/components/chat/RightPanel.tsx` : filtres uniquement (n'affiche PAS les steps).
- **Stack style :** Tailwind (classes inline), `lucide-react ^0.460`. `tailwind.config.ts`
  définit une seule couleur `brand` (`50:#E1F5EE`, `600:#0F6E56`). Pas de dossier
  `components/ui/`, pas de composant bouton réutilisable, pas de design-token layer.

---

## Plan

> Principe directeur : tout ce qui touche au flux vit dans le **store singleton**
> `web/lib/chat-stream-store.ts`, jamais dans un hook lié au cycle de vie du
> composant — pour préserver l'invariant « le streaming survit à la navigation ».
> Les composants restent de purs abonnés `useSyncExternalStore`.

### Objectif 1 — Lissage du streaming (effet machine à écrire)

**Fichiers :** `web/lib/chat-stream-store.ts`, `web/components/chat/Message.tsx`.

Ajouter au niveau module une `Map` de contrôleurs de drain (comme `states`/`active`) :

```ts
interface Drain {
  queue: string;                 // reçu mais pas encore affiché
  raf: number | null;
  assistantId: string;
  lastTs: number;
  finalText: string | null;      // posé sur 'done', réconcilié en fin de drain
  finalSources: Source[] | null;
}
const drains = new Map<string, Drain>();
```

Dans la boucle de lecture NDJSON de `sendMessage` :
- `delta` → `enqueueDelta(key, assistantId, evt.text)` (empile dans `queue`, démarre le rAF)
  au lieu de `updateAssistant(content + evt.text)`.
- `done` → `finishDrain(key, evt.text, evt.sources)` : pose `finalText`/`finalSources`,
  **laisse le drain finir**. `streaming` reste `true` jusqu'à file vidée.
- `error` / `catch` → `flushDrain(key)` (dumpe la file d'un coup) puis état correspondant.

Drain à cadence pilotée par le **temps écoulé** (indépendant du framerate), adaptatif :

```ts
const CPS_BASE = 90;     // vitesse « repos »
const CPS_MAX  = 1400;   // plafond anti-dump quand la file gonfle
function revealCount(queueLen, elapsedMs) {
  const cps = Math.min(CPS_MAX, Math.max(CPS_BASE, queueLen / 0.25)); // vider en ~250 ms
  return Math.max(1, Math.round((cps * elapsedMs) / 1000));
}
```

`tick(key)` révèle `n` caractères via `updateAssistant`, reprogramme un rAF tant que
`queue` non vide **ou** `finalText` non réconcilié. **Point critique :** quand file vide
ET `finalText != null`, réconcilier (`content = finalText`, `sources`, `streaming=false`,
supprimer le drain). `streaming` ne repasse à `false` **qu'à la fin du drain** — sinon le
toggle Stop→Send et la bulle de chargement basculent avant la fin de l'animation.

Adapter le `finally` de `sendMessage` : garder `active.delete(key)`, mais **ne plus forcer
`streaming=false`** quand un drain avec `finalText` tourne encore (le laisser à `tick`).
Introduire `settleDrain(key)` : si `finalText` posé → s'assurer que le rAF tourne ;
sinon (abort/erreur sans finalText) → `flushDrain` + `streaming=false`.

**Perf du re-parse markdown** (`Message.tsx` re-parse tout le markdown à chaque frame) :
- `React.memo` sur `Message`, comparateur sur `content` + `sources.length` + `steps`
  → les messages figés ne re-parsent jamais.
- Drainer à ~30 fps (accumulateur temps ≥ 32 ms) : reste fluide, moitié moins de parses.

**Garde-fous :** `typeof requestAnimationFrame !== 'undefined'` (store client-only, mais
prudence SSR) ; `resetEphemeralKey` doit **annuler/flusher** le drain de l'ancienne clé.

### Objectif 2 — Bouton Stop (abort propagé au serveur, texte partiel conservé)

**Fichiers :** `web/lib/chat-stream-store.ts`, `web/app/api/chat/route.ts`, `web/lib/chat-agent.ts`.

**Client** (`chat-stream-store.ts`) :
```ts
const controllers = new Map<string, AbortController>();
export function abortMessage(key: string) { controllers.get(key)?.abort(); }
```
Dans `sendMessage` : créer un `AbortController`, le stocker sous `key`, passer
`signal: controller.signal` au `fetch`, `controllers.delete(key)` dans le `finally`.

**Piège AbortError** : à l'abort, `reader.read()` rejette → branche `catch`. Ne **pas**
écrire « Erreur réseau ». Discriminer via le flag, pas le nom d'erreur :
```ts
} catch {
  if (controller.signal.aborted) { flushDrain(key); /* fige le partiel, n'écrit rien */ }
  else { ensureAssistant(); updateAssistant(m => ({ ...m, content: m.content || '⚠️ Erreur réseau…' })); }
}
```
Abort avant le 1er token → `ensureAssistant` jamais appelé → pas de bulle vide, la
question reste (comportement ChatGPT). Le `finally` remet `loading/streaming` à `false`.

**Serveur** (`route.ts`) : récupérer `req.signal` dans `POST(req)`, le passer à
`runWikiAgent({ ..., signal: req.signal })`. Le `catch` existant appelle déjà `finalize()`
qui **persiste le partiel** (`if (!rawText.trim()) return false`) → base = exactement le
texte affiché. Garder `clientGone` comme filet (certains proxies retardent la détection).

**Agent** (`chat-agent.ts`) : ajouter `signal?` à `runWikiAgent` et au type client ;
appeler `client.messages.stream({...}, { signal: opts.signal })`. **Ne pas re-tenter sur
abort** : en tête du `catch` de la boucle `for (attempt…)`, `if (opts.signal?.aborted) throw err;`.
Distinguer l'AbortError (avant `message_stop`) du quirk LiteLLM « premature close »
(après `message_stop`, déjà toléré). Optionnel : `if (opts.signal?.aborted) break;` en tête
de la boucle d'itérations.

**UI** : `ChatWindow` importe `abortMessage`, passe à `InputBar` `isGenerating={loading || streaming}`,
`onStop={() => abortMessage(storeKey)}`, `disabled={sending}` (voir Objectif 3).

**Garde-fou :** `resetEphemeralKey` doit aussi `controllers.get(old)?.abort()` + `delete`.

### Objectif 3 — Barre de saisie ergonomique (style Apple/ChatGPT, neutre)

**Fichier :** `web/components/chat/InputBar.tsx` (+ appel dans `ChatWindow.tsx`).

**Nouveau contrat** (la barre sait enfin *pourquoi* elle est bloquée) :
```ts
interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  isGenerating?: boolean;  // affiche Stop, bloque l'envoi
  disabled?: boolean;      // autres cas (roundtrip création conversation = `sending`)
}
```

**Auto-grow** du textarea (effet post-render sur `[input]`, borné à ~200px) :
```ts
const el = taRef.current; el.style.height = 'auto';
el.style.height = Math.min(el.scrollHeight, 200) + 'px';
```
Garder `rows={1}` (hauteur min), ajouter `overflow-y-auto`, retirer `max-h-32`.

**Toggle Send ↔ Stop** — palette **neutre** (pas de vert vif) :
- `canSend = !!input.trim() && !disabled && !isGenerating` (on peut taper pendant la
  génération mais Enter/clic n'envoient pas).
- Pendant la génération : bouton **Stop** = `bg-gray-900 text-white rounded-full` +
  icône `Square size={13} fill="currentColor"` (lucide).
- Sinon : bouton **Send** = `bg-gray-900 text-white rounded-full disabled:opacity-30`
  + icône `Send`.

**Container pilule** :
```
flex items-end gap-2 rounded-[26px] border border-gray-200 bg-white px-2.5 py-2
shadow-sm transition-shadow focus-within:border-gray-300 focus-within:shadow-md
```
Conserver mic + paperclip, passés en `rounded-full`. Factoriser les classes d'icône-bouton
dans une constante locale (`const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full …"`) — pas de nouveau fichier ni design system pour 3 boutons.

**Hors périmètre :** on **ne modifie pas** la couleur des bulles utilisateur (`bg-blue-600`
dans `Message.tsx`) — choix « neutre » = on ne touche pas la palette existante des messages.

### Objectif 4 — Checklist des ressources (se remplit, conservée repliée)

**Fichiers :** `web/types/index.ts`, `web/lib/chat-stream-store.ts`,
`web/components/chat/Message.tsx`, `web/components/chat/ChatWindow.tsx`,
nouveau `web/components/chat/StepTrail.tsx` (extrait de `ChatWindow`).

**État « en cours → coché » dérivé côté client (zéro changement serveur).** L'agent émet
`onStep` *puis* `await executeWikiTool` séquentiellement : quand l'étape N+1 arrive, la N
est terminée ; quand le 1er `delta` de texte arrive, toutes le sont. On dérive donc le
« coché » sans trafic NDJSON supplémentaire.

**Types** (`types/index.ts`) — champs optionnels pour ne pas casser le SSR/`initialMessages` :
```ts
export interface ChatStep { label: string; tool: string; path: string; status?: 'reading' | 'done'; }
export interface Message { /* … */ steps?: ChatStep[]; }  // trace transiente, non persistée
```

**Store** (`chat-stream-store.ts`) :
- Sur `step` : marquer toutes les précédentes `done`, la nouvelle `reading`.
- Dans `ensureAssistant` (1er `delta`) : passer toutes les steps `done`.
- Sur `done` : `updateAssistant(m => ({ ...m, steps: stepsAllDone }))` **puis** vider `state.steps`.

**Composant `StepTrail`** (extrait, partagé entre vue live et vue repliée) — checklist neutre :
```tsx
const done = s.status === 'done';
<span className={`flex h-4 w-4 items-center justify-center rounded-full
  ${done ? 'bg-gray-900 text-white' : 'border border-gray-300'}`}>
  {done ? <Check size={11} strokeWidth={3} /> : <Loader2 size={11} className="animate-spin text-gray-400" />}
</span>
<span className={done ? 'text-gray-500' : 'text-gray-700'}>{s.label}</span>
```
Pastille **gris foncé** + check blanc pour « lu », cercle vide + spinner discret pour
« en cours ». Icônes lucide `Check`, `Loader2`.

**Vue repliée** (`Message.tsx`, au-dessus du contenu, assistant uniquement) :
```tsx
{!isUser && message.steps?.length ? (
  <details className="group text-xs text-gray-400">
    <summary className="flex cursor-pointer list-none items-center gap-1">
      <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
      {message.steps.length} ressource{message.steps.length > 1 ? 's' : ''} consultée{message.steps.length > 1 ? 's' : ''}
    </summary>
    <div className="mt-1.5 pl-3"><StepTrail steps={message.steps} /></div>
  </details>
) : null}
```
`ChatWindow` : remplacer le `StepTrail` inline (l.167-185) par l'import ; la bulle de
chargement reste, désormais avec les coches qui se remplissent.

**Garde-fou :** le comparateur `React.memo` de `Message` (Objectif 1) **doit inclure
`message.steps`**, sinon la trace repliée ne s'affiche pas au `done`.

### Pièges transverses

- **SSR/hydratation** : store client-only, `getServerSnapshot`→`undefined`→`initialMessages` ;
  rAF/AbortController jamais en SSR ; champs `status?`/`steps?` optionnels.
- **Singleton store** : `drains` et `controllers` sont module-level comme `states` — les
  nettoyer à la complétion (fuite sinon) et étendre `resetEphemeralKey` pour `abort()` +
  annuler le drain de l'ancienne clé.
- **LiteLLM premature close** : ne pas confondre AbortError (avant `message_stop`, à
  propager sans retry) avec le quirk premature-close (après `message_stop`, déjà toléré).
- **Cohérence au reload** : garantie uniquement par l'abort **propagé serveur** (persistance
  du partiel) — vérifier que `parseResponse` tolère un texte sans ligne `SOURCES:`.
- **Timing `streaming`** : ne repasser à `false` qu'à la fin du drain (done) ; immédiatement
  sur erreur/abort (flush).

---

## Décisions

1. **Cause du saccadé = amont (LiteLLM) + batching React, pas un bug applicatif.**
   → On n'essaie pas de « corriger » le serveur ; on ajoute un **lissage client**
   (file + drain rAF). Alternative écartée : demander à LiteLLM de flusher token par
   token (non maîtrisable, hors périmètre app). Alternative écartée : throttle simple
   par intervalle fixe — moins fluide qu'un drain adaptatif piloté par le temps.

2. **Stop = abort propagé au serveur (PAS client-only).** Choisi par l'utilisateur.
   - *Client-only* (fetch aborté, serveur finit) écarté : le serveur est conçu pour
     finir et persister la réponse **complète** → au reload, base ≠ partiel affiché
     (**incohérence**) + tokens gaspillés.
   - *Abort propagé* retenu : `req.signal` → `messages.stream({signal})` coupe vraiment
     le LLM ; le `catch` de `route.ts` persiste déjà le partiel via `finalize()` →
     cohérence reload garantie.

3. **Au Stop, conserver le texte partiel** (comportement ChatGPT). Choisi par
   l'utilisateur. Alternative écartée : tout effacer et ne garder que la question.

4. **Checklist conservée repliée sous la réponse** (« N ressources consultées »,
   dépliable), en **transient non persisté** (attachée à `Message.steps` dans le
   store). Choisi par l'utilisateur. Tradeoff accepté : la trace disparaît au **hard
   reload** (seuls les chips de sources subsistent). Alternative écartée : persister
   en base — refusée (migration DB pour un gain faible). Alternative écartée : faire
   disparaître la checklist à la réponse (comportement actuel).

5. **État « coché » dérivé côté client, sans 2e événement serveur.** L'ordre
   séquentiel `onStep` → `executeWikiTool` le permet. Alternative écartée : émettre un
   event « step done » après exécution — plus précis pour le tout dernier outil mais
   complexifie le serveur pour un gain visuel nul.

6. **Palette neutre noir/gris (ChatGPT/Apple).** Choisi par l'utilisateur (« pas les
   mêmes couleurs » que la capture verte/sombre). Coches en `bg-gray-900`, bouton
   Send/Stop `bg-gray-900`. Alternatives écartées : accent vert `brand-600` unifié
   (aurait fait passer les bulles user au vert) ; garder le bleu actuel.

7. **Pas de design system introduit** : 3 boutons ne le justifient pas. Constante de
   classe locale dans `InputBar.tsx`. Alternative écartée : créer `components/ui/`.

8. **Le lissage vit dans le store, pas dans un hook.** Un hook serait détruit à la
   navigation et figerait l'animation ; le rAF module-level continue d'avancer même
   composant démonté — cohérent avec l'invariant « streaming survit à la navigation ».

## Hors périmètre

- **Persistance en base** de la checklist des ressources (trace transiente uniquement).
- **Couleur des bulles utilisateur** (`bg-blue-600` dans `Message.tsx`) : inchangée.
- **Enrichissement des libellés de steps** (afficher le titre lisible de la ressource
  au lieu du `path` brut) : nécessiterait un enrichissement serveur — non fait.
- **Fermeture des fences markdown incomplètes** pendant le streaming (```` ``` ````/`**`
  non fermés) : toléré comme ChatGPT/Claude, non traité.
- **Refonte du RightPanel / des filtres**, de l'historique, du mic ou de l'upload.
- **Introduction d'un design system / dossier `components/ui/`.**

## Todo

- [x] **1. Lissage streaming — store.** Dans `web/lib/chat-stream-store.ts` : ajouter
  `Map<string, Drain>` module-level + helpers `enqueueDelta`, `tick` (drain rAF adaptatif
  piloté par le temps, `CPS_BASE=90`/`CPS_MAX=1400`, cible ~250ms, cadence ~30fps),
  `finishDrain`, `flushDrain`, `settleDrain`, `cancelDrain`. Brancher `delta`→`enqueueDelta`,
  `done`→`finishDrain`, `error`/`catch`→`flushDrain`. `streaming` ne repasse `false` qu'en
  fin de drain. Garde `typeof requestAnimationFrame !== 'undefined'`.
  **Vérif :** `npm run dev`, poser une question ; le texte défile caractère par caractère
  de façon régulière (plus « par blocs »), réponse courte ET longue restent fluides ;
  comparer visuellement à `git stash` (avant/après).

- [x] **2. Lissage streaming — perf Message.** Dans `web/components/chat/Message.tsx` :
  ajouter `React.memo` avec comparateur sur `content` + `sources.length` + `steps`.
  **Vérif :** pendant un streaming long, ouvrir React DevTools Profiler / vérifier
  qu'aucun message figé antérieur ne re-render ; l'app ne rame pas.

- [x] **3. Nettoyage cycle de vie du drain.** Étendre `resetEphemeralKey()` pour
  `cancelDrain(old)` (+ voir todo 5 pour l'abort). S'assurer que `drains.delete(key)` est
  fait en fin de réconciliation.
  **Vérif :** lancer un streaming, cliquer « Nouvelle discussion » en cours → aucune
  animation résiduelle, pas de fuite (le drain de l'ancienne clé est stoppé).

- [x] **4. Abort — client.** Dans `chat-stream-store.ts` : `Map<string, AbortController>`
  module-level, `export function abortMessage(key)`, créer/stocker le controller dans
  `sendMessage`, passer `signal` au `fetch`, `controllers.delete` dans `finally`. `catch`
  discrimine `controller.signal.aborted` → `flushDrain` sans écrire de message d'erreur.
  Étendre `resetEphemeralKey` : `controllers.get(old)?.abort()` + `delete`.
  **Vérif :** (après todo 6-7) voir ci-dessous ; à ce stade, vérifier au moins que
  `fetch` reçoit bien un `signal` (pas de régression d'envoi normal).

- [x] **5. Abort — serveur route.** Dans `web/app/api/chat/route.ts` : passer `req.signal`
  à `runWikiAgent({ ..., signal: req.signal })`. Garder `clientGone`. Confirmer que le
  `catch`/`finalize()` persiste le partiel (et que `parseResponse` tolère l'absence de
  ligne `SOURCES:`).
  **Vérif :** intégrée à la todo 7.

- [x] **6. Abort — agent.** Dans `web/lib/chat-agent.ts` : ajouter `signal?: AbortSignal`
  à `runWikiAgent` et au type client ; `client.messages.stream({...}, { signal: opts.signal })`.
  En tête du `catch` de la boucle `for(attempt…)` : `if (opts.signal?.aborted) throw err;`
  (pas de retry). Ne pas confondre avec le quirk premature-close (après `message_stop`).
  Optionnel : `if (opts.signal?.aborted) break;` en tête de la boucle d'itérations.
  **Vérif :** intégrée à la todo 7.

- [x] **7. Bouton Stop — UI + bout-en-bout.** `InputBar` : nouveau contrat
  `{onSend, onStop?, isGenerating?, disabled?}`, toggle Send↔Stop (`Square` lucide,
  `bg-gray-900`). `ChatWindow` : `isGenerating={loading||streaming}`,
  `onStop={()=>abortMessage(storeKey)}`, `disabled={sending}`.
  **Vérif :** lancer une réponse longue, cliquer Stop → génération stoppée
  immédiatement, texte partiel conservé, **aucun** « ⚠️ Erreur réseau ». **Recharger la
  page** → le même texte partiel est présent (preuve d'arrêt+persistance serveur, pas de
  réponse complète). Tester Stop AVANT le 1er token → seule la question reste.

- [x] **8. Barre ergonomique.** `web/components/chat/InputBar.tsx` : auto-grow (ref +
  effet sur `[input]`, borne 200px, `overflow-y-auto`, retrait `max-h-32`), container
  pilule `rounded-[26px] … shadow-sm focus-within:shadow-md`, mic/paperclip en
  `rounded-full`, constante `iconBtn` locale. `canSend = input.trim() && !disabled &&
  !isGenerating`.
  **Vérif :** taper plusieurs lignes → la barre grandit puis plafonne avec scroll interne ;
  Enter envoie, Shift+Enter saute une ligne ; frappe possible pendant la génération sans
  envoi accidentel ; le bouton bascule bien Envoyer↔Stop.

- [x] **9. Checklist — types + store.** `web/types/index.ts` : `ChatStep.status?:'reading'|'done'`,
  `Message.steps?: ChatStep[]`. `chat-stream-store.ts` : sur `step` marquer les
  précédentes `done` + nouvelle `reading` ; dans `ensureAssistant` passer toutes `done` ;
  sur `done` attacher `steps` (tous `done`) au message puis vider `state.steps`.
  **Vérif :** `tsc`/build passe ; en instrumentant, les steps ont bien un `status` qui évolue.

- [x] **10. Checklist — composant + vue repliée.** Extraire `StepTrail` dans
  `web/components/chat/StepTrail.tsx` (pastille `bg-gray-900`+`Check` si `done`, cercle
  vide+`Loader2` si `reading`). `ChatWindow` importe `StepTrail` (retirer le local l.167-185).
  `Message.tsx` : `<details>` « N ressources consultées » repliable au-dessus du contenu
  assistant. Vérifier que le comparateur `React.memo` (todo 2) inclut `steps`.
  **Vérif :** poser une question qui explore plusieurs fichiers → étapes avec spinner
  puis coches qui se remplissent de haut en bas ; après la réponse, un « N ressources
  consultées » repliable subsiste sous le message et redéplie la checklist cochée.

- [x] **11. Non-régression globale.** `npm run lint` + `npm run build` (ou `tsc --noEmit`)
  sans erreur. Navigation entre conversations PENDANT un streaming (l'invariant « survit à
  la navigation » tient). « Nouvelle discussion » pendant un streaming (drain + controller
  de l'ancienne clé bien annulés). Mode dégradé Supabase absent (chat éphémère) inchangé.
  **Vérif :** commandes exécutées sans erreur + comportements démontrés à l'écran.

---

## Bilan

### Réalisé (les 4 objectifs, conformes au plan)

1. **Lissage** : file + drain rAF module-level dans `chat-stream-store.ts`
   (`CPS_BASE=90`, `CPS_MAX=1400`, cible ~250 ms, accumulateur ~30 fps),
   réconciliation au texte canonique en fin de drain, `streaming` maintenu à
   `true` jusqu'à la fin de l'animation. `React.memo` sur `Message` (comparateur
   `id` + `content` + `sources.length` + `steps`).
2. **Stop** : `AbortController` par clé + `abortMessage()` côté client,
   `signal` propagé `fetch` → `req.signal` → `runWikiAgent` →
   `messages.stream(…, {signal})` ; pas de retry sur abort ; `finalize()`
   persiste le partiel ; catch client discriminé par `controller.signal.aborted`
   (flush du partiel, jamais de « ⚠️ Erreur réseau »).
3. **Barre** : contrat `{onSend, onStop?, isGenerating?, disabled?}`, auto-grow
   borné à 200 px, container pilule `rounded-[26px]` + `shadow-sm`, toggle
   Send↔Stop (`Square` plein, `bg-gray-900`), frappe libre pendant la
   génération sans envoi possible.
4. **Checklist** : `ChatStep.status?: 'reading'|'done'` dérivé client
   (step N+1 ⇒ N done ; 1er delta ⇒ tout done), `StepTrail.tsx` extrait
   (spinner → pastille cochée), trace attachée à `Message.steps` au `done` et
   conservée repliée (`<details>` « N ressources consultées »).

### Preuves exécutées

- **Tests : 62/62 verts** (`npm test`), dont 8 nouveaux :
  - store (6) : révélation progressive d'un paquet de 300 chars (40 puis 74
    chars affichés aux 2 premiers ticks, jamais d'un bloc), `streaming` encore
    `true` après la fin du fetch et `false` en fin de drain, réconciliation
    exacte ; Stop en plein flux (partiel conservé, zéro ⚠️) ; Stop avant le 1er
    token (pas de bulle assistant) ; fin de flux sans `done` (flush) ;
    checklist `reading`→`done`→attachée au message ; « Nouvelle discussion »
    en plein flux (abort + purge, aucune entrée orpheline recréée).
  - agent (2) : signal transmis au SDK et **aucune** retentative sur abort
    (même flux mort à la racine) ; signal déjà aborté ⇒ zéro appel API.
- **Bout en bout réel** (dev server + LiteLLM + Supabase) : coupure de la
  connexion après 317 chars reçus → log serveur « Request was aborted », POST
  clos en 11 s, base = user + assistant **partiel** (385 chars, coupé en pleine
  section, sources `[]` — `parseResponse` tolère l'absence de `SOURCES:`).
  Puis requête complète sans interruption : steps + deltas + `done` avec texte
  propre et source hydratée (non-régression).
- `tsc --noEmit` et `npm run build` sans erreur.

### Écarts au plan (mineurs, assumés)

- `finishDrain(key, assistantId, …)` prend aussi l'`assistantId` : nécessaire
  pour réconcilier quand un `done` arrive sans aucun delta préalable.
- Garde anti-fuite supplémentaire : `flushDrain`/`finally` ne recréent jamais
  une entrée `states` purgée par `resetEphemeralKey` (guard `states.has(key)`).
- `hydrateFromDb` ignore aussi une clé dont le drain anime encore la fin de
  réponse (le fetch peut se terminer avant l'animation).
- `npm run lint` : ESLint n'a **jamais été configuré** dans ce repo (`next
  lint` ouvre un prompt interactif de setup) — hors périmètre ; remplacé par
  `tsc --noEmit` + `next build`, l'alternative prévue par la todo 11.
- Au Stop, la base peut contenir quelques tokens de plus que l'écran au moment
  du clic (latence réseau entre production LLM et réception) — inévitable et
  identique au comportement ChatGPT ; l'écran au rechargement montre le texte
  persisté.

### Non vérifiable dans cette session (pas de navigateur)

Le rendu visuel (fluidité perçue, pilule/auto-grow, coches animées, React
DevTools Profiler) reste à valider à l'œil — le serveur de dev tourne sur
http://localhost:3000 (instance unique, `.next` reconstruit) pour essai
immédiat. La logique sous-jacente de chacun de ces comportements est, elle,
couverte par les tests ci-dessus.
