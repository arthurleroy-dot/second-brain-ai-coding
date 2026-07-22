# Fiabiliser la déclaration d'entités/thèmes à l'upload (brouillons jamais perdus)

## Contexte

### Demande d'origine (utilisateur)
À l'upload d'une ressource, quand on **déclare** une entité avec un type de lien (ex. Julien Ye
en `personnes`, Septeo en `clients`) ou un **nouveau thème**, l'item n'apparaît **pas
directement** dans le graphe / les filtres / l'autocomplétion : il faut une **confirmation
manuelle** dans la page Entités (ou Thèmes) pour qu'il devienne réellement une entité/thème
du wiki. En revanche, déclarer un item **déjà connu** fonctionne. L'utilisateur veut :
**déclaré à l'upload = créé directement**, sans confirmation, entités **et** thèmes.

### Contrat voulu (docs/entities.md §4 « confiance graduée »)
- **Déclaré à la main** (bloc `links:` / `themes:` du sidecar) → créé DIRECTEMENT : fiche
  registre + nœud graphe + arête + présence immédiate dans filtres et autocomplétion. **Jamais
  de candidate pour un item déclaré.**
- **Détecté par l'IA** dans la prose et inconnu → *candidate* dans `wiki/entities/_candidates.json`
  (resp. `wiki/themes/_candidates.json`) → confirmation manuelle.
- **Connu** → simple lien.

### Cause racine (PROUVÉE par inspection code + données disque)

**Cause unique et suffisante : perte silencieuse du brouillon au submit (100 % côté client).**

Dans `LinkPicker`/`ThemePicker`, un nom **tapé** dans le champ vit dans un état LOCAL du
picker (`drafts: Record<string,string>` — LinkPicker.tsx:61 ; `draft: string` —
ThemePicker.tsx:32) et ne rejoint la valeur remontée au parent (`onChange`) **que** si
l'utilisateur presse `+` ou Entrée (`commitDraft`). Taper un nom puis cliquer directement
« Déposer → » **perd le brouillon** : il n'entre jamais dans l'état `links`/`themes` lu par
`submit()` (UploadForm.tsx:146-218), donc jamais dans le `FormData`, donc jamais dans le
sidecar `raw/<file>.meta.md` lu par le moteur d'ingestion.

**Pourquoi « connu marche / nouveau non » :** un item **connu** a une puce cliquable
(`+ Label`, LinkPicker.tsx:237-250 / ThemePicker.tsx:108-121) qui valide en **un clic** ; un
item **nouveau** n'a pas de puce → il faut le **taper** → exposé à l'oubli de validation. La
vraie variable n'est pas « type de lien nouveau » mais **tapé-non-validé vs cliqué**.

**Conséquence en aval :** sans déclaration dans le sidecar, l'item ne peut exister que si l'IA
le **détecte** dans le texte → il tombe dans la file de candidats → confirmation manuelle
obligatoire. C'est exactement le symptôme.

**Preuve matérielle (état disque au 2026-07-22) :**
- `raw/note.txt.meta.md` (→ ressource `note-avec-julien-ye-septeo`) contient un thème **connu
  cliqué** (`themes: [transformation-organisationnelle]`) mais **AUCUN bloc `links:`**, alors
  que l'utilisateur pensait avoir déclaré Julien Ye et Septeo.
- `raw/note-3.txt.meta.md` (→ `theme-des-du-harness-engineering`) : **aucun** `themes:` malgré
  un contenu « thème des du harness engineering ».
- Julien Ye / Septeo ont dû être **confirmés à la main** après coup : leurs fiches
  `wiki/entities/{julien-ye,septeo}.md` portent la signature du chemin confirmation
  (`aliases: ["Julien Ye"]` / `["Septeo"]`, frontmatter ressource `entities: []`, lien
  **chunk-only** `` `entities: [julien-ye, septeo]` `` — la création directe produirait
  `aliases: []` et forcerait aussi le frontmatter). Jean Baptiste n'a **jamais** été confirmé :
  il n'existe que comme *candidate* `pending` dans `_candidates.json` et comme **nœud
  ressource** (pas `entity:`) dans `graph.json` → absent des filtres/autocomplétion.

