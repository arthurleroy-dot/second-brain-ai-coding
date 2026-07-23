# Suppression d'éléments d'historique de chat (+ garantie de persistance)

## Contexte

App **Electron local-first** (Next.js 14 App Router + React 18 + Tailwind, dans `web/`).
L'historique de chat est stocké en fichiers JSON locaux (un par conversation). Deux
demandes de l'utilisateur :

1. **S'assurer que l'historique est persistant** entre deux ouvertures de l'app (une
   « session » = un cycle ouverture → fermeture). Fermer puis rouvrir l'app ne doit rien
   perdre.
2. **Pouvoir supprimer des éléments d'historique** :
   - une croix « × » à droite de chaque conversation → suppression **immédiate** (un clic,
     sans confirmation) ;
   - un bouton « Tout effacer » **toujours visible en bas de la liste** (sans avoir à
     dérouler toute la scrollbar) → suppression de tout l'historique **avec confirmation**.

**Constat clé (issu de l'exploration) : la persistance est DÉJÀ garantie par conception.**
Il n'y a rien à coder pour le point 1 ; il faut seulement le *prouver* (tests + fermeture/
réouverture réelle). Toute la charge de code porte sur le point 2, qui **réutilise à
l'identique des patterns déjà présents** dans le repo (bouton `Trash2` de `SourceRow.tsx`,
modale `ConfirmDialog.tsx`, écriture atomique de `conversations-store.ts`, convention des
routes `DELETE` de `api/sources`/`api/entities`).

### Mécanisme de persistance actuel (pour comprendre / vérifier — NE PAS modifier)

- Une conversation = un fichier `<DATA_ROOT>/.data/conversations/<id>.json`
  (`web/lib/conversations-store.ts:16`, `CONV_DIR`), écrit atomiquement (temp + `fs.rename`,
  `writeJsonAtomic` lignes 30-43).
- `DATA_ROOT` (`web/lib/wiki-fs.ts:8`) = `process.env.DATA_ROOT ?? path.resolve(process.cwd(), '..')`.
  En app packagée, l'env est injecté depuis `electron/main.js:84` : `app.getPath('userData')`
  (avec `app.setName('SecondBrain')` fixé avant tout `getPath`) → dossier utilisateur standard
  de l'OS (macOS : `~/Library/Application Support/SecondBrain`), **stable, par utilisateur,
  hors dossier temporaire**, identique à chaque lancement. En dev (`next dev` depuis `web/`),
  fallback = racine du dépôt → `<repo>/.data/conversations/`.
- Le message *utilisateur* est écrit sur disque **avant** l'appel LLM (`web/app/api/chat/route.ts:56`,
  `saveMessage(...)`), l'assistant en fin de flux (idempotent, aussi dans le `catch`). Au
  rechargement, le serveur relit le disque (`app/chat/[id]/page.tsx` → `getConversation`).
- Le seeding Electron ne touche jamais `.data/` (uniquement `wiki/`/`raw/`) → une mise à
  jour de l'app ne réécrit jamais les conversations. `.data/` est gitignoré.

Limites connues, **hors périmètre** : (a) la trace « étapes » de l'agent (StepTrail) n'est
pas sérialisée — par choix ; (b) cas dégradé rarissime où `POST /api/conversations` échoue
(disque indisponible) et le fil éphémère n'est alors jamais écrit.

---

## Plan

Contenu intégral du plan validé.

### Décision produit validée

