# Fix chat : perte de conversation à la navigation + création de conversation impossible (intermittent)

## Contexte

Deux bugs signalés par l'utilisateur sur l'application de bureau (Electron,
serveur Next.js embarqué dans `web/`) :

1. **Perte de conversation à la navigation** — « Quand je suis sur une page de
   chat et que je vais sur la page graphe et que je reviens sur la page chat, je
   suis sur une nouvelle conversation vierge. »
2. **Création de conversation impossible (intermittent)** — « Il arrive que je
   n'arrive pas à ajouter de nouvelle conversation quand je suis sur l'appli en
   local. » (parfois oui, parfois non.)

Après audit, **les deux bugs partagent une même cause racine** : lors de la
création paresseuse d'une conversation (au premier message d'un chat éphémère),
le composant reste sur la route générique `/chat` avec une **clé React figée
`"new"`**, et l'URL est changée par `window.history.replaceState` — c'est-à-dire
**hors du routeur Next**. Le routeur Next continue donc de croire qu'on est sur
`/chat` alors que l'URL affiche `/chat/<id>`. Cette désynchronisation URL ⇄
routeur produit :

- côté bug 1 : le lien « Chat » fixe de la barre latérale (`/chat`) est resservi
  depuis le **Router Cache client** de Next (défaut `staleTimes.dynamic = 30 s`),
  qui renvoie la version vierge mise en cache **avant** que le cookie de
  conversation active n'existe → le `redirect()` serveur vers `/chat/<id>` ne
  s'exécute jamais → conversation vierge ;
- côté bug 2 : la clé React `"new"` étant identique entre l'instance montée et le
  nouveau rendu de `/chat` déclenché par « Nouvelle discussion »
  (`router.push('/chat')`), React **réconcilie au lieu de démonter** →
  l'état `adoptedId` (l'uuid de la conversation courante) **survit** → on reste
  collé à la conversation précédente au lieu d'en ouvrir une neuve.

Cette spec corrige les deux avec **deux changements ciblés et indépendants**
(un par bug), sans refonte.

---

## Diagnostic détaillé (vérifié dans le code)

### Architecture actuelle du chat

- **Barre latérale** — `web/components/Sidebar.tsx:20` : entrée `NAV` `{ href:
  '/chat', ... }`. Le lien « Chat » est **fixe** vers `/chat` ; il ne porte
  jamais l'id de la conversation. Rendu via `<Link href={targetHref}>`
  (`Sidebar.tsx:44-49`), où `targetHref === href` pour tout sauf `/sources`.
- **Route `/chat`** — `web/app/chat/page.tsx` (server component,
  `export const dynamic = 'force-dynamic'`) :
  ```tsx
  const active = cookies().get('active_conversation')?.value;
  if (active) redirect(`/chat/${active}`);
  return <ChatWindow key="new" conversationId={null} />;   // clé figée "new"
  ```
- **Route `/chat/[id]`** — `web/app/chat/[id]/page.tsx` (`force-dynamic`) :
  ```tsx
  const conversation = await getConversation(params.id);
  return <ChatWindow key={params.id} conversationId={params.id}
                     initialMessages={conversation?.messages ?? []} />;  // clé = id
  ```
- **Cookie `active_conversation`** — `web/lib/active-conversation.ts` : écrit
  côté client (`setActiveConversationId`), effacé côté client
  (`clearActiveConversationId`), **lu côté serveur** par `/chat` pour rediriger.