La chaîne `submit → /api/upload (parseLinks/parseThemes, route.ts:55-116) → buildSidecar
(route.ts:118-161)` est un **pass-through de chaînes sans filtrage** : une valeur validée
atteint TOUJOURS le sidecar. Donc l'état `links`/`themes` était vide au submit = brouillon non
validé.

**Le moteur d'ingestion est sain.** Le « chantier 5 » (`forceDeclaredLinks` dans
`web/lib/ingest-local.ts`) force déjà toute déclaration du sidecar dans le frontmatter et crée
directement fiche + nœud + arête ; couvert par le test `chantier 5`
(web/lib/__tests__/ingest-local.test.ts:480-543). **Aucune modification serveur/moteur
nécessaire.**

### Résultat attendu
Taper un nom d'entité ou de thème à l'upload puis « Déposer → » suffit : l'item est déclaré,
écrit dans le sidecar, créé directement par le moteur, présent immédiatement dans filtres +
autocomplétion + graphe, **sans** entrée en « En attente de décision ». Vrai pour entités ET
thèmes.

## Plan

> Contenu intégral du plan validé.

### Approche retenue
Garantir qu'un nom **tapé mais non validé** ne soit jamais perdu au « Déposer → », pour les
deux pickers, via le pattern React canonique `useImperativeHandle` + `flush()`. `flush()`
retourne **synchronement** la valeur fusionnée (`value` + brouillon) que `submit()` utilise
**dans le même tick** pour bâtir le FormData, sans dépendre d'un re-render.

Patterns écartés (voir `## Décisions`).

### 1. Helpers de fusion purs et testables — nouveau `web/lib/upload-drafts.ts`
Extraire la logique aujourd'hui dans `add` (trim, ignore vide, dédup insensible à la casse ;
**pas** de slugify — le serveur slugifie) :
- `mergeLinkDrafts(value: LinksValue, drafts: Record<string,string>): LinksValue` — pour chaque
  `[type, raw]` de `drafts`, trim ; si non vide et pas déjà présent (comparaison `toLowerCase`),
  append au tableau du type ; retourne un nouvel objet. Types sans brouillon inchangés.
- `mergeThemeDraft(value: string[], draft: string): string[]` — même règle, liste plate.
- (option DRY) `addName(list: string[], name: string): string[]` réutilisé par les `add` des
  deux pickers.

`LinksValue` = `Record<string, string[]>` (exporté depuis `LinkPicker.tsx:20`).

### 2. `web/components/upload/LinkPicker.tsx`
- Exporter `export type LinkPickerHandle = { flush: () => LinksValue }`.
- Passer le composant en `forwardRef` (ou `ref` en prop selon la version React du repo).
- `useImperativeHandle(ref, () => ({ flush }), [value, drafts])` avec :
  ```
  const flush = () => {
    const merged = mergeLinkDrafts(value, drafts);
    onChange(merged);   // cohérence UI (les brouillons deviennent des puces)
    setDrafts({});
    return merged;      // valeur synchrone consommée par submit()
  };
  ```
- Refactor `commitDraft` (l.121-124) et `add` (l.106-112) pour réutiliser les helpers de
  l'étape 1 (comportement inchangé).
- **Ne PAS flusher `addMode`/`newType`/`pendingType`** : un **nouveau TYPE de lien** à moitié
  saisi reste gardé par `ConfirmDialog` — on ne crée jamais un type en douce au submit (à
  documenter en commentaire). Un type ouvert (`openTypes`) sans brouillon ni entité validée ne
  produit rien dans `merged` ; `submit` filtre déjà les types vides via `if (names.length)`
  (l.194), donc aucune clé `links` vide n'est émise.

