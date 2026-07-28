# Fluidité de l'apparition du texte en streaming (chat)

## Contexte

Demande d'origine de l'utilisateur : « améliorer la fluidité de l'apparition du
texte quand il y a une réponse de chat ; là il y a toujours une impression de
bug, des bouts de phrases, etc. Je veux quelque chose de bien plus progressif. »

L'audit du pipeline de streaming (serveur → store client → rendu) a identifié
**trois causes** de l'impression de « bug / saccadé », par ordre d'impact :

1. **🔴 Cause dominante — markdown ré-analysé « à moitié écrit ».**
   [web/components/chat/Message.tsx](../../web/components/chat/Message.tsx) repasse
   **tout le texte accumulé** dans `ReactMarkdown` à chaque image (~30 fps) alors
   que le markdown est incomplet. La syntaxe apparaît crue puis « claque » en
   forme quand elle se referme : `**gras` montre ses étoiles puis les perd d'un
   coup ; `- ` montre le tiret puis devient une puce ; `#` change la taille du
   bloc ; un tableau reste cassé puis se réorganise brutalement. Ces sauts de
   mise en page = l'« impression de bug ». Ce n'est pas la vitesse, c'est
   l'**instabilité du rendu partiel**.

2. **🟠 Cadence d'affichage irrégulière (à-coups).** Le lisseur
   [web/lib/chat-stream-store.ts](../../web/lib/chat-stream-store.ts) révèle à
   `CPS_BASE = 90` c/s au repos mais accélère jusqu'à `CPS_MAX = 1400` c/s quand
   la file gonfle. Comme Claude génère probablement plus vite que 90 c/s
   (hypothèse ~150-250 c/s, **à mesurer**), la file grossit presque tout le temps
   et le lisseur passe le plus clair de son temps en mode rattrapage accéléré :
   il dumpe des paquets (jusqu'à ~45 caractères sur une seule image). Résultat :
   *lent… BURST… lent… BURST* = saccadé.

3. **🟡 Aucun fondu + auto-scroll instantané.** Zéro transition sur le texte
   (chaque paquet apparaît en coupure sèche) ; l'auto-scroll
   ([ChatWindow.tsx:70](../../web/components/chat/ChatWindow.tsx#L70)) saute au bas
   de manière instantanée à chaque image, ce qui, combiné aux sauts de hauteur du
   markdown (cause n°1), ajoute des à-coups verticaux.

**Périmètre validé par l'utilisateur : les trois corrections (A + B + C).**

### Rappel du pipeline actuel (pour l'agent qui n'a pas vu la conversation)

```
Claude (via gateway LiteLLM)  →  route serveur          →  store client            →  ReactMarkdown
   tokens regroupés en           web/app/api/chat/route.ts  web/lib/chat-stream-store.ts  web/components/chat/Message.tsx
   fragments "taille phrase"      relaie les deltas bruts    "machine à écrire"           re-parse TOUT le
   (cf. commentaire store L137)   (event {type:'delta'})     drain char par char (rAF)     markdown à chaque image
```

- La gateway **regroupe déjà** les tokens en fragments « taille phrase » (asserté
  au commentaire [chat-stream-store.ts L133-142](../../web/lib/chat-stream-store.ts#L133)).
  On ne peut pas changer cet amont : tout le lissage est côté client.
- Le store `chat-stream-store.ts` maintient un **drain** (file + `requestAnimationFrame`)
  qui révèle le texte caractère par caractère à cadence pilotée par le TEMPS
  écoulé. Il vit au niveau module (survit au démontage de `ChatWindow`).
- À la fin (`event {type:'done'}`), `finishDrain` finit d'animer la file puis
  **réconcilie** le message avec le texte canonique du serveur (bloc `SOURCES:`
  retiré, sources hydratées) et met `streaming = false`. Ce « snap final » existe
  déjà — on s'appuie dessus.

## Plan

Contenu intégral du plan validé, en trois volets A / B / C.

### A. Rendu stable pendant l'écriture — LE CŒUR (règle la cause n°1)

Pendant le streaming, découper le message en cours en **deux zones** :

```
┌─ Préfixe engagé (blocs TERMINÉS) ─────────┐
│  Selon **McKinsey**, le FinOps repose     │  → rendu en markdown, STABLE
│  sur trois piliers :                      │     (ne change qu'à chaque bloc fini)
│  • visibilité des coûts                   │
├─ Bloc en cours ───────────────────────────┤
│  Le deuxième pilier concerne l'allocati|  │  → texte SIMPLE qui défile,
└───────────────────────────────────────────┘     même typographie, zéro claquement
```

- **Frontière = dernier saut de ligne double `\n\n`** (= fin d'un bloc markdown).
  Garde-fou : si on est à l'intérieur d'un **bloc de code non refermé**
  (```` ``` ```` ou `~~~`), on n'engage rien à partir de la ligne d'ouverture du
  fence (tout le bloc de code streame en texte brut jusqu'à sa fermeture).
- Dès qu'un bloc se termine (un `\n\n` est révélé par le drain), il « monte » dans
  la zone markdown et se formate **une seule fois** — plus 30 fois/seconde.
- À la fin (`done`), tout bascule en markdown complet du texte canonique (déjà le
  cas via `finishDrain` → `streaming = false`).
- Bonus perf : `ReactMarkdown` ne re-parse plus qu'au changement de bloc.

#### A.1 — Fonction pure de découpe (nouveau fichier, testable)

Créer `web/lib/streaming-markdown.ts` :

```ts
export interface StreamSplit {
  committed: string; // blocs terminés → ReactMarkdown
  active: string;    // bloc en cours → texte brut
}

/**
 * Découpe le texte d'un message EN COURS de streaming en un préfixe « engagé »
 * (blocs markdown terminés, rendu stable) et un bloc « actif » (en cours
 * d'écriture, rendu en texte brut pour éviter les claquements de syntaxe).
 *
 * Règles :
 * 1. Si on est à l'intérieur d'un bloc de code non refermé (nombre IMPAIR de
 *    lignes-fence ``` ou ~~~), committed = tout ce qui précède la ligne
 *    d'ouverture de ce fence ; active = du fence à la fin.
 * 2. Sinon, committed = tout jusqu'au dernier `\n\n` inclus ; active = le reste
 *    (bloc en cours). Aucun `\n\n` → committed = '', active = tout.
 */
export function splitStreamingMarkdown(content: string): StreamSplit {
  // 1. Détecter un fence de code ouvert.
  const lines = content.split('\n');
  let fenceOpen = false;
  let fenceLineStartOffset = 0; // offset (en caractères) du début de la ligne d'ouverture
  let offset = 0;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fenceOpen) {
        fenceOpen = true;
        fenceLineStartOffset = offset;
      } else {
        fenceOpen = false;
      }
    }
    offset += line.length + 1; // +1 pour le '\n' retiré par split
  }
  if (fenceOpen) {
    return {
      committed: content.slice(0, fenceLineStartOffset),
      active: content.slice(fenceLineStartOffset),
    };
  }

  // 2. Dernier séparateur de bloc.
  const idx = content.lastIndexOf('\n\n');
  if (idx === -1) return { committed: '', active: content };
  return {
    committed: content.slice(0, idx + 2),
    active: content.slice(idx + 2),
  };
}
```

#### A.2 — Rendu dans Message.tsx

- `Message` reçoit une nouvelle prop `isStreaming?: boolean`.
- Quand `isStreaming === true` ET `role === 'assistant'` : rendre
  `splitStreamingMarkdown(message.content)` → `committed` via un sous-composant
  markdown **mémoïsé** (ne re-parse que si `committed` change) + `active` en
  texte brut (`whitespace-pre-wrap`) avec la MÊME typographie que les paragraphes
  markdown (le conteneur porte déjà `text-sm leading-relaxed`).
- Sinon (message figé, ou utilisateur) : rendu actuel inchangé (ReactMarkdown sur
  tout le contenu).
- Extraire le bloc `components={{ ... }}` de ReactMarkdown dans une constante
  partagée pour ne pas le dupliquer entre le rendu figé et le rendu `committed`.

Sous-composant mémoïsé (dans Message.tsx ou fichier voisin) :

```tsx
const CommittedMarkdown = memo(function CommittedMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});
// memo compare `text` (string) par valeur → pas de re-parse tant que le préfixe
// engagé ne grandit pas (donc ~1 re-parse par bloc terminé, pas par caractère).
```

Mettre à jour le **comparateur `memo` de `Message`** (actuellement
[Message.tsx L122-129](../../web/components/chat/Message.tsx#L122)) pour inclure
`prev.isStreaming === next.isStreaming` — sinon le passage streaming→figé ne
re-render pas et on ne bascule pas sur le markdown complet final.

Attention espacement : `committed` se termine par `\n\n`, donc un espace de
paragraphe est attendu entre la zone `committed` et la zone `active`. Envelopper
les deux dans un conteneur et laisser les marges normales opérer ; vérifier
visuellement qu'il n'y a pas de double-gap ni de collage.

#### A.3 — Câblage du flag dans ChatWindow.tsx

Le message en cours d'écriture est TOUJOURS le dernier de la liste tant que
`streaming === true` (le message assistant est ajouté par `ensureAssistant` puis
alimenté ; les étapes sont affichées séparément sous la liste). Donc dans
[ChatWindow.tsx L163-165](../../web/components/chat/ChatWindow.tsx#L163) :

```tsx
const streamingId =
  streaming && messages.length > 0 && messages[messages.length - 1].role === 'assistant'
    ? messages[messages.length - 1].id
    : null;
// ...
{messages.map((m) => (
  <Message key={m.id} message={m} isStreaming={m.id === streamingId} />
))}
```

### B. Cadence quasi constante (règle la cause n°2)

Fichier : [web/lib/chat-stream-store.ts](../../web/lib/chat-stream-store.ts).

**Constantes actuelles** (L155-157) :
```ts
const CPS_BASE = 90;    // vitesse repos (c/s)
const CPS_MAX = 1400;   // plafond anti-dump
const FRAME_MS = 32;    // ~30 fps
```
**Formule actuelle** (`revealCount`, L167-170) :
```ts
const cps = Math.min(CPS_MAX, Math.max(CPS_BASE, queueLen / 0.25)); // vider la file en ~250ms
return Math.max(1, Math.round((cps * elapsedMs) / 1000));
```

Objectif : viser une vitesse **régulière** au lieu d'une base lente qui rattrape
par à-coups. Deux temps.

#### B.1 — MESURER d'abord (instrumentation temporaire)

Ajouter un log temporaire dans le store pour connaître le vrai débit d'arrivée
des deltas côté client. Ex. dans `enqueueDelta`, cumuler `totalChars` et le temps
depuis le premier delta, et logger le cps moyen à la fin (dans `finishDrain`) :
`console.info('[stream] arrival cps=', Math.round(totalChars / elapsedSec), 'deltas=', n, 'avgDeltaLen=', ...)`.
Lancer l'app, poser 2-3 vraies questions produisant une réponse longue, relever
les chiffres dans la console du navigateur. **Retirer l'instrumentation ensuite.**

#### B.2 — Retendre les constantes (valeurs à confirmer par B.1)

Hypothèse de départ (à ajuster selon la mesure) :
```ts
const CPS_BASE = 190;   // ≈ débit moyen mesuré : la file reste quasi vide → vitesse ~constante
const CPS_MAX = 380;    // ~2× base : un burst ne peut plus dumper >~6 c/image (380*0.016)
const FRAME_MS = 16;    // ~60 fps : incréments plus petits et plus fluides
```
Et adoucir la fenêtre de rattrapage :
```ts
const cps = Math.min(CPS_MAX, Math.max(CPS_BASE, queueLen / 0.6)); // vider en ~600ms, accélération douce
```

Justification `FRAME_MS = 16` : avec le découpage A, le tick ne re-parse plus le
markdown (`committed` mémoïsé, inchangé la plupart des ticks) ; seul le bloc
`active` (texte brut, coût négligeable) se re-render. Passer à 60 fps est donc
abordable et rend l'incrément par image ~2× plus petit → plus lisse.

Régler `CPS_BASE` **au niveau (ou légèrement au-dessus)** du débit mesuré : si la
base ≥ production, la file reste vide → le drain tourne à sa vitesse de croisière
constante au lieu d'osciller. Le « snap final » (`finishDrain`) rattrape de toute
façon tout reliquat à la fin, donc un `CPS_MAX` modéré (qui pourrait « prendre du
retard » sur un gros burst) est sans risque.

### C. Fondu léger + scroll doux (règle la cause n°3)

#### C.1 — Fondu d'apparition sur le bloc actif

Un léger fondu d'opacité (0→1 sur ~150 ms) sur le texte **nouvellement révélé**,
uniquement dans la zone `active` (texte brut — là où l'œil suit l'écriture ; on
ne touche PAS aux blocs markdown déjà formatés, où le fondu est coûteux car
ReactMarkdown régénère ses éléments).

Approche recommandée (locale au rendu, sans toucher au modèle de données du
store) : dans le composant qui rend `active`, mémoriser via un `useRef` la
longueur d'`active` au render précédent ; les caractères au-delà = le « nouveau »
morceau de cette image. Rendre :
```tsx
<span>{active.slice(0, prevLenRef.current)}</span>
<span key={active.length} className="stream-fade-in">{active.slice(prevLenRef.current)}</span>
```
Le `key={active.length}` remonte le span du nouveau morceau à chaque image → son
animation CSS se rejoue → fondu continu au niveau de la « tête d'écriture ».
Mettre à jour `prevLenRef.current = active.length` après le render. Remettre à 0
quand `active` rétrécit (un bloc vient de « monter » dans `committed`).

CSS (globals.css) :
```css
@keyframes stream-fade-in { from { opacity: 0; } to { opacity: 1; } }
.stream-fade-in { animation: stream-fade-in 150ms ease-out; }
```

**Repli si ça lutte avec React (flicker) :** appliquer un simple
`mask-image: linear-gradient(...)` sur les ~1.5em de fin du bloc `active` (fondu
positionnel permanent à la tête d'écriture) — moins précis mais sans état. À
décider à l'implémentation selon le rendu observé.

#### C.2 — Scroll doux

L'auto-scroll actuel ([ChatWindow.tsx L67-71](../../web/components/chat/ChatWindow.tsx#L67))
saute au bas de façon instantanée à chaque changement de `messages`.

- **Ne PAS** utiliser `behavior: 'smooth'` : déclenché 30-60×/s, chaque animation
  douce interrompt la précédente → pire saccade.
- L'essentiel de la douceur vient de A (plus de sauts de hauteur du markdown : le
  texte grandit caractère par caractère, la hauteur ne saute qu'à la complétion
  d'un bloc). Après A, l'auto-scroll instantané paraît déjà fluide.
- Vérifier après A+B ; s'il reste des à-coups, découpler l'auto-scroll du render
  React en le pilotant depuis la boucle rAF du drain (module-level) plutôt que
  depuis l'effet `useEffect([messages, ...])` qui se déclenche à chaque
  caractère. À ne faire que si nécessaire (mesure du besoin réel).

## Décisions

- **Formatage pendant l'écriture : « formatage live des blocs terminés »**
  (choix explicite de l'utilisateur). Alternative écartée : « texte simple
  pendant, formaté à la fin » (plus simple, un seul snap à la fin) — écartée car
  l'utilisateur veut voir le formatage des blocs déjà finis apparaître au fil de
  l'eau, plus proche de Claude.ai.
- **Frontière de bloc = dernier `\n\n`** (bloc entier), pas le dernier `\n`
  (ligne). Raison : un simple `\n` dans un paragraphe est un *soft break* GFM (pas
  une fin de bloc) ; commiter à chaque `\n` re-découperait un paragraphe en cours
  et changerait la sémantique. Le `\n\n` est la seule frontière de bloc sûre qui
  ne provoque jamais de re-groupement instable. Conséquence assumée : le bloc en
  cours (paragraphe, liste, tableau) reste en texte brut — avec ses `- ` / `**`
  visibles — jusqu'à sa fin. C'est précisément « bloc en cours = brut, blocs finis
  = formatés » qu'a choisi l'utilisateur.
- **Mesurer le débit avant de fixer les constantes B.** Alternative écartée :
  poser des nombres au hasard. Raison : la contrainte projet exige une preuve, pas
  une affirmation ; caler `CPS_BASE` sur le vrai débit est ce qui rend la cadence
  constante.
- **Fondu limité au bloc `active` (texte brut).** Alternative écartée : fondu sur
  tout le message (y compris blocs markdown). Raison : ReactMarkdown régénère ses
  éléments à chaque re-render → un fondu par-dessus flickerait et coûterait cher ;
  l'œil suit la tête d'écriture, donc fonder le seul bloc actif suffit.
- **Pas de `behavior: 'smooth'` sur l'auto-scroll.** Raison : à 30-60 déclenchements
  par seconde, les animations douces se chevauchent et aggravent la saccade ; la
  fluidité vient de la suppression des sauts de hauteur (A).
- **La fonction de découpe est une fonction pure dans un fichier dédié**
  (`web/lib/streaming-markdown.ts`), pas inline dans Message.tsx. Raison :
  testabilité unitaire (le runner `node --test` cible `lib/__tests__/*.test.ts`).

## Hors périmètre

- **L'amont (gateway LiteLLM / serveur).** On ne change ni le regroupement des
  tokens par la gateway, ni la façon dont `route.ts` émet les deltas
  ([app/api/chat/route.ts](../../web/app/api/chat/route.ts)). Tout le lissage
  reste côté client. (Note : le masquage du bloc `SOURCES:` via `emittableLength`
  peut retenir jusqu'à 7 caractères en fin de flux — micro-effet, non traité,
  hors sujet perçu.)
- **La logique agentique / de navigation du wiki** ([chat-agent.ts](../../web/lib/chat-agent.ts))
  et l'affichage des étapes (`StepTrail`). Inchangés.
- **La persistance, l'hydratation, la survie du flux à la navigation**
  (`hydrateFromDb`, clé éphémère, adoption d'uuid). Inchangés — ne pas y toucher.
- **Le rendu des messages figés / historiques** : identique à aujourd'hui (le
  nouveau chemin ne s'active que si `isStreaming === true`).
- **Coloration syntaxique des blocs de code** (highlight.js & co) : non demandé.

## Todo

- [x] **A.1 — Créer `web/lib/streaming-markdown.ts`** avec la fonction pure
  `splitStreamingMarkdown` (code fourni dans le Plan).
  **Vérif :** `npm test` (à ajouter en A.2-tests) passe ; la fonction compile
  (`npm run build` ou `tsc`).

- [x] **A.1-tests — Créer `web/lib/__tests__/streaming-markdown.test.ts`**
  (node:test + node:assert, comme les tests voisins). Cas à couvrir :
  (1) chaîne sans `\n\n` → `committed:''`, `active` = tout ;
  (2) un bloc terminé + un en cours (`"Bonjour.\n\nJe vais"` → committed
  `"Bonjour.\n\n"`, active `"Je vais"`) ;
  (3) plusieurs `\n\n` → coupe au dernier ;
  (4) fence de code ouvert (```` "texte\n\n```js\nconst a" ```` → active commence
  à la ligne ```` ```js ````) ;
  (5) fence de code refermé (```` "```js\ncode\n```\n\nSuite" ````) → committed
  contient le bloc de code complet, active = `"Suite"` ;
  (6) tableau en cours (`"| a | b |\n| - | - |"` sans `\n\n`) → tout en `active`.
  **Vérif :** `cd web && npm test` — les 6 cas passent (afficher la sortie).

- [x] **A.2 — Refactor `Message.tsx`** : extraire `MARKDOWN_COMPONENTS` (la map
  `components={{...}}` actuelle) en constante partagée ; ajouter le sous-composant
  mémoïsé `CommittedMarkdown` ; ajouter la prop `isStreaming` ; brancher le rendu
  en deux zones quand `isStreaming && role==='assistant'` ; mettre à jour le
  comparateur `memo` (ajouter `isStreaming`).
  **Vérif :** `npm run build` passe (types OK) ; `npm run lint` sans nouvelle
  erreur.

- [x] **A.3 — Brancher `isStreaming` dans `ChatWindow.tsx`** (calcul `streamingId`
  = id du dernier message si `streaming` et dernier = assistant ; passer la prop
  dans le `.map`).
  **Vérif :** `npm run build` passe.

- [x] **A — Vérification comportementale (le cœur).** Lancer l'app
  (`cd web && npm run dev`, ouvrir /chat). Astuce de test : pour ralentir et bien
  observer, baisser temporairement `CPS_BASE`/`CPS_MAX` à ~15 dans
  `chat-stream-store.ts`. Poser une question dont la réponse contient **gras,
  liste à puces et un titre** (ex. « Résume en 3 points, avec un titre en gras,
  ce que dit McKinsey sur le FinOps »). **Preuve attendue :** dans les blocs déjà
  terminés, plus AUCUN `**`/`- `/`#` visible qui « claque » ; seul le bloc en cours
  s'écrit en texte brut puis se formate UNE fois à sa complétion ; à la fin, le
  message entier est en markdown propre. Capturer 2-3 screenshots (mi-parcours +
  final) ou décrire précisément le comportement observé. Remettre les CPS après.

- [x] **B.1 — Instrumenter + mesurer le débit d'arrivée** (log temporaire dans
  `enqueueDelta`/`finishDrain`). Lancer, poser 2-3 questions longues, relever le
  `arrival cps` moyen dans la console.
  **Vérif :** noter les chiffres mesurés dans le commit / la sortie ; retirer le
  log ensuite.

- [x] **B.2 — Retendre les constantes** `CPS_BASE`, `CPS_MAX`, `FRAME_MS` et la
  fenêtre `queueLen / 0.6` selon la mesure B.1 (valeurs de départ dans le Plan :
  190 / 380 / 16 / 0.6, à ajuster).
  **Vérif comportementale :** relancer, poser une question longue à vitesse
  normale ; la réponse défile à vitesse **régulière**, sans phases *lent→burst*.
  Décrire le ressenti observé (plus de dumps de gros paquets).

- [x] **C.1 — Fondu du bloc actif** : keyframe `stream-fade-in` dans
  `web/app/globals.css` ; span keyé (ou repli mask-gradient) sur le nouveau
  morceau d'`active` dans `Message.tsx`.
  **Vérif :** à l'œil, le texte en cours d'écriture apparaît en léger fondu, pas
  en coupure sèche. Screenshot ou description.

- [x] **C.2 — Scroll** : vérifier qu'après A+B l'auto-scroll instantané est déjà
  fluide (aucun `behavior:'smooth'`). N'agir (découpler du render via rAF) QUE si
  un à-coup vertical subsiste.
  **Vérif :** pendant une réponse longue, la vue reste collée en bas sans saut
  vertical brusque.

- [x] **Non-régression** : `cd web && npm test` (toute la suite, dont
  `chat-stream-store.test.ts`) au vert ; `npm run build` OK ; vérifier à la main
  que Stop (bouton), navigation pendant un flux, et rechargement d'une
  conversation terminée fonctionnent toujours (le découpage ne s'active qu'en
  streaming, le rendu figé est inchangé).
  **Vérif :** sortie de `npm test` + `npm run build` affichées ; comportements
  Stop/navigation/reload décrits.

## Bilan

**Fait (A + B + C, les trois volets).**

- **A — rendu stable (le cœur).** `web/lib/streaming-markdown.ts` (fonction pure
  `splitStreamingMarkdown`) + 7 tests, dont un **invariant** prouvant sur un vrai
  message révélé caractère par caractère que la zone « blocs finis »
  (`committed`) **ne se réécrit jamais** — preuve déterministe que le
  « claquement » disparaît. `Message.tsx` refondu en deux zones (blocs finis
  mémoïsés via `CommittedMarkdown` + bloc actif en texte brut), `MARKDOWN_COMPONENTS`
  extrait, `memo` étendu à `isStreaming`. `streamingId` câblé dans `ChatWindow.tsx`.
  Validé par l'utilisateur : « A ok ».
- **B — cadence régulière.** Débit d'arrivée réel **mesuré** côté client :
  **~111-129 c/s** (paquets ~62 c toutes les ~0,5 s) — plus lent que l'hypothèse
  150-250 de la spec.
- **C — fondu + scroll.** Keyframe `stream-fade-in` (globals.css) + span keyé sur
  la tête d'écriture du bloc actif. Scroll : rien à changer (aucun à-coup vertical
  après A, comme la spec l'anticipait). Validé : « tout marche bien ».

**Écarts au plan (et pourquoi).**

1. **Constantes B.2 — valeurs finales différentes du plan, et corrigées en
   direct.** Le plan proposait `190/380/16 · fenêtre 0.6` (base *au-dessus* du
   débit). Première tentative à `CPS_BASE=140` (au-dessus du mesuré) → l'utilisateur
   a signalé des **rafales persistantes** : quand la base est *au-dessus* du débit,
   la file se **vide** entre deux paquets → l'affichage sprinte puis se fige. La
   règle correcte est l'**inverse** : base **SOUS** le débit pour garder un tampon
   permanent → écoulement continu. Valeurs finales : **`CPS_BASE=90`,
   `CPS_MAX=240`, `FRAME_MS=16`**, et la « fenêtre » magique `0.6` remplacée par une
   constante nommée **`QUEUE_DRAIN_S=1.0`** (horizon d'étalement de la file, qui
   lisse la nature saccadée de l'arrivée). Validé : cadence régulière.
2. **Instrumentation B.1 affichée À L'ÉCRAN, pas en console.** L'utilisateur est
   sur Safari (inspecteur non dispo) → encart temporaire dans l'UI au lieu de
   `console.info`. **Retirée** après mesure (0 marqueur `INSTRU TEMP` restant).
3. **`npm run lint` non exécutable** : le repo n'a **aucune config ESLint**
   (`next lint` lance un assistant interactif). Substitué par `tsc --noEmit`
   (propre sur mes fichiers) comme garde-fou de types.

**Non-régression — état honnête.** Une **autre session Claude** refond en parallèle
le système de types (`lib/ui.ts`, `wiki-query.ts`, `GraphView.tsx`, `types/index.ts`…,
spec `2026-07-28-types-documents-registre.md`) : son travail **en cours** casse
temporairement la compilation globale + **3 tests** de `chat-filters.test.ts`
(filtrage par type). **Prouvé externe à mon travail** : mes 4 fichiers compilent
seuls (0 erreur), mes **13 tests** (découpe + store) passent, et `chat-filters.test.ts`
(que je n'ai pas touché) échoue sur des symboles que l'autre session a supprimés.
Le commit est donc **scopé sur mes seuls fichiers** ; `npm run build` global et la
suite complète seront reverifiables une fois leur refonte stabilisée.

**Question latence soulevée par l'utilisateur (hors périmètre du code) :** la
lenteur perçue de la *phase de lecture* de l'agent n'est PAS due à ce chantier
(`api/chat/route.ts` et `chat-agent.ts` sont **intacts** ; le lissage ne touche que
l'affichage du texte). Facteurs réels : forte charge machine (plusieurs sessions
Claude en parallèle) + passerelle partagée. Seul effet latence de ce chantier :
`QUEUE_DRAIN_S=1.0` ajoute ~1 s de tampon sur le *texte de la réponse* — laissé tel
quel (fluidité validée), ajustable à la baisse si besoin.

---

**Fichier créé :** `tasks/specs/2026-07-28-fluidite-streaming-chat.md`

**Commande à taper dans une nouvelle session :**
`/implement @tasks/specs/2026-07-28-fluidite-streaming-chat.md`
