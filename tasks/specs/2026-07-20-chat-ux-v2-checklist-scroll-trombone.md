# Chat UX v2 — checklist véridique, scroll libre pendant la génération, barre épurée

## Contexte

Suite à la spec `2026-07-20-chat-ux-streaming-stop-checklist.md` (implémentée : streaming
lissé, bouton Stop, barre pilule, checklist des ressources), Arthur a testé visuellement et
relève 3 problèmes :

1. **Checklist incomplète.** Question posée : « qu'est-ce que l'agentic coding exactement ? ».
   La réponse cite 4 ressources (chips sources), mais la checklist n'affiche que 3 étapes :
   index, page thème, et UNE seule fiche. Diagnostic vérifié dans le code : la trace est
   honnête — chaque étape émise correspond à un appel d'outil réellement exécuté
   (`web/lib/chat-agent.ts:324`). Le coupable est le **prompt système** : la règle SOURCES
   (`chat-agent.ts:399`) autorise à citer des ressources « réellement lues **ou identifiées**
   dans le wiki », et la MÉTHODE §3 (`chat-agent.ts:378`) décourage d'ouvrir les fiches.
   L'agent lit la page thème et cite les fiches qui y sont listées **sans les ouvrir** →
   citations ⊃ étapes affichées.
2. **Scroll forcé vers le bas.** Pendant la génération, impossible de remonter lire le début
   de la réponse ou les messages précédents : la vue redescend en permanence. Diagnostic :
   `web/components/chat/ChatWindow.tsx:57-59` — un `useEffect` scrolle en bas à chaque
   changement de `messages` (≈30×/s pendant le drain rAF), sans tenir compte de la position
   de l'utilisateur. Les `behavior:'smooth'` empilés à cette fréquence produisent l'effet
   d'« aspiration ».
3. **Trombone inutile.** Le bouton pièce jointe (Link vers `/upload`,
   `web/components/chat/InputBar.tsx:99-105`) n'a pas sa place dans le chat.

Un 4e signalement initial (effet machine à écrire jugé absent) a été **retiré par Arthur**
après re-test : le lissage actuel du drain est validé tel quel. **Interdiction d'y toucher.**

## Plan

### 1. Checklist véridique — `web/lib/chat-agent.ts` (fonction `buildSystemPrompt` UNIQUEMENT)

Aucun changement dans la boucle agentique (`runWikiAgent`), `executeWikiTool`, la route
`/api/chat`, ni le store. Deux retouches du texte du prompt :

**a. MÉTHODE §3** — remplacer :

```
3. N'ouvre les fiches resources/ que si un détail précis est nécessaire.
```

par :

```
3. Ouvre TOUTE fiche resources/ dont tu comptes exploiter ou citer le contenu — une fiche
   non ouverte ne doit jamais nourrir la réponse.
```

(La ligne suivante « N'appelle PAS d'outil inutilement : arrête la navigation dès que tu peux
répondre. » est conservée telle quelle.)

**b. RÈGLES DE RÉPONSE, ligne SOURCES** — remplacer :

```
  N'y mets que des ressources (resources/<slug>.md) réellement lues ou identifiées dans le wiki,
  avec les valeurs exactes de leur frontmatter.
```

par :

```
  N'y mets QUE des fiches (resources/<slug>.md) réellement OUVERTES avec read_wiki_page pendant
  cette conversation, avec les valeurs exactes de leur frontmatter. Exception : pour une question
  d'énumération ou de comptage dont la réponse ne restitue que des métadonnées d'index
  (titre/date/auteur), tu peux citer des fiches identifiées via les index sans les ouvrir —
  ne lis jamais toutes les fiches en masse.
```

Effet attendu : chaque fiche citée dans une réponse de fond = un appel `read_wiki_page` = une
étape visible dans la checklist. Coût assumé : quelques secondes et tokens de plus par réponse
de fond (principe projet « fidélité > brièveté »).

### 2. Libellé du résumé replié — `web/components/chat/Message.tsx`

Lignes 21-22, remplacer :

```tsx
{message.steps.length} ressource{message.steps.length > 1 ? 's' : ''} consultée
{message.steps.length > 1 ? 's' : ''}
```

par :

```tsx
{message.steps.length} étape{message.steps.length > 1 ? 's' : ''} de recherche
```

(La trace inclut index, pages thème et explorations de dossiers, pas seulement des fiches.)

### 3. Scroll « collé seulement si déjà en bas » — `web/components/chat/ChatWindow.tsx`

- Ajouter `const pinnedRef = useRef(true);` — un **ref**, pas un state : la valeur change à
  chaque événement scroll et ne doit provoquer aucun re-render.
- Handler sur la div scrollable (celle qui porte `ref={scrollRef}`, ligne 139) :

```tsx
const handleScroll = () => {
  const el = scrollRef.current;
  if (!el) return;
  pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
};
```

  et `onScroll={handleScroll}` sur la div.
- Remplacer l'effet d'auto-scroll (lignes 57-59) par :