### 3. `web/components/upload/ThemePicker.tsx`
Symétrique :
- `export type ThemePickerHandle = { flush: () => string[] }`.
- `forwardRef` + `useImperativeHandle(ref, () => ({ flush }), [value, draft])` avec
  `flush = () => { const m = mergeThemeDraft(value, draft); onChange(m); setDraft(''); return m; }`.
- `commitDraft` (l.49-52) / `add` (l.41-46) réutilisent les helpers.

### 4. `web/components/upload/UploadForm.tsx`
- Importer les types de handle ; `const linkRef = useRef<LinkPickerHandle>(null)` et
  `const themeRef = useRef<ThemePickerHandle>(null)`.
- Passer `ref={linkRef}` / `ref={themeRef}` au rendu des pickers (l.427-432 et l.434-439).
- Dans `submit()`, **avant** la construction du FormData (avant l.177) :
  ```
  const mergedLinks  = linkRef.current?.flush()  ?? links;
  const mergedThemes = themeRef.current?.flush() ?? themes;
  ```
- **Remplacer TOUTES** les lectures d'état par les valeurs fusionnées dans la construction du
  FormData (point critique — un oubli re-masquerait un item issu d'un brouillon seul) :
  - l.189 `hasLinks` → `const anyLinks = Object.values(mergedLinks).some(n => n.length)`.
  - l.193 boucle `Object.entries(links)` → `Object.entries(mergedLinks)`.
  - l.201 `hasThemes` → `const anyThemes = mergedThemes.length > 0` ; l.202 `themes` → `mergedThemes`.
  - `linkGranularity` / `themesGranularity` restent lus depuis l'état parent (défaut `auto`,
    inchangés — la granularité par type reste valable pour un type dont l'entité vient d'un
    brouillon).

  Le FormData est bâti à partir des valeurs **retournées par `flush()`**, pas de l'état
  `links`/`themes` (qui ne sera à jour qu'au prochain render).

### 5. Garde-fou UX léger (non bloquant)
Sous l'input de chaque picker, une ligne d'aide conditionnée à un brouillon non vide, dans le
style existant (`text-[11px] text-gray-400`) :
- LinkPicker (après le bloc input l.230, par type) :
  `{drafts[type]?.trim() && <p>« {drafts[type].trim()} » sera pris en compte au dépôt.</p>}`
- ThemePicker (après l'input l.101) : idem avec `draft`.

Ne modifie pas le flux puce/Entrée/`+`.

### 6. Tests
- **Nouveau** `web/lib/__tests__/upload-drafts.test.ts` (`node:test`, ramassé par `npm test`),
  couvrant les helpers de l'étape 1 :
  - brouillon tapé non validé → présent dans le résultat fusionné ;
  - dédup insensible à la casse (« Septeo » déjà présent → pas de doublon) ;
  - brouillon vide/espaces → ignoré ;
  - multi-types LinkPicker : chaque type fusionne son propre brouillon ; type ouvert sans
    brouillon → clé absente ;
  - thèmes : brouillon fusionné à une liste vide → liste à 1 élément.
- **Existant** `ingest-local.test.ts` `chantier 5` (l.480-543) : couvre déjà l'aval
  (déclaration sidecar → fiche+nœud+arête, hors file). **Aucune adaptation nécessaire.**
- Pas de test de rendu React (voir `## Décisions` : pas d'infra jsdom).

### Purge des notes de test (repartir propre)
Suppression via le **chemin sanctionné** du moteur déterministe (respecte l'immuabilité de
`raw/` : supprimer une ressource retire aussi son fichier brut + sidecar + entrée manifeste).
Utiliser l'app lancée (UI de suppression), ou scripter directement les mêmes fonctions/routes.

Ordre (ressources d'abord, entités ensuite) :
1. `DELETE /api/sources/note-avec-julien-ye-septeo` → `deleteResource` (web/lib/wiki-mutate.ts:782).
2. `DELETE /api/sources/note-avec-jean-baptiste`.
3. `DELETE /api/sources/theme-des-du-harness-engineering`.
4. `DELETE /api/entities/julien-ye` puis `DELETE /api/entities/septeo` → `deleteEntity`
   (web/lib/wiki-mutate.ts:1044) (orphelines 0 mention après étape 1).
5. Vérifier `wiki/entities/_candidates.json` : purger l'entrée **« Jean Baptiste »**
   (`normalized: "jean baptiste"`) si elle n'a pas été retirée par la suppression de sa
   ressource (`purgeCandidate`, web/lib/wiki-mutate.ts:314).
6. Contrôle final : `raw/note*.txt` + sidecars, `wiki/resources/note-*.md`,
   `wiki/entities/{julien-ye,septeo}.md` absents ; `wiki/graph.json`, `wiki/_ingested.json`,
   `wiki/by-date/2026/*`, `wiki/index.md` sans trace des slugs supprimés ; `npm run wiki:verify` vert.

### Fichiers concernés
| Fichier | Action |
|---|---|
| `web/lib/upload-drafts.ts` | **nouveau** — helpers de fusion purs |
| `web/lib/__tests__/upload-drafts.test.ts` | **nouveau** — tests des helpers |
| `web/components/upload/LinkPicker.tsx` | `forwardRef` + `flush()` + refactor `add`/`commitDraft` + hint |
| `web/components/upload/ThemePicker.tsx` | idem (symétrique) |
| `web/components/upload/UploadForm.tsx` | refs + `flush()` au submit + lecture des valeurs fusionnées |
| données wiki + `raw/` | purge des 3 notes de test via `deleteResource`/`deleteEntity` |

### Vérification de bout en bout (sans clé IA)
1. `cd web && npm test` → nouveau test helper vert + suite `chantier 5` toujours verte ;
   `npm run wiki:verify` vert après purge.
2. `npm run build && npm start` (⚠️ `next dev` plante sous Node 26 — cf. tasks/lessons.md ;
   utiliser `build && start`), ouvrir `/upload` : taper un nom d'entité sous un type de lien
   **et** un thème, **sans** presser `+`/Entrée, puis « Déposer → ».
3. **Preuve directe** : inspecter le sidecar écrit `raw/<file>.meta.md` (via `applyFileOps`
   route.ts:232) — il doit contenir le bloc `links:` (slugs `julien-ye`, `septeo`) et/ou
   `themes:`. La saisie n'est plus perdue.
4. Laisser l'ingestion finir (si clé dispo) : l'entité/thème apparaît **directement** dans les
   filtres (`/api/entities`), l'autocomplétion du prochain upload et le graphe, **sans** entrée
   en « En attente de décision ». Le chantier 5 le garantit dès que le sidecar porte la déclaration.

## Décisions

- **Périmètre = robustesse de la déclaration uniquement** (choix utilisateur). On corrige la
  cause racine (brouillon perdu), pour entités ET thèmes. On ne touche ni au moteur d'ingestion
  (déjà sain) ni aux sources de vérité multiples (voir Hors périmètre).
- **Pattern de flush : `useImperativeHandle` + `flush()` (option c).** Alternatives évaluées :
  - **(a) `onBlur → commitDraft`** — *rejeté*. Course non déterministe : au `mousedown` sur
    « Déposer », le `blur` déclenche `setState`/`onChange` (asynchrone, batché) ; le `onClick`
    du bouton lit ensuite `links`/`themes` depuis la closure du render courant = valeur PÉRIMÉE
    (le re-render post-blur n'a pas eu lieu). En prime, commits fantômes à chaque perte de focus.
  - **(b) Remonter `drafts`/`draft` dans UploadForm (lifting state up)** — *fonctionne mais
    inférieur*. Fait fuiter la sémantique de fusion (trim/dédup) et deux formes de brouillon
    hétérogènes (`Record<type,string>` vs `string`) dans le parent ; couple le parent aux
    internes des pickers ; re-render parent à chaque frappe.
  - **(c) `useImperativeHandle` + `flush()`** — *retenu*. `flush()` calcule et retourne
    SYNCHRONEMENT la valeur fusionnée, la commit dans l'état du picker pour cohérence UI, et
    `submit()` bâtit le FormData sur la valeur RETOURNÉE — sans course, sans re-render.
    Encapsulation dans le picker, symétrique pour les deux, usage canonique (équivalent du
    `getValues()` des libs de formulaire).
- **Extraction de helpers purs (`upload-drafts.ts`)** plutôt que logique inline : rend la
  fusion testable sans DOM et supprime la duplication avec `add`.
- **Pas de test de rendu React.** Le repo n'a PAS de jsdom/testing-library/jest/vitest
  (`npm test` = `node --test` sur `web/lib/__tests__/*.test.ts` uniquement). En ajouter serait
  de la sur-ingénierie. Couverture = helper pur (seam d'entrée) + chantier 5 (seam de sortie) ;
  le maillon `submit → parseLinks → buildSidecar` est un pass-through de chaînes déjà éprouvé.
- **Purge des notes de test = OUI** (choix utilisateur), via le chemin sanctionné
  `deleteResource`/`deleteEntity` (jamais de suppression manuelle de `raw/`).
- **Garde-fou UX = simple ligne d'aide conditionnelle**, pas de chip provisoire ni de blocage
  du submit (sobriété, pas de sur-ingénierie).

## Hors périmètre

- **Unification des sources de vérité des entités.** Il subsiste 4 représentations lues par des
  surfaces différentes : `wiki/entities/*.md` (filtres + autocomplétion via `listEntities`,
  qui saute les fichiers `_*`), `wiki/entities/_candidates.json` (« En attente »), `graph.json`
  (graphe), et le champ `entities` des ressources `wiki/resources/*.md` (matching réel du
  filtre). Fragilité structurelle réelle mais NON cause du bug rapporté (résolu par la
  robustesse de la déclaration) → chantier ultérieur si des incohérences d'affichage
  réapparaissent.
- **Modification du moteur d'ingestion / du format sidecar.** Inutile : le correctif est
  100 % côté client. Le chantier 5 (`forceDeclaredLinks`) fonctionne déjà.
- **Tests de rendu React / ajout d'infra jsdom.**
- **Re-dépôt automatisé des notes purgées.** L'utilisateur re-testera manuellement s'il le
  souhaite (nécessiterait la clé IA de la gateway).

## Todo

- [x] **1. Créer `web/lib/upload-drafts.ts`** avec `mergeLinkDrafts`, `mergeThemeDraft` (et
  `addName` si DRY). Sémantique identique à `add` actuel : trim, ignore vide, dédup
  insensible à la casse, pas de slugify.
  *Vérif :* le fichier compile (`cd web && npx tsc --noEmit`) ; signatures conformes aux types
  `LinksValue`.
- [x] **2. Écrire `web/lib/__tests__/upload-drafts.test.ts`** (node:test) couvrant : brouillon
  non validé fusionné, dédup casse-insensible, vide/espaces ignoré, multi-types (type sans
  brouillon → clé absente), thème fusionné à liste vide.
  *Vérif :* `cd web && npm test` → ce test passe (rouge attendu si les helpers sont vides, vert
  une fois l'étape 1 finie).
- [x] **3. Modifier `LinkPicker.tsx`** : `LinkPickerHandle` exporté, `forwardRef`,
  `useImperativeHandle` avec `flush()` (deps `[value, drafts]`), refactor `add`/`commitDraft`
  via helpers, commentaire « ne pas flusher `newType`/`pendingType` ».
  *Vérif :* `npx tsc --noEmit` OK ; relecture : `flush()` retourne `mergeLinkDrafts(value, drafts)`
  ET vide `drafts`.
- [x] **4. Modifier `ThemePicker.tsx`** symétriquement (`ThemePickerHandle`, `forwardRef`,
  `flush()` deps `[value, draft]`, helpers).
  *Vérif :* `npx tsc --noEmit` OK.
- [x] **5. Modifier `UploadForm.tsx`** : `linkRef`/`themeRef`, `ref=` sur les pickers, appel
  `flush()` en tête de `submit()`, remplacement de TOUTES les lectures `links`/`themes`/
  `hasLinks`/`hasThemes` par `mergedLinks`/`mergedThemes` dans la construction du FormData.
  *Vérif :* `npx tsc --noEmit` OK ; grep dans `submit()` : plus aucune lecture directe de
  `links`/`themes` après l'appel `flush()` pour bâtir le FormData.
- [x] **6. Ajouter le garde-fou UX** (ligne d'aide conditionnelle au brouillon non vide) dans
  les deux pickers.
  *Vérif :* rendu manuel `/upload` : taper un nom sans valider → le message apparaît ; le vider
  → il disparaît. **(Voir Bilan : vérifié par inspection + tsc, pas en navigateur — conditionnel
  trivial `{draft.trim() && <p>…</p>}`.)**
- [x] **7. Vérification E2E code (sans clé IA)** : `npm run build && npm start`, `/upload`,
  taper une entité + un thème **sans valider**, « Déposer → », puis inspecter le sidecar
  `raw/<file>.meta.md` écrit.
  *Vérif :* le sidecar contient le bloc `links:` (slugs attendus) et/ou `themes:` — preuve que
  la saisie n'est plus perdue. **(Voir Bilan : port 3000 occupé par une autre session + upload
  réel = ingestion payante → prouvé via le VRAI handler `POST /api/upload` sur `DATA_ROOT` isolé
  + verrou pré-posé, FormData issue des vrais helpers de fusion. Sidecar écrit : `links:
  personnes: [julien-ye]` / `clients: [septeo]` + `themes: [harness-engineering]`, 0 coût.)**
- [x] **8. Purger les notes de test** (Julien Ye/Septeo, Jean Baptiste, harness engineering)
  via `deleteResource` (3 ressources) puis `deleteEntity` (julien-ye, septeo), puis purge du
  candidat « Jean Baptiste » si orphelin.
  *Vérif :* `raw/note*.txt`(+sidecars), `wiki/resources/note-*.md`,
  `wiki/entities/{julien-ye,septeo}.md` absents ; aucun `entity:julien-ye|septeo` ni
  `resource:note-*` dans `graph.json` ; entrées correspondantes absentes de `_ingested.json`
  et `_candidates.json` ; `npm run wiki:verify` vert. **(FAIT + nettoyage supplémentaire du thème
  fantôme « harness-engineering » — voir Bilan. Grep exhaustif : 0 trace résiduelle.)**
- [x] **9. Suite complète verte** : `cd web && npm test` (tous les tests, dont `chantier 5`) +
  `npm run wiki:verify`.
  *Vérif :* sorties vertes ; comparer au besoin avec `main`. **(112 pass / 0 fail ; wiki:verify vert.)**
- [x] **10. Consigner la leçon** dans `tasks/lessons.md` : « Un champ à validation explicite
  (`+`/Entrée) perd sa saisie si l'utilisateur soumet sans valider ; au submit, flusher les
  brouillons via `useImperativeHandle`/`flush()` et bâtir le payload sur la valeur RETOURNÉE,
  jamais sur l'état (pas encore re-rendu). »
  *Vérif :* entrée datée 2026-07-22 présente dans `tasks/lessons.md`. **(+ 2e leçon sur le thème
  fantôme non nettoyé par `deleteResource`.)**

---

Fichier créé : `tasks/specs/2026-07-22-fiabiliser-declaration-upload.md`
Commande pour la session d'implémentation : `/implement @tasks/specs/2026-07-22-fiabiliser-declaration-upload.md`

## Bilan

### Ce qui a été fait (conforme au plan)
- **Helpers de fusion purs** `web/lib/upload-drafts.ts` (`addName`, `mergeLinkDrafts`,
  `mergeThemeDraft`) + **7 tests** `upload-drafts.test.ts` (brouillon non validé fusionné, dédup
  casse-insensible, vide/espaces ignoré, multi-types avec type-sans-brouillon → clé absente,
  thème fusionné à liste vide). Tous verts.
- **`LinkPicker` / `ThemePicker`** passés en `forwardRef` + `useImperativeHandle` exposant
  `flush()` (retour SYNCHRONE de la valeur fusionnée, `deps [value, drafts]` / `[value, draft]`) ;
  `add`/`commitDraft` refactorés via les helpers ; commentaire « ne pas flusher `newType`/
  `pendingType` ».
- **`UploadForm`** : `linkRef`/`themeRef`, `ref=` sur les pickers, `flush()` en tête de la
  construction du FormData, TOUTES les lectures d'état (`hasLinks`/`hasThemes`/`links`/`themes`)
  remplacées par `mergedLinks`/`mergedThemes`. Les consts dérivées obsolètes (`hasLinks`/
  `hasThemes`) supprimées (plus de code mort).
- **Garde-fou UX** : ligne d'aide `« … » sera pris en compte au dépôt.` sous chaque champ quand
  un brouillon non vide est présent.
- **Purge** des 3 notes de test + 2 entités + candidat « Jean Baptiste », via le chemin sanctionné
  (`deleteResource`/`deleteEntity`/`purgeCandidate`), validée sur COPIE scratch avant application.

### Déviations (et pourquoi)
1. **Nettoyage du thème fantôme « harness-engineering » (hors périmètre initial de l'étape 8).**
   La 3ᵉ note liait ce thème en **chunk-only** (`topics: []` au frontmatter). `deleteResource` ne
   nettoie que les thèmes du frontmatter et « ne supprime jamais un fichier thème » → la purge
   littérale aurait laissé un thème vide (fichier + nœud graphe + ligne d'index) pointant vers une
   ressource supprimée, **malgré un `wiki:verify` vert**. Signalé et **arbitré avec toi**
   (« Nettoyage complet »). Retrait ajouté : `delete` du fichier thème + nœud/arêtes `theme:` via
   `parseGraph`/`serializeGraph` + ligne d'`index.md`. Validé sur copie (verify vert + grep 0 trace)
   puis appliqué. **Note de fond :** c'est une manifestation de la fragilité « 4 sources de vérité »
   déjà listée en Hors périmètre — non traitée ici au-delà de ce cas précis.
2. **Preuve E2E par le handler serveur plutôt que par un navigateur (étape 7).** Le port 3000
   était occupé par une autre session (`next-server` vivant → interdit de rebâtir le `.next`
   partagé, cf. lessons) et l'upload réel déclenche l'ingestion payante. Preuve produite en
   pilotant le **vrai `POST /api/upload`** sur `DATA_ROOT` isolé + `ingest.lock` pré-posé
   (`runIngestion()` no-op, 0 coût), avec une FormData issue des **vrais helpers de fusion** (ce que
   `flush()` retourne). Le sidecar écrit sur disque contient `links:`/`themes:` attendus. Le seul
   maillon non exercé au runtime est l'appel React `ref.flush()` au clic — pattern standard
   `useImperativeHandle` vérifié par tsc. **Le pilotage navigateur complet (CDP) reste disponible
   si tu veux la confirmation visuelle** (hint + clic).

### Preuves
- `cd web && npx tsc --noEmit` → OK. `cd web && npm test` → **112 pass / 0 fail**.
- `npm run wiki:verify` (vrai wiki) → **vert**. Grep des slugs supprimés dans `wiki/` → **0 trace**.
- Ressources : 16 → **13** (le test « 13 fiches » repasse). `raw/note*.txt` + sidecars : **absents**.
- Sidecar de preuve écrit sur `DATA_ROOT` isolé (0 coût) :
  `links:\n  personnes: [julien-ye]\n  clients: [septeo]` + `themes: [harness-engineering]`.