- Croix « × » sur un élément → **suppression immédiate en un clic**, sans confirmation.
- « Tout effacer » → **confirmation** (fenêtre « Êtes-vous sûr ? »), car il détruit tout.
- Suppression = **définitive** (pas de corbeille, pas d'undo). Assumé par l'utilisateur.

### Partie 1 — Vérifier la persistance (aucun code applicatif)

Rien à modifier côté persistance. On prouve qu'elle tient via les tests existants
`web/lib/__tests__/conversations-store.test.ts` et un test manuel ferme/rouvre. (Voir la
section Todo / Vérification.)

### Partie 2 — Feature « supprimer un élément / tout effacer »

Trois couches, de bas en haut. Chaque étape recopie un pattern existant.

#### A. Couche disque — `web/lib/conversations-store.ts`

Ajouter deux fonctions exportées, en réutilisant `convPath()` (lignes 19-23, garde
anti-traversal `path.basename`), `CONV_DIR` (ligne 16), et le pattern `fs.unlink(...).catch(...)`
déjà présent ligne 40. Imports en tête déjà là : `fs` (`fs/promises`), `path`.

```ts
/** Supprime la conversation `id`. Idempotent : absente = succès. */
export async function deleteConversation(id: string): Promise<void> {
  try {
    await fs.unlink(convPath(id));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // vraie erreur → remonte (500)
  }
}

/** Supprime toutes les conversations (ne supprime pas le dossier lui-même). */
export async function deleteAllConversations(): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(CONV_DIR);
  } catch {
    return; // dossier pas encore créé → rien à faire
  }
  await Promise.all(
    names
      .filter((n) => n.endsWith('.json'))
      .map((n) => fs.unlink(path.join(CONV_DIR, n)).catch(() => {})),
  );
}
```

#### B. Couche API — routes Next.js

Convention du repo (voir `web/app/api/sources/[slug]/route.ts` handler `DELETE` ligne 32,
`web/app/api/entities/[slug]/route.ts` ligne 17) : `export const dynamic = 'force-dynamic'`,
réponses via `Response.json(...)`, succès `{ ok: true }`, erreur `{ error }` + status.

- **`web/app/api/conversations/[id]/route.ts`** (n'a qu'un `GET` aujourd'hui). Ajouter
  l'import `deleteConversation` et le handler :

```ts
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await deleteConversation(params.id);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Suppression échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
```

- **`web/app/api/conversations/route.ts`** (a `GET` + `POST`). Ajouter l'import
  `deleteAllConversations` et le handler (DELETE sur la collection = « tout effacer ») :

```ts
export async function DELETE() {
  try {
    await deleteAllConversations();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Suppression échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
```

#### C. Couche UI — `web/components/chat/ConversationHistory.tsx`

Composant = dropdown « Historique » (bouton `History`). Il liste déjà les conversations
via `fetch('/api/conversations')` (useEffect à l'ouverture) et les mappe en `<li>`. La
liste a **déjà** sa scrollbar : `<ul className="max-h-80 space-y-0.5 overflow-y-auto">`.
Imports déjà présents et **réutilisés** : `useRouter`, `clearActiveConversationId`
(`@/lib/active-conversation`), `resetEphemeralKey` (`@/lib/chat-stream-store`), prop `currentId`.

Modifications :

1. **Imports** : compléter lucide-react → `import { History, Plus, X, Trash2 } from 'lucide-react';`
   et ajouter `import ConfirmDialog from '@/components/ConfirmDialog';`.

2. **État** : ajouter `const [confirmClear, setConfirmClear] = useState(false);`.

3. **Handlers** (retrait optimiste + rollback ; gestion de la conversation active) :

```tsx
async function deleteOne(id: string) {
  const prev = conversations;
  setConversations((cs) => cs.filter((c) => c.id !== id)); // optimiste
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    if (id === currentId) {
      clearActiveConversationId();
      resetEphemeralKey();
      router.push('/chat'); // on ne reste pas sur une conversation supprimée
    }
  } catch {
    setConversations(prev); // rollback si l'API échoue
  }
}

async function clearAll() {
  setConfirmClear(false);
  const prev = conversations;
  setConversations([]); // optimiste
  try {
    const res = await fetch('/api/conversations', { method: 'DELETE' });
    if (!res.ok) throw new Error();
    clearActiveConversationId();
    resetEphemeralKey();
    router.push('/chat');
  } catch {
    setConversations(prev);
  }
}
```

4. **Croix « × » par élément.** Aujourd'hui chaque `<li>` contient **un seul `<button>`
   pleine largeur** (navigation). Un `<button>` ne peut pas en contenir un autre →
   restructurer le `<li>` en `group relative` avec le bouton de navigation + un bouton de
   suppression **sibling** (pattern identique à `web/components/sources/SourceRow.tsx`
   lignes 20-68). Le bouton nav gagne `pr-8` pour ne pas chevaucher la croix ; la croix est
   **toujours visible** (gris discret → rouge au survol, pas d'`opacity-0` puisqu'on veut la
   découvrabilité dans ce petit panneau) :

```tsx
<li key={c.id} className="group relative">
  <button
    type="button"
    onClick={() => { setOpen(false); router.push(`/chat/${c.id}`); }}
    className={`flex w-full flex-col rounded-lg px-2 py-1.5 pr-8 text-left hover:bg-gray-100 ${
      c.id === currentId ? 'bg-gray-100' : ''
    }`}
  >
    <span className="truncate text-xs font-medium text-gray-800">{c.title}</span>
    <span className="text-[10px] text-gray-400">
      {new Date(c.updated_at).toLocaleDateString('fr-FR')}
    </span>
  </button>
  <button
    type="button"
    aria-label="Supprimer la conversation"
    title="Supprimer la conversation"
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteOne(c.id); }}
    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-600"
  >
    <X size={14} />
  </button>
</li>
```

5. **Bouton « Tout effacer » toujours visible.** Le placer **après le `</ul>`** (donc HORS
   de la zone scrollable `max-h-80 overflow-y-auto`) → il reste visible sans dérouler la
   liste. N'afficher que s'il reste des conversations. Restructurer le panneau ainsi :

```tsx
{open && (
  <div className="absolute left-0 top-8 z-40 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
    {conversations.length === 0 ? (
      <p className="px-2 py-3 text-xs text-gray-400">
        Aucune conversation enregistrée pour le moment.
      </p>
    ) : (
      <>
        <ul className="max-h-80 space-y-0.5 overflow-y-auto">
          {conversations.map((c) => ( /* <li> restructuré ci-dessus */ ))}
        </ul>
        <div className="mt-1 border-t border-gray-100 pt-1">
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={13} /> Tout effacer
          </button>
        </div>
      </>
    )}
  </div>
)}
```

6. **Confirmation « Tout effacer »** via `ConfirmDialog` (générique, déjà présent :
   `web/components/ConfirmDialog.tsx` — props `title`, `message`, `confirmLabel`,
   `onConfirm`, `onCancel` ; ferme sur Escape / clic hors carte). À monter dans le `return`
   du composant (positionnement `fixed`, l'emplacement DOM importe peu) :

```tsx
{confirmClear && (
  <ConfirmDialog
    title="Tout effacer"
    message="Supprimer définitivement toutes les conversations ? Cette action est irréversible."
    confirmLabel="Tout effacer"
    onConfirm={clearAll}
    onCancel={() => setConfirmClear(false)}
    danger
  />
)}
```

   **Sous-étape recommandée (élégance)** : `ConfirmDialog` a aujourd'hui un bouton de
   confirmation vert (`bg-[#0F6E56]`, lignes 64-69), inadapté à une action destructive.
   Ajouter une prop optionnelle `danger?: boolean` (défaut `false`) qui bascule ce bouton
   en rouge (`bg-red-600 hover:bg-red-700`, comme `DeleteSourceModal.tsx:91`). Rétro-compatible :
   l'appelant existant de `ConfirmDialog` (confirmation d'un nouveau type de lien à l'upload)
   n'est pas affecté. Si cette sous-étape est écartée, retirer la prop `danger` de l'appel
   ci-dessus (le bouton restera vert).

### Fichiers touchés (récap)

| Fichier | Changement |
|---------|-----------|
| `web/lib/conversations-store.ts` | + `deleteConversation`, `deleteAllConversations` |
| `web/app/api/conversations/[id]/route.ts` | + handler `DELETE` |
| `web/app/api/conversations/route.ts` | + handler `DELETE` (tout effacer) |
| `web/components/chat/ConversationHistory.tsx` | croix « × » par item + footer « Tout effacer » + confirmation + gestion conversation active |
| `web/components/ConfirmDialog.tsx` | (recommandé) + prop `danger` pour bouton rouge |
| `web/lib/__tests__/conversations-store.test.ts` | + tests des deux nouvelles fonctions |

Patterns réutilisés (à copier, ne rien réinventer) : `SourceRow.tsx` (bouton suppression
sibling), `DeleteSourceModal.tsx` + `api/entities/[slug]/route.ts` (gabarit route/fetch),
`ConfirmDialog.tsx` (confirmation), `writeJsonAtomic`/`fs.unlink` (`conversations-store.ts`).

---

## Décisions

- **Niveau de confirmation** — *arbitré avec l'utilisateur.*
  Retenu : **croix « × » = suppression immédiate sans confirmation ; « Tout effacer » = avec
  confirmation.** Alternative écartée : confirmer AUSSI chaque « × » (comme ChatGPT/Claude.ai) —
  rejetée par l'utilisateur pour la rapidité, en assumant le risque de clic accidentel (pas
  d'undo). Conséquence : le « × » doit rester assez petit/latéral pour limiter les clics
  involontaires (positionné `absolute right-1.5`, icône 14px).

- **Emplacement de « Tout effacer »** — sous la liste, **hors** de la zone scrollable
  (`overflow-y-auto`), pour rester visible sans dérouler. Répond littéralement à la demande
  « il faudrait pas aller tout en bas de la scroll bar ». Alternative écartée : mettre le
  bouton dans la barre d'en-tête à côté de « Nouvelle discussion » — moins conforme à la
  formulation (« en footer de cette scroll bar »).

- **Visibilité de la croix** — **toujours visible** (gris discret), et non révélée au survol
  comme dans `SourceRow.tsx` (`opacity-0 group-hover:opacity-100`). Raison : meilleure
  découvrabilité dans un petit dropdown, et l'utilisateur a décrit « une petite croix » (donc
  présente). Le survol ne sert qu'à colorer en rouge.

- **Suppression = `fs.unlink` direct, sans passer par le moteur `wiki-mutate`/`applyFileOps`** —
  légitime car les conversations vivent hors `wiki/`/`raw/` (règle cardinale n°1 du
  `CLAUDE.md` racine : l'historique de chat est le seul contenu autorisé hors markdown wiki).
  `applyFileOps` refuse d'ailleurs volontairement tout chemin hors `wiki/`/`raw/`. Une
  conversation = un seul fichier, aucune vue dérivée → pas de cascade.

- **« Tout effacer » = `DELETE /api/conversations` (collection)** plutôt qu'un endpoint dédié
  type `/api/conversations/clear` — plus RESTful et cohérent avec le repo.

- **Gestion de la conversation active** — si on supprime la conversation affichée (ou lors
  d'un « Tout effacer »), on appelle `clearActiveConversationId()` + `resetEphemeralKey()`
  puis `router.push('/chat')`, pour ne pas laisser l'utilisateur sur un fil inexistant.
  Ces helpers sont déjà importés dans `ConversationHistory.tsx`.

- **Retrait optimiste + rollback** — l'UI retire l'élément immédiatement puis restaure la
  liste si l'API échoue. Pattern déjà utilisé dans le repo (`SourceRow`/`SourceList`).

- **Point 1 (persistance) : rien à coder** — l'exploration a montré qu'elle est déjà garantie
  (fichiers JSON dans `userData`, stable et hors temp, écriture avant appel LLM). On se limite
  à la *démontrer* (tests + ferme/rouvre). Alternative écartée : « renforcer » la persistance —
  inutile, elle est correcte ; toucher au code de persistance introduirait un risque sans gain.

- **`deleteConversation` remonte les erreurs non-`ENOENT`** (permissions, etc.) pour que la
  route réponde 500 ; `ENOENT` (déjà absent) est traité comme un succès idempotent.

---

## Hors périmètre

- Corbeille / annulation (« undo ») d'une suppression.
- Suppression d'un **message** individuel à l'intérieur d'une conversation (la demande porte
  sur les *éléments d'historique* = les conversations entières).
- Persistance de la trace « étapes » (StepTrail) — non sérialisée par conception.
- Correction du cas dégradé de création de conversation (échec disque → fil non persisté).
- Toute modification du moteur `wiki-mutate` / de la persistance elle-même.

---

## Todo

> Contexte technique : tests via Node built-in runner — `cd web && npm test` exécute
> `node --import tsx --test "lib/__tests__/*.test.ts"`. Le fichier
> `lib/__tests__/conversations-store.test.ts` pointe `process.env.DATA_ROOT` vers un dossier
> temporaire **avant** le premier import et charge le module via `const load = () => import('../conversations-store')`.
> Reproduire exactement ce style (`node:test`, `node:assert/strict`) pour les nouveaux tests.

- [x] **1. Store : `deleteConversation` + `deleteAllConversations`** dans
  `web/lib/conversations-store.ts` (code fourni §Plan.A).
  *Vérif :* `cd web && npx tsc --noEmit` passe ; les fonctions sont exportées.

- [x] **2. Tests unitaires du store** dans `web/lib/__tests__/conversations-store.test.ts` :
  - `deleteConversation` supprime le fichier `<id>.json` (`fs.existsSync` faux après) et
    `getConversation` renvoie `null` ; idempotent sur un id inconnu (aucune exception).
  - `deleteAllConversations` : après avoir créé 2-3 conversations, la liste
    (`listConversations()`) est vide et le dossier ne contient plus de `.json` ; no-op si
    aucune conversation.
  *Vérif :* `cd web && npm test` → tous les tests (existants + nouveaux) passent.

- [x] **3. Route `DELETE /api/conversations/[id]`** dans
  `web/app/api/conversations/[id]/route.ts` (import + handler, code §Plan.B).
  *Vérif :* `npx tsc --noEmit` passe. Test manuel (app lancée, cf. étape 7) :
  `curl -X DELETE http://localhost:3000/api/conversations/<id-existant>` → `{"ok":true}`
  et le fichier disparaît de `.data/conversations/`.

- [x] **4. Route `DELETE /api/conversations`** (tout effacer) dans
  `web/app/api/conversations/route.ts` (import + handler, code §Plan.B).
  *Vérif :* `curl -X DELETE http://localhost:3000/api/conversations` → `{"ok":true}` ;
  `.data/conversations/` ne contient plus de `.json`.

- [x] **5. (Recommandé) Prop `danger` sur `ConfirmDialog`** (`web/components/ConfirmDialog.tsx`) :
  prop optionnelle `danger?: boolean` (défaut `false`) → bouton confirmer rouge
  (`bg-red-600 hover:bg-red-700`) au lieu de vert.
  *Vérif :* `npx tsc --noEmit` passe ; l'appelant existant de `ConfirmDialog` compile sans
  changement (prop optionnelle).

- [x] **6. UI `ConversationHistory.tsx`** : imports (`X`, `Trash2`, `ConfirmDialog`), état
  `confirmClear`, handlers `deleteOne`/`clearAll`, `<li>` restructuré avec croix « × »,
  footer « Tout effacer » hors scroll, montage `ConfirmDialog` (code §Plan.C).
  *Vérif :* `npx tsc --noEmit` + `npm run lint` passent ; aucun `<button>` imbriqué dans un
  `<button>` (le bouton « × » est bien sibling du bouton de navigation).

- [x] **7. Vérification bout en bout dans l'app** (`cd web && npm run dev`, ou app Electron) :
  - Créer 3 conversations avec quelques messages.
  - **Persistance (point 1)** : fermer puis rouvrir l'app / recharger → les 3 conversations
    et leurs messages sont toujours là.
  - Croix « × » sur une conversation → elle disparaît immédiatement ; recharger / rouvrir le
    dropdown → toujours absente (fichier réellement supprimé sur disque, vérifier
    `.data/conversations/`).
  - Supprimer la conversation **actuellement affichée** → redirection vers `/chat` vierge.
  - « Tout effacer » → la modale de confirmation s'affiche (bouton rouge si étape 5 faite) →
    confirmer → liste vide, état « Aucune conversation enregistrée ».
  - Rouvrir l'app → la liste est restée vide (suppression persistée).
  *Vérif :* tous les points ci-dessus observés ; joindre la preuve (comportement décrit /
  captures / sortie `ls .data/conversations`).

- [x] **8. Consigner les corrections éventuelles** dans `tasks/lessons.md` si l'utilisateur
  corrige un pattern pendant l'implémentation. *(Aucune correction utilisateur pendant
  l'implémentation → rien à consigner.)*

---

Fichier de spec : `tasks/specs/2026-07-23-suppression-historique-chat.md`

Commande à lancer dans une **session neuve** : `/implement @tasks/specs/2026-07-23-suppression-historique-chat.md`

---

## Bilan

### Ce qui a été fait (conforme au plan)

- **Store** (`web/lib/conversations-store.ts`) : ajout de `deleteConversation` (idempotent,
  remonte les erreurs non-`ENOENT`) et `deleteAllConversations` — code identique au §Plan.A.
- **Tests** (`web/lib/__tests__/conversations-store.test.ts`) : 2 nouveaux tests
  (`deleteConversation` supprime + idempotent ; `deleteAllConversations` vide + no-op).
  Exécutés isolément : **2/2 verts**.
- **Routes** : `DELETE /api/conversations/[id]` et `DELETE /api/conversations` (collection),
  gabarit `force-dynamic` + `Response.json({ ok: true })` / `{ error }` status 500.
- **ConfirmDialog** : prop optionnelle `danger?: boolean` (défaut `false`) → bouton rouge
  `bg-red-600 hover:bg-red-700`. Rétro-compatible (l'appelant existant compile sans changement).
- **UI** (`web/components/chat/ConversationHistory.tsx`) : croix « × » sibling (pas de bouton
  imbriqué), footer « Tout effacer » **hors** zone scrollable, `ConfirmDialog` en `danger`,
  retrait optimiste + rollback, redirection `/chat` si on supprime la conversation active.

### Preuves (vérification bout en bout)

Exécutée sur une **instance isolée** (copie de `web/` avec `DATA_ROOT` scratch + 3 conversations
semées sur disque = **zéro appel/coût IA**), build de prod `next start -p 3005` (Node 26 →
`build && start`, pas `next dev` ; **port 3000 d'une autre session laissé intact**), pilotée par
un vrai Chrome headless en CDP :

- `tsc --noEmit` : **vert** après chaque étape de code.
- Routes (curl) : `DELETE /[id]` → `{ok:true}`, fichier réellement supprimé, idempotent ;
  liste 3 → 2. `DELETE /` (collection) via l'UI → 0 fichier.
- **Persistance (point 1)** : kill + restart du serveur → les conversations restantes ET leurs
  messages survivent ; une suppression tient après redémarrage ; liste vide reste vide.
- **UI (vrai navigateur)** : dropdown liste 3 items + footer ; **aucun `<button>` imbriqué** ;
  croix supprime l'item + le fichier ; supprimer la conversation **active** redirige vers `/chat` ;
  modale « Tout effacer » s'affiche avec **bouton rouge** ; confirmer → « Aucune conversation
  enregistrée » + 0 fichier. **12/12 assertions vertes.**

### Déviations par rapport au plan

1. **`npm run lint` non exécutable** (étape 6) : le projet n'a **aucune config ESLint** —
   `next lint` déclenche une installation interactive. Contrôle non configuré dans le repo ;
   je ne l'ai pas ajouté (hors périmètre). Substitué par `tsc --noEmit` (vert) + l'invariant
   structurel « pas de `<button>` dans un `<button>` », **prouvé** dans le navigateur (assertion CDP).
2. **Suite complète `npm test`** : 113 tests verts, **1 échec préexistant et sans rapport** —
   `wiki-tools.test.ts` attend « 13 fiches » et en trouve 16, car 3 ressources ont été ajoutées
   par une autre session (`git status` : `finops-…`, `labor-market-…`, `le-finops-…`). Compteur
   codé en dur, cas déjà documenté dans `lessons.md` (2026-07-21). N'est pas causé par ce travail.
3. **Preuve UI non faite dans l'app Electron packagée** mais dans une instance web isolée pilotée
   en CDP — même code composant/route/store, coût IA nul, port de l'autre session préservé
   (recette `lessons.md` 2026-07-22). Le comportement Electron est identique (mêmes fichiers).