```tsx
useEffect(() => {
  if (!pinnedRef.current) return;
  const el = scrollRef.current;
  el?.scrollTo({ top: el.scrollHeight });
}, [messages, loading, steps.length]);
```

  `behavior:'auto'` implicite (instantané) : le `smooth` répété ~30×/s est la cause de
  l'aspiration. Le scroll programmatique redéclenche `onScroll`, qui recalcule
  `pinned = true` (on est en bas) — cohérent, pas de boucle.
- Au début de `handleSend` : `pinnedRef.current = true;` — envoyer un message recolle la vue
  en bas pour suivre la nouvelle réponse.

Comportement obtenu : on suit le fil tant qu'on est en bas (seuil 80 px) ; dès qu'on remonte
(molette, drag), plus AUCUN scroll forcé ; revenir manuellement en bas ré-active le suivi.

### 4. Retirer le trombone — `web/components/chat/InputBar.tsx`

- Supprimer le bloc lignes 99-105 :

```tsx
<Link
  href="/upload"
  title="Déposer une source"
  className={`${iconBtn} text-gray-500 hover:bg-gray-100`}
>
  <Paperclip size={18} />
</Link>
```

- Retirer `Paperclip` de l'import lucide-react, et supprimer `import Link from 'next/link';`
  (plus utilisé dans ce fichier après suppression — à vérifier avec une recherche dans le
  fichier avant de retirer l'import).
- Mic et toggle Envoyer/Stop strictement inchangés.

### Interdits

- **NE PAS toucher** au drain/lissage de `web/lib/chat-stream-store.ts` (rendu validé par
  Arthur tel quel, y compris ses constantes CPS_BASE/CPS_MAX/FRAME_MS).
- Ne pas toucher à la bulle utilisateur (`bg-blue-600`) ni à la palette neutre noir/gris.
- Ne pas configurer ESLint (`npm run lint` est non configuré dans ce projet — état
  pré-existant assumé ; utiliser `npx tsc --noEmit` + `npm run build`).

## Décisions

- **Corriger le comportement de l'agent plutôt que l'affichage.** Alternative écartée :
  fabriquer des étapes UI pour les sources citées non lues — malhonnête (trace mensongère).
  Autre alternative écartée : ne changer que le libellé — ne résout pas le fond (l'agent cite
  des fiches qu'il n'a pas lues). Choix : règle « toute fiche citée doit avoir été ouverte »,
  qui aligne checklist et citations **par construction** et enrichit les réponses de fond.
- **Exception énumération conservée.** Forcer la lecture de toutes les fiches pour « liste
  toutes les ressources de 2026 » exploserait le contexte et la latence (la règle existante
  « ne lis jamais toutes les fiches en masse » reste). Pour ces questions, l'écart
  checklist/citations persiste mais est légitime (la réponse n'exploite que les index).
- **`pinnedRef` en ref, pas en state** : événement scroll très fréquent, aucun rendu ne
  dépend de la valeur.
- **`behavior:'auto'` au lieu de `smooth`** pour l'auto-scroll : les animations smooth
  empilées à ~30 Hz se combattent entre elles et avec la molette de l'utilisateur.
- **Libellé « N étapes de recherche »** : exact (couvre index/thèmes/dossiers), là où
  « ressources consultées » était faux dès qu'une étape n'était pas une fiche.
- **Drain intact** : un bug théorique de réveil (`lastTs` non réinitialisé quand la file se
  vide puis se re-remplit → le paquet suivant peut s'afficher d'un coup) a été identifié
  pendant le diagnostic, mais Arthur valide le rendu perçu actuel → non corrigé, hors
  périmètre.

## Hors périmètre

- Toute modification de `chat-stream-store.ts` (drain, pacing, Stop) et de la route
  `/api/chat`.
- Bouton flottant « ↓ revenir en bas » quand l'utilisateur est remonté (option future).
- Correction du bug théorique de réveil du drain (voir Décisions).
- Configuration d'ESLint.
- Persistance des étapes (la checklist reste transiente, non stockée en base).

## Todo

- [x] **1. Prompt système** : appliquer les deux remplacements de texte dans
  `buildSystemPrompt` (`web/lib/chat-agent.ts`), MÉTHODE §3 et règle SOURCES, exactement
  comme spécifié au Plan §1.
  *Vérification* : `npx tsc --noEmit` propre ; les tests existants de `chat-agent`
  (`web/lib/__tests__/chat-agent.test.ts`) restent verts (ils ne testent pas le texte du
  prompt) ; relire le prompt généré (console ou test rapide) pour confirmer l'absence de
  « ou identifiées ».
- [x] **2. Libellé** : remplacer « ressource(s) consultée(s) » par « étape(s) de recherche »
  dans `web/components/chat/Message.tsx` (lignes 21-22).
  *Vérification* : `grep -rn "consultée" web/components/` ne renvoie plus rien ;
  `npx tsc --noEmit` propre.
- [x] **3. Scroll conditionnel** : `pinnedRef` + `onScroll` + effet d'auto-scroll gardé par
  `pinnedRef.current` (`behavior` instantané) + re-pin dans `handleSend`, dans
  `web/components/chat/ChatWindow.tsx`, exactement comme au Plan §3.
  *Vérification* : `npx tsc --noEmit` propre ; revue du diff : l'effet ne scrolle QUE si
  `pinnedRef.current` et plus aucun `behavior:'smooth'` dans ce fichier ; le test visuel
  final revient à Arthur (étape 6).
- [x] **4. Trombone** : supprimer le Link Paperclip + imports morts dans
  `web/components/chat/InputBar.tsx`.
  *Vérification* : `grep -n "Paperclip\|next/link" web/components/chat/InputBar.tsx` ne
  renvoie rien ; `npx tsc --noEmit` propre.
- [x] **5. Vérification globale** : `npm test` (les 62 tests existants verts — aucun nouveau
  test : scroll = DOM réel non testable en node:test, prompt = comportement LLM),
  `npx tsc --noEmit`, `npm run build`.
  *Vérification* : les trois commandes passent sans erreur.
- [x] **6. E2E checklist sur serveur réel** : lancer le dev server (procédure UNIQUE de
  `tasks/lessons.md` : tuer les `next-server` orphelins, `rm -rf .next`, une seule instance),
  puis POST `/api/chat` (via `curl`, après création d'une conversation via POST
  `/api/conversations`) avec une question de fond, ex. « Qu'est-ce que l'agentic coding
  exactement ? ». Parser le NDJSON reçu : collecter les événements `step`
  (`tool === 'read_wiki_page'`, paths `resources/<slug>.md`) et les slugs de `done.sources`.
  *Vérification* : chaque slug cité dans `done.sources` a un `step` de lecture
  `resources/<slug>.md` correspondant (citations ⊆ fiches ouvertes). Laisser le serveur
  tourner pour le contrôle visuel d'Arthur (scroll libre + absence de trombone —
  non vérifiables en headless).
- [x] **7. Leçons** : ajouter à `tasks/lessons.md` : (a) une trace d'activité affichée à
  l'utilisateur doit couvrir tout ce que la réponse cite — aligner le comportement de
  l'agent, ne jamais fabriquer la trace ; (b) un auto-scroll doit TOUJOURS être conditionné
  à la position de l'utilisateur (pattern « pinned si déjà en bas »).
  *Vérification* : entrées présentes dans le fichier.

Fin de l'implémentation (protocole `/implement`) : section `## Bilan` dans cette spec, puis
**proposer** le commit sans commiter (jamais sans accord explicite d'Arthur).

## Bilan

**Fait, conformément au plan (les 4 changements + vérifications) :**

1. Prompt système (`buildSystemPrompt`) : MÉTHODE §3 et règle SOURCES remplacées à
   l'identique de la spec. `grep "ou identifiées"` → 0 occurrence ; 14 tests
   `chat-agent` verts.
2. Libellé `Message.tsx` : « N étape(s) de recherche ». `grep "consultée"` sur
   `web/components/` → 0 occurrence.
3. Scroll conditionnel `ChatWindow.tsx` : `pinnedRef` (ref, seuil 80px) + `onScroll`
   + effet gardé par `pinnedRef.current` en `behavior` instantané + re-pin dans
   `handleSend`. Plus aucun `smooth` dans le fichier.
4. Trombone supprimé dans `InputBar.tsx`, imports `Paperclip` et `next/link` retirés
   (`Link` n'avait plus aucun usage). Mic et Envoyer/Stop intacts.
5. Vérification globale : 62 tests verts, `tsc --noEmit` propre, `npm run build` OK.
6. E2E serveur réel (`next dev` unique, `.next` nettoyé) : question « Qu'est-ce que
   l'agentic coding exactement ? » → 3 steps émis (index, themes/agentic-coding,
   resources/ai-revolution-software-development), 1 source citée = la fiche ouverte.
   **Invariant citations ⊆ fiches ouvertes vérifié** (avant : 4 citées / 1 ouverte).
7. Deux leçons ajoutées à `tasks/lessons.md` (trace véridique ; auto-scroll pinned).

**Déviations (mineures, sans impact sur le plan) :**

- Lignes réelles légèrement décalées vs la spec (auto-scroll en 55-57, pas 57-59) —
  même code, remplacé à l'identique.
- Commentaire de `iconBtn` (« 3 boutons ») mis à jour car devenu faux après le
  retrait du trombone (non prévu par la spec, correction de commentaire uniquement).
- Premier `npm run build` après `rm -rf .next` échoué sur un ENOENT transitoire
  (`pages-manifest.json`, fragilité Next 14 / Node 26 déjà connue) ; relance
  immédiate : build complet OK, exit 0. Aucun rapport avec les changements.
- Deux serveurs `next dev` orphelins découverts et tués avant l'E2E (pattern déjà
  documenté dans lessons.md) ; procédure unique respectée ensuite.

**Hors périmètre respecté :** `chat-stream-store.ts` (drain/pacing/Stop), route
`/api/chat`, bulle utilisateur et palette : zéro modification.

**Reste à valider par Arthur (visuel, serveur laissé tourner sur :3000) :** scroll
libre pendant génération (remonter → plus d'aspiration ; revenir en bas ou envoyer →
suivi réactivé), absence du trombone, libellé « N étapes de recherche », checklist
complète sur une question de fond.