- **`ChatWindow`** — `web/components/chat/ChatWindow.tsx` :
  - `adoptedId` (state, seedé depuis `conversationId`) : sert à re-lier la
    fenêtre déjà montée à l'uuid d'une conversation créée à la volée, **sans
    démontage** (`ChatWindow.tsx:32-36`).
  - `storeKey = adoptedId ?? conversationId ?? getEphemeralKey()`
    (`ChatWindow.tsx:43`) — clé de lecture dans le store de streaming
    module-level. **`adoptedId` a la priorité.**
  - `handleSend` (`ChatWindow.tsx:103-135`) : si une conversation existe déjà
    (`adoptedId ?? conversationId`), on `sendMessage` dessus ; sinon (chat
    éphémère) on `POST /api/conversations` (crée un uuid), puis :
    ```tsx
    setActiveConversationId(newId);
    void sendMessage(newId, newId, text, undefined);       // stream sous la clé uuid
    setAdoptedId(newId);                                     // re-lie sans démontage
    window.history.replaceState(null, '', `/chat/${newId}`); // <-- URL only (Next 14.2)  ← FAUTIF
    ```
- **Store de streaming** — `web/lib/chat-stream-store.ts` : `Map` module-level
  `states` clé→état ; le flux vit hors du cycle de vie du composant et **survit
  au démontage** (c'est pour ça que le remontage ne casse pas le streaming).
  `hydrateFromDb` ne clobbe jamais un flux en cours (`chat-stream-store.ts:118-126`,
  garde `if (active.has(key) || drains.has(key)) return`). `seedIfAbsent`
  n'écrase pas une entrée existante (`:107-110`).
- **« Nouvelle discussion »** — `web/components/chat/ConversationHistory.tsx:29-37` :
  ```tsx
  clearActiveConversationId();
  resetEphemeralKey();
  router.push('/chat');
  ```
- **Redirect racine** — `web/app/page.tsx` : `redirect('/chat')`.
- **Version Next** : `^14.2.35` (cf. `web/package.json`). `experimental.staleTimes`
  est supporté depuis 14.2.0. Défaut installé : `{ static: 300, dynamic: 30 }`
  (aucune surcharge aujourd'hui dans `web/next.config.js`).

### Bug 1 — enchaînement exact

1. Ouverture app : `/` → `/chat`. Cookie absent → `/chat` rend le **ChatWindow
   vierge** (`key="new"`). Ce rendu RSC est mis en **Router Cache client** sous
   la clé d'URL `/chat`, horodaté maintenant.
2. L'utilisateur tape → conversation `ABC` créée, cookie posé, URL passée à
   `/chat/ABC` par `history.replaceState` (le routeur Next croit toujours être
   sur `/chat` ; **son entrée de cache `/chat` reste le rendu vierge**).
3. Clic « Graph » → `/graph`.
4. Clic « Chat » (`href="/chat"`) moins de 30 s après l'étape 1 → Next trouve
   l'entrée `/chat` **non expirée** (`staleTimes.dynamic = 30`), la **réutilise
   sans rappeler le serveur** → `cookies()` n'est jamais relu, `redirect()` ne
   s'exécute pas → **conversation vierge**. BUG.

Point clé : « lien fixe `/chat` + redirection serveur pilotée par cookie » est
incompatible avec le Router Cache de Next pour une même clé d'URL — le cache
renvoie la version figée capturée avant que le cookie n'existe.

### Bug 2 — enchaînement exact (explique l'intermittence)

**Scénario qui ÉCHOUE** (conversation courante née d'un chat éphémère) :
1. `/chat` neuf (`key="new"`, `adoptedId=null`). L'utilisateur tape → conv `B`
   créée, `setAdoptedId(B)`, clé toujours `"new"`, URL `/chat/B` posée par
   `replaceState` (**routeur Next croit être sur `/chat`**).
2. Clic « Nouvelle discussion » → `clearActiveConversationId()` +
   `resetEphemeralKey()` + `router.push('/chat')`. Le routeur pense être **déjà**
   sur `/chat` → même clé `"new"` → **React réconcilie, ne démonte pas** →
   `adoptedId=B` **survit** (le cookie effacé et la clé éphémère purgée
   n'influent pas : `storeKey = adoptedId ?? ...` = `B`).
3. La fenêtre continue d'afficher `B` ; taper un message l'ajoute à `B`.
   **Impossible de créer une nouvelle conversation.** BUG.

**Scénario qui MARCHE** (conversation courante ouverte via l'Historique) :
1. Ouverture de conv `A` via la liste Historique → `router.push('/chat/A')` →
   `<ChatWindow key="A">` (clé = id, vraie navigation).
2. « Nouvelle discussion » → `<ChatWindow key="new">` : clé `A → "new"` →
   **changement de clé → remontage** → `adoptedId` seedé à `null` → fenêtre
   vierge. ✅

D'où le vécu « parfois oui, parfois non » : échoue quand la conv courante vient
d'être **créée en tapant** (clé restée `"new"`), marche quand elle a été ouverte
**via l'Historique** (clé = id). Un rechargement complet de l'app « répare »
aussi temporairement.

**Fausses pistes écartées** (ne pas y perdre de temps) :
- **Collision d'id** : les ids sont des `crypto.randomUUID()`
  (`web/lib/conversations-store.ts`) → impossible.
- **Échec d'écriture disque** : `createConversation` a un `catch` silencieux qui
  retournerait `null` (repli sur chat éphémère non persisté) — ça masquerait un
  vrai problème disque mais **n'explique pas l'intermittence décrite**. Hors
  périmètre (voir plus bas).
- **Garde anti double-flux** `if (active.has(key)) return`
  (`chat-stream-store.ts:323`) : concerne l'envoi d'un message, pas la création ;
  la création passe par une clé neuve. Non concerné.

---

## Plan

Deux changements **indépendants**, un par bug. Chacun corrige sa cause racine ;
ils composent sans conflit.

### Changement 1 — Bug 1 : désactiver la réutilisation du Router Cache pour les pages dynamiques

Fichier : `web/next.config.js`. Ajouter `staleTimes` dans le bloc `experimental`
**existant** (ne pas recréer le bloc) :

```js
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['gray-matter'],
    outputFileTracingRoot: path.join(__dirname),
    // Pages dynamiques (force-dynamic) : ne PAS réutiliser le Router Cache
    // client. Sans ça, le lien fixe « Chat » de la barre latérale renvoie la
    // version /chat mise en cache AVANT que le cookie `active_conversation`
    // n'existe (conversation vierge) au lieu de rejouer le redirect serveur
    // vers /chat/<id>. App locale : le refetch relit des fichiers locaux, coût
    // négligeable. `static` gardé au défaut Next (300 s).
    staleTimes: {
      dynamic: 0,
      static: 300,
    },
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};
```

Effet : à chaque clic sur le lien « Chat » (`/chat`, `force-dynamic`), Next
re-fetch le RSC → re-exécute le server component → relit le cookie → `redirect()`
vers `/chat/<id>` évalué à jour. Idem pour `/chat/[id]` et toute autre page
dynamique.

### Changement 2 — Bug 2 : vraie navigation Next au lieu de `history.replaceState`

Fichier : `web/components/chat/ChatWindow.tsx`.

**2a.** Importer et instancier le routeur Next (le fichier ne l'importe pas
encore). Ajouter à l'import déjà présent depuis `next/navigation`… il n'y en a
pas : ajouter une ligne d'import après les imports React/composants :

```tsx
import { useRouter } from 'next/navigation';
```

Puis, dans le composant, instancier le routeur (par ex. juste après
`const scrollRef = useRef...` / avec les autres hooks du haut) :

```tsx
const router = useRouter();
```

**2b.** Dans `handleSend`, remplacer la ligne fautive
(`ChatWindow.tsx:131`) :

```tsx
window.history.replaceState(null, '', `/chat/${newId}`); // URL only (Next 14.2)
```

par :

```tsx
// Vraie navigation Next (et non history.replaceState) : synchronise l'état du
// routeur avec l'URL. Sinon le routeur croit rester sur /chat (clé figée "new"),
// et « Nouvelle discussion » (router.push('/chat')) ne démonte pas la fenêtre →
// on reste collé à la conversation courante. `scroll: false` évite tout saut ;
// `adoptedId` (déjà posé juste au-dessus) fait le pont zéro-flash pendant la
// transition (la fenêtre montée lit toujours store[newId]).
router.replace(`/chat/${newId}`, { scroll: false });
```

**Ne PAS supprimer** `setAdoptedId(newId)` juste au-dessus : il reste nécessaire
comme **pont zéro-flash**. Pendant la transition `router.replace` (le temps que
le RSC de `/chat/[newId]` arrive), Next garde la fenêtre courante (`key="new"`)
montée et visible ; grâce à `adoptedId=newId`, cette fenêtre lit déjà
`store[newId]` (le flux en cours) et affiche le message + le streaming sans
attendre. Au swap, la nouvelle instance (`key=newId`) lit le même `store[newId]`
→ contenu identique → aucun flash. Sans `adoptedId`, la fenêtre lirait
`store[getEphemeralKey()]` (vide, car `sendMessage` écrit sous `newId`) pendant
la transition → flash.

Le reste de `handleSend` est inchangé (l'ordre : `setActiveConversationId(newId)`
→ `sendMessage(newId, newId, text)` → `setAdoptedId(newId)` → `router.replace`).

### Pourquoi le streaming n'est pas cassé par le remontage

`router.replace('/chat/newId')` remonte `ChatWindow` (clé `"new"` → `newId`).
Ce remontage est sûr :
- le flux vit dans `chat-stream-store` (module-level), **indépendant du cycle de
  vie du composant** — le remontage ne l'interrompt pas ;
- au remontage, `storeKey = conversationId = newId` → `useSyncExternalStore` lit
  `store[newId]` (flux live) → messages affichés ;
- l'effet de montage `seedIfAbsent(newId, [])` est un no-op (l'entrée existe) ;
- le `fetch('/api/conversations/newId')` puis `hydrateFromDb(newId, ...)` ne
  clobbe pas le flux (`hydrateFromDb` garde `if (active.has(newId) ...) return`).

### Ce qui reste inchangé (et pourquoi)

- **Cookie `active_conversation` + redirect serveur `/chat`** : conservés. Ils
  restent la voie de reprise pour le démarrage à froid (`/` → `/chat` →
  `/chat/<id>`) et l'accès direct à `/chat`. Le Changement 1 fait qu'ils sont
  désormais **réévalués** à chaque navigation au lieu d'être court-circuités par
  le cache.
- **`adoptedId`** : conservé comme pont zéro-flash (cf. 2b).
- **Barre latérale** : le lien « Chat » reste fixe vers `/chat` — inutile de le
  rendre dynamique une fois le cache neutralisé (voir Décisions, levier A écarté).

---

## Décisions

### D1 — Bug 1 : `staleTimes.dynamic = 0` (retenu) plutôt que lien « Chat » dynamique

- **Retenu (levier B)** : `experimental.staleTimes = { dynamic: 0, static: 300 }`
  dans `next.config.js`. Une ligne de config, corrige **toute la classe** de
  bugs « lien fixe + redirect cookie resservi périmé ». Son seul inconvénient
  habituel (refetch réseau à chaque navigation arrière) **n'existe pas ici** :
  l'app est locale, le serveur Next embarqué relit des fichiers locaux — coût
  imperceptible. Bonus : dans une app local-first où les fichiers changent
  (ingestion, conversations), refetcher rend l'affichage **plus** correct.
- **Écarté (levier A)** : rendre le lien « Chat » de la barre latérale dynamique
  (`/chat/<id actif>` lu depuis un store client réactif façon `sources-nav-store`).
  Plus ciblé (préserve le cache ailleurs) mais **plus de surface de code** (store
  + abonnement + gestion du mismatch d'hydratation SSR). Contraire au principe
  « simplicité d'abord » alors que le levier B suffit sans effet de bord notable
  en contexte local.
- **Écarté (levier C seul)** : ne corriger que la désynchro routeur (Changement 2)
  ne suffit pas au bug 1, car le lien « Chat » reste fixe `/chat` et retombe sur
  le cache périmé. C'est pourquoi le bug 1 exige le Changement 1.

### D2 — Bug 2 : `router.replace` (retenu) plutôt que forcer un remontage autrement

- **Retenu** : remplacer `history.replaceState` par `router.replace('/chat/<id>')`.
  Aligne l'URL, l'état du routeur ET l'entrée de cache — corrige la cause racine
  (le routeur sait enfin qu'on est sur `/chat/<id>`), donc « Nouvelle discussion »
  change bien la clé et remonte à neuf. Bonus : le bouton « retour » du
  navigateur devient cohérent (l'éphémère `/chat` est *remplacé*, pas empilé —
  comportement identique à l'intention d'origine de `replaceState`).
- **Écarté** : garder `replaceState` et forcer un remontage sur « Nouvelle
  discussion » (clé changeante artificielle, ou `router.refresh()`). Plus
  bricolé, laisse l'URL et le routeur désynchronisés.

### D3 — Conserver `adoptedId`

Retenu comme pont zéro-flash pendant la transition `router.replace` (cf. Plan
2b). Le supprimer réintroduirait un flash (fenêtre lisant la clé éphémère vide
le temps de la navigation). `adoptedId` n'a jamais été le bug ; le bug était le
`replaceState` (mensonge d'URL) à la place d'une vraie navigation.

### D4 — Vérification en `next dev` suffisante

Les deux bugs sont de la **pure sémantique React + routeur Next**, identique en
`next dev` et dans l'Electron packagé (confirmé à l'audit). La vérification peut
donc se faire en `cd web && npm run dev` sans reconstruire le `.dmg`.

---

## Hors périmètre

- **`catch` silencieux de `createConversation`** (`web/lib/conversations-store.ts`)
  et de `writeJsonAtomic` (`web/lib/wiki-fs.ts`) : ils masqueraient un vrai échec
  d'écriture disque. Réel problème d'observabilité, mais **distinct** des deux
  bugs traités ici (n'explique pas l'intermittence décrite). À traiter séparément
  si un jour l'écriture échoue vraiment. Ne rien changer dans cette spec.
- **Rendre le lien « Chat » dynamique / store d'active-conversation réactif**
  (levier A) : écarté (D1). Ne pas l'implémenter.
- **Refonte du couple cookie/redirect** : conservé tel quel.
- **Suppression de `adoptedId`** : ne pas faire (D3).
- Toute modification de `raw/`, `wiki/`, ou de la logique d'ingestion : sans
  rapport.

---

## Todo

- [x] **T1 — Reproduire les deux bugs AVANT correctif (état de référence).**
  Lancer `cd web && npm run dev`, ouvrir `http://localhost:3000`.
  - Bug 1 : sur `/chat`, taper un message (l'URL passe à `/chat/<id>`) → cliquer
    « Graph » dans la barre latérale → cliquer « Chat » → **constater** qu'on
    retombe sur une conversation vierge.
  - Bug 2 : sur `/chat`, taper un message (conv A créée) → cliquer « Nouvelle
    discussion » → **constater** que la fenêtre affiche toujours les messages de
    A (on ne peut pas repartir à neuf).
  - **Critère** : les deux comportements fautifs sont observés et notés (c'est la
    base de comparaison de T4/T5).

- [x] **T2 — Changement 1 (bug 1).** Ajouter `staleTimes: { dynamic: 0, static:
  300 }` dans le bloc `experimental` de `web/next.config.js` (cf. Plan,
  Changement 1). **Redémarrer** `next dev` (un changement de `next.config.js` ne
  se recharge pas à chaud).
  - **Critère** : le serveur dev redémarre sans erreur ni warning de config
    invalide sur `staleTimes` ; l'app se charge normalement sur `/chat`.

- [x] **T3 — Changement 2 (bug 2).** Dans `web/components/chat/ChatWindow.tsx` :
  ajouter `import { useRouter } from 'next/navigation';`, instancier
  `const router = useRouter();`, et remplacer la ligne
  `window.history.replaceState(null, '', \`/chat/${newId}\`);` par
  `router.replace(\`/chat/${newId}\`, { scroll: false });` (cf. Plan, Changement
  2, commentaire inclus). **Ne pas** retirer `setAdoptedId(newId)`.
  - **Critère** : compilation sans erreur TypeScript (`cd web && npx tsc
    --noEmit` passe, ou pas de nouvelle erreur si la base en avait déjà) ; l'app
    recompile à chaud sans erreur runtime dans la console.

- [x] **T4 — Vérifier le bug 1 corrigé.** Rejouer le scénario bug 1 de T1 : taper
  un message sur `/chat`, aller sur « Graph », revenir sur « Chat ».
  - **Critère** : on **revient sur la conversation en cours avec ses messages**,
    pas sur une conversation vierge. Refaire l'aller-retour Graph↔Chat 2-3 fois
    d'affilée rapidement (fenêtre < 30 s) : la conversation est **toujours**
    conservée.

- [x] **T5 — Vérifier le bug 2 corrigé (chemin qui échouait).** Sur `/chat`, taper
  un message (conv A, l'URL doit passer à `/chat/<idA>`) → cliquer « Nouvelle
  discussion ».
  - **Critère** : la fenêtre devient **vierge** (aucun message de A) et l'URL
    revient à `/chat`. Taper un nouveau message → une conversation **distincte**
    B est créée. Ouvrir « Historique » → **deux entrées distinctes** (A et B)
    apparaissent.

- [x] **T6 — Vérifier l'absence de flash à la création (zéro-flash).** Sur un
  `/chat` neuf, taper un premier message et **observer** la transition au moment
  où l'URL passe à `/chat/<id>`.
  - **Critère** : le message tapé et le début de la réponse restent affichés en
    continu ; la fenêtre ne clignote pas / ne se vide pas pendant le changement
    d'URL.

- [x] **T7 — Non-régression : streaming survivant à la navigation.** Poser une
  question longue ; **pendant** que la réponse se génère, cliquer « Graph » puis
  revenir sur « Chat ».
  - **Critère** : la réponse a continué en arrière-plan ; au retour on la voit
    poursuivre/terminée (pas de perte, pas de redémarrage). (Valide que le
    remontage introduit par `router.replace` ne casse pas le store de streaming.)

- [x] **T8 — Non-régression : chemin « Historique » toujours OK.** Ouvrir une
  conversation depuis « Historique » (`/chat/<id>`), puis « Nouvelle discussion ».
  - **Critère** : fenêtre vierge, nouvelle conversation créée au message suivant.
    (Ce chemin marchait déjà avant ; vérifier qu'il marche encore.)

- [x] **T9 — Non-régression : navigation générale.** Cliquer dans la barre
  latérale entre Chat, Graph, Wiki, Sources, Entités, Thèmes puis revenir.
  - **Critère** : navigation fluide, aucune page cassée ou vide inattendue
    (contrôle que `staleTimes.dynamic = 0` n'a rien dégradé ailleurs). Les
    filtres restaurés de « Sources » fonctionnent toujours.

---

**Fichier créé :** `tasks/specs/2026-07-27-fix-chat-navigation-et-creation-conversation.md`

**Commande à taper dans une nouvelle session :**
`/implement @tasks/specs/2026-07-27-fix-chat-navigation-et-creation-conversation.md`

---

## Bilan

### Ce qui a été fait (2 changements ciblés, exactement conformes au plan)

1. **`web/next.config.js`** — ajout de `staleTimes: { dynamic: 0, static: 300 }`
   dans le bloc `experimental` existant (Changement 1, bug 1).
2. **`web/components/chat/ChatWindow.tsx`** — import `useRouter`, instanciation
   `const router = useRouter();`, et remplacement de
   `window.history.replaceState(null, '', /chat/${newId})` par
   `router.replace(/chat/${newId}, { scroll: false })` (Changement 2, bug 2).
   `setAdoptedId(newId)` conservé (pont zéro-flash, D3).

`tsc --noEmit` passe sans erreur (`TSC_EXIT=0`).

### Preuve de bout en bout (avant/après, pilotée navigateur)

La sémantique des deux bugs est purement client (Router Cache Next + réconciliation
React) : elle exige un vrai navigateur pour être observée. Vérification menée sur
**deux instances isolées** construites à partir d'une copie de `web/` (`node_modules`
symlinké, `.next` et `DATA_ROOT` dédiés, `WIKI_ROOT`/`RAW_ROOT` pointant en
**lecture seule** vers le vrai wiki) :
- **`before`** = code sans les 2 correctifs (état de référence, port 3022) ;
- **`after`** = code avec les 2 correctifs (port 3021).

`/api/chat` a été **stubé** (flux NDJSON canné, persistance réelle conservée) →
**zéro appel LLM, zéro coût**, tout en conservant un vrai streaming étalé (~2,4 s)
pour tester la survie du flux. Les deux instances ont été pilotées par le **même**
scénario via un Chrome headless en **CDP** (zéro dépendance, Node 26).

| Critère | BEFORE (bug présent) | AFTER (corrigé) |
|---|---|---|
| **T4/Bug 1** — URL au retour « Chat » après Graph | `/chat` (vierge) | `/chat/<id>` (redirigé) |
| **T4/Bug 1** — message conservé au retour | **non** | **oui** |
| **T5/Bug 2** — conv A encore affichée après « Nouvelle discussion » | **oui** (bloqué) | **non** (vierge) |
| **T5/Bug 2** — entrées d'historique après 2e message | **2** (B fusionné dans A) | **3** (A et B distincts) |
| **T6** — zéro-flash (message + streaming continus à la transition d'URL) | — | oui (message visible sans interruption) |
| **T7** — streaming visible/terminé au retour de navigation | non (perdu avec bug 1) | **oui** (`"navigation."` présent) |
| **T8** — chemin « Historique » puis « Nouvelle discussion » → vierge | oui | oui |
| **T9** — nav Chat/Graph/Wiki/Sources/Entités/Thèmes | toutes atteintes | toutes atteintes |

`/sources` rend bien son contenu (4415 caractères : filtres type/auteur/origine),
identiquement en `before` et `after` → `staleTimes.dynamic = 0` n'a **rien dégradé**
ailleurs.

### Écarts par rapport au plan (méthode de vérification, pas de contenu)

- **T2/T3** demandaient un redémarrage de `next dev`. Sous **Node 26**, `next dev`
  est instable (cf. `tasks/lessons.md`, 2026-07-10 / 2026-07-21) : j'ai vérifié via
  `next build && next start`, plus fiable. La sémantique client (Router Cache,
  réconciliation) est identique en dev, `start` et Electron packagé (D4).
- **T1 et T4–T9** décrivaient une manipulation **manuelle** dans le navigateur.
  Je les ai **automatisées via CDP** sur deux instances isolées (`before`/`after`),
  ce qui est **plus** rigoureux qu'un test manuel : le contrefactuel `before`
  prouve que les correctifs changent réellement le comportement (les bugs se
  reproduisent sans eux), et le tout est reproductible.
- **Motivation de l'isolation** : une **session Claude concurrente** faisait tourner
  un `next dev` sur le port 3000 (cf. `tasks/lessons.md`, 2026-07-21). Ne pas y
  toucher évitait de corrompre son `.next` ; ce serveur tournait de toute façon avec
  l'ancienne config (sans `staleTimes`) et n'aurait rien prouvé pour le bug 1.

### Hors périmètre respecté

Aucune modification du couple cookie/redirect, de `adoptedId`, du `catch` silencieux
de `createConversation`, ni de `raw/`/`wiki/`/ingestion. Seuls `next.config.js` et
`ChatWindow.tsx` sont touchés dans `web/`.
