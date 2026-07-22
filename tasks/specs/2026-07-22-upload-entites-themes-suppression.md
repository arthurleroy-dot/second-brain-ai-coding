# Corrections upload (entités / thèmes) + suppression d'entités

## Contexte

Pendant les tests locaux (upload de notes perso via `/upload`, puis suppression),
l'utilisateur a relevé 5 problèmes, tous confirmés par lecture du code :

1. **Entités fantômes.** Supprimer une ressource ne supprime jamais ses entités. Deux
   entités orphelines subsistent (`wiki/entities/jean-baptiste.md`,
   `wiki/entities/julien-ye.md`), et il n'existe **aucun** moyen de supprimer une entité
   depuis l'app (seules les ressources sont supprimables).
2. **Granularité des thèmes hors cadre.** À l'upload, le réglage de granularité des thèmes
   s'affiche SOUS la boîte « Thèmes » au lieu d'être dedans (contrairement aux liens, où la
   granularité est dans chaque carte).
3. **« Une seule entité par type de lien ».** L'utilisateur ne parvenait à associer qu'une
   entité par type. En réalité le modèle est déjà un tableau ; le problème est ergonomique :
   le seul moyen d'ajouter est *taper + Entrée*, non devinable et peu fiable (la touche
   Entrée est souvent avalée quand la datalist d'autocomplétion est ouverte).
4. **« Un seul nouveau thème ».** Idem pour les thèmes.
5. **Validation.** Les entités déclarées à l'upload ne sont PAS créées directement : elles
   passent par la file d'attente et n'apparaissent qu'après confirmation manuelle sur la page
   Entités. L'utilisateur veut : déclaré à la main = créé directement ; file d'attente
   réservée aux détections de l'IA (entité non déclarée / alias). Idem pour un nouveau type de lien.

Demande d'origine (verbatim utilisateur, reformulée pour la spec) : supprimer les entités
Jean-Baptiste et Julien restées après suppression de notes ; mettre la granularité du thème
DANS le cadre ; ajouter un bouton `+` pour associer plusieurs entités à un type de lien ;
pouvoir écrire plusieurs nouveaux thèmes (même UI) ; et faire que déclarer une entité (ou un
type de lien) à l'upload la crée directement sans passer par la validation.

**Environnement d'exécution (À LIRE avant d'implémenter/vérifier) :**
- Runtime : **Node 26** installé (Homebrew, seule version ; pas de nvm). `next dev` **plante**
  sous Node 26 (`MODULE_NOT_FOUND` dans le bundler dév). Pour lancer/tester l'app :
  `cd web && rm -rf .next && npm run build && npm run start` (port 3000). Les changements d'UI
  nécessitent un **rebuild** (pas de HMR en prod). Cf. `tasks/lessons.md` (entrée 2026-07-21).
  Serveur détaché conseillé : `nohup npm run start > /tmp/srv.log 2>&1 &` (le suivi de tâches
  d'arrière-plan a tué des serveurs précédents ; `setsid` n'existe pas sur macOS).
- Clé IA : la gateway LiteLLM n'est **pas** configurée dans `web/.env.local` (variables vides).
  L'ingestion réelle (qui appelle l'IA) est donc indisponible sans clé. **Les chantiers 1-4 et
  le chantier 5 sont vérifiables SANS clé** (UI + suppression sur disque + test unitaire `ingestOne`
  qui n'appelle pas le modèle).
- Config résolution imports (`web/tsconfig.json`) : `paths: { "@/*": ["./*"] }`, `baseUrl` absent.
  Les modules internes utilisent `@/lib/...` ; `wiki-project.ts` importe ses voisins en relatif
  (`./wiki-mutate`).

## Plan

> Contenu intégral du plan validé.

### Diagnostic vérifié (source de vérité pour l'implémenteur)

- Suppression de ressource : `deleteResource` (`web/lib/wiki-mutate.ts:856-861`) ne fait que
  retirer le bloc `### [[..]]` des Mentions de l'entité ; commentaire explicite « Registre =
  jamais delete ». Le graphe (`wiki-mutate.ts:877-897`) purge les nœuds orphelins auteurs/dates/types
  mais **jamais** les nœuds entités. D'où les orphelines. Il n'existe AUCUNE fonction/route de
  suppression d'entité (`grep -riE "deleteEntity|removeEntity"` → 0 ; seul `DELETE` de l'API =
  `web/app/api/sources/[slug]/route.ts` pour les ressources).
- Les 2 orphelines : `wiki/entities/jean-baptiste.md`, `wiki/entities/julien-ye.md` (validées,
  PAS candidates). Références résiduelles : uniquement leurs 2 nœuds `graph.json`
  (`{"id":"entity:jean-baptiste",...}`, `{"id":"entity:julien-ye",...}`), aucune arête, aucune
  ressource citante, absentes de `_candidates.json` et de tout index → totalement orphelines.
- Granularité thème hors boîte : le `<select>` est rendu par le parent APRÈS `<ThemePicker/>`
  (`web/components/upload/UploadForm.tsx:419-438`), donc sous la boîte. Les liens, eux, ont la
  granularité DANS chaque carte (`web/components/upload/LinkPicker.tsx:238-251`).
- Multi-valeurs déjà supportées côté données : `LinksValue = Record<string,string[]>`
  (`LinkPicker.tsx:20`, `add` append `106-112`) ; thèmes `string[]` (`ThemePicker.tsx`, `add` `33-38`).
  Ajout uniquement via Entrée (`LinkPicker.tsx:207-213`, `ThemePicker.tsx:70-76`). Pas de bug de
  données → correctif = bouton `+` explicite.
- Le vrai bug de validation (chantier 5) : dans `ingestOne`, la création des fiches ET des nœuds
  d'entités itère sur `meta.entities` = le frontmatter de la ressource **générée par l'IA**
  (`web/lib/wiki-project.ts:509` boucle entités, `:569` boucle graphe ; `ingest-local.ts:562,567,577`).
  Rien ne force les entités DÉCLARÉES à exister. Si l'IA ne recopie pas fidèlement la déclaration
  (nom complet, alias, oubli), la fiche n'est pas créée et l'item peut retomber en candidate.
  **Preuve croisée** : `createEntityPage` (chemin ingestion, `wiki-project.ts:348-355`) produit
  `aliases: []` pour une déclarée-nouvelle ; `applyEntityDecision` create (chemin confirmation,
  `wiki-mutate.ts:601-609`) produit `aliases: [<nom>]`. `julien-ye.md` porte `aliases: ["Julien Ye"]`
  → il vient du chemin confirmation (donc est passé par la file d'attente).

### Chantier 1 — Suppression d'entités (nettoyage + fonctionnalité réutilisable)

**1a. Nettoyage immédiat des 2 orphelines.** Lot `applyFileOps` : `delete: true` sur
`wiki/entities/jean-baptiste.md` et `wiki/entities/julien-ye.md` + retrait des 2 nœuds
`entity:jean-baptiste` / `entity:julien-ye` de `wiki/graph.json` (aucune arête, aucune autre
référence — vérifié). À faire via la nouvelle fonction 1b (dogfooding).

**1b. `deleteEntity` déterministe** dans `web/lib/wiki-mutate.ts` (miroir de `deleteResource`) :
- `delete: true` sur `wiki/entities/<slug>.md`.
- `graph.json` : retirer le nœud `entity:<slug>` + toute arête `target === entity:<slug>`
  (réutiliser `parseGraph` + filtres, cf. `wiki-mutate.ts:877-897`).
- Pour chaque ressource citante (lue depuis les blocs `### [[../resources/<r>]]` de la section
  `## Mentions` de l'entité) : retirer le slug du frontmatter `entities:` de `wiki/resources/<r>.md`
  et l'arête de mention. Pour une orpheline (0 mention) → seulement fichier + nœud.
- Purger l'entrée éventuelle dans `wiki/entities/_candidates.json` (réutiliser le pattern
  `purgeCandidate`, `wiki-mutate.ts:314`).
- Signature `{ slug, entityContent, graph, referencingResources? }` renvoyant `FileOp[]`
  (ne rien écrire, l'appelant applique).

**1c. Route `DELETE /api/entities/[slug]/route.ts`** (miroir de
`web/app/api/sources/[slug]/route.ts`) : valide le slug (regex `^[a-z0-9-]+$`), lit l'entité +
graph + ressources citantes, appelle `deleteEntity`, applique via `applyFileOps`, renvoie
`{ ok: true }` (404 si entité absente). NB : `web/app/api/entities/route.ts` actuel n'expose que `GET`.

**1d. Bouton « Supprimer » dans l'UI** : sur la fiche entité et/ou la liste
`web/components/entities/EntitiesView.tsx`, réutiliser `web/components/ConfirmDialog.tsx`
(déjà utilisé par `LinkPicker`) ; appel `fetch(..., { method: 'DELETE' })` vers la route, puis
rafraîchir. Modèle UI : `web/components/sources/DeleteSourceModal.tsx`.

### Chantier 2 — Granularité du thème DANS le cadre

- `web/components/upload/ThemePicker.tsx` : ajouter les props `granularity: Gran` +
  `onGranularityChange` (type `Gran = 'auto'|'resource'|'chunk'` exporté par `LinkPicker.tsx:22`),
  et rendre le `<select>` de granularité **à l'intérieur** de la boîte `rounded-lg border …`
  (ligne 47), uniquement si `value.length > 0`, en réutilisant le style de la granularité par
  carte de `LinkPicker.tsx:238-251` (label « Granularité », 3 options auto/resource/chunk).
- `web/components/upload/UploadForm.tsx` : passer
  `granularity={themesGranularity} onGranularityChange={setThemesGranularity}` à `<ThemePicker/>`
  (ligne 417) et **supprimer** le bloc externe `{hasThemes && (…)}` (lignes 419-438). L'état
  `themesGranularity` (`UploadForm.tsx:79-80`) et la construction FormData (`themes_granularity`,
  ligne 195) restent inchangés.

### Chantier 3 & 4 — Bouton « + » pour ajouter plusieurs entités / thèmes (même UI)

Aucun changement du modèle de données (déjà des tableaux). On rend l'ajout explicite et fiable.

- `web/components/upload/LinkPicker.tsx` : à côté de l'`<input>` d'entité (203-216), ajouter un
  bouton `+` (icône `Plus` déjà importée ligne 4) appelant `add(type, drafts[type] ?? '')` puis
  vidant le draft (`setDrafts((p) => ({ ...p, [type]: '' }))`) — même effet qu'Entrée, conservé
  en parallèle. Adapter le placeholder (« Ajouter une entité »).
- `web/components/upload/ThemePicker.tsx` : idem à côté de l'`<input>` de thème (66-79) →
  `add(draft)` + `setDraft('')` ; garder Entrée. **Même markup/style** que LinkPicker (exigence
  utilisateur « utilise le même UI »).
- Optionnel mais recommandé : sur soumission (`UploadForm.tsx` handler, ~ligne 169-198), si un
  draft non vide reste dans un input, l'ajouter avant l'envoi (évite la perte du dernier nom non
  validé). NB : les drafts vivent dans les composants enfants ; si non remonté, se limiter au
  bouton `+` (suffisant).

### Chantier 5 — Création DIRECTE & déterministe des entités / thèmes / types déclarés (le vrai bug)

Objectif : ce qui est déclaré à l'upload devient une fiche validée **dans le même run
d'ingestion**, sans dépendre de ce que l'IA recopie, et **sans** passer par la file d'attente.
La file reste réservée aux détections IA (`<detected-new>` non déclaré / alias).

**5a. Forcer les déclarations dans le frontmatter avant projection** — `web/lib/ingest-local.ts`,
dans `ingestOne` (juste après `forceSourceFile`, avant `parseResourceMeta`, ~ligne 560) :
- Nouveau helper `forceDeclaredLinks(markdown, declaredEntities, declaredThemes)` : union des
  slugs déclarés dans les tableaux frontmatter `entities:` et `topics:` (réutiliser
  `splitFrontmatter` / `fmArray` / `withFrontmatter`, mêmes utilitaires que `forceSourceFile`,
  importés de `./wiki-mutate` — cf. bloc d'import `wiki-project.ts:23-40`).
- Conséquence en cascade (déjà en place) : `meta.entities` / `meta.topics` incluent alors les
  déclarés → `newEntities[e]` prend le `entity_type`/`label` déclaré (`ingest-local.ts:581-582`) →
  `projectResource` crée la fiche (`wiki-project.ts:515-517`), le nœud et l'arête de mention
  (569-575). Les déclarés forcés sont traités en **niveau ressource** (fallback quand l'IA ne les
  a pas placés en section ; la granularité `chunk` déclarée reste un simple indice IA).

**5b. Durcir l'exclusion des candidats** — `buildCandidateOps` (`ingest-local.ts:482-524`) :
exclure un item `detected-new` s'il correspond à un déclaré par **slug OU par forme normalisée du
label/alias** (mêmes `normalizeForm` que `knownEntForms`), pas seulement
`slugify(name) ∈ declEntSlugs`. Ferme la fuite « l'IA a détecté "Julien Ye" alors que "Julien"
était déclaré » (lignes 493-497 entités, 510-514 thèmes). NB comportement voulu : un nom
réellement DIFFÉRENT détecté par l'IA (ex. « Julien Ye » ≠ « Julien ») PEUT rester en file
d'attente — c'est conforme à la règle (validation réservée aux détections/alias IA).

**5c. Nouveaux types de lien** : aucun mécanisme séparé. La liste des types dérive des
`entity_type` distincts des entités existantes (`web/app/api/entities/route.ts` :
`typeSet = [...new Set(entities.map(e => e.entity_type))]`). Dès qu'une entité déclarée d'un
nouveau type obtient sa fiche (5a), le type est enregistré et proposé. Un type ouvert sans entité
n'est de toute façon pas soumis (filtré à `UploadForm.tsx:181-190`, seuls les types non vides
partent dans FormData).

**5d. Tests** — `web/lib/__tests__/ingest-local.test.ts` : ajouter un test `ingestOne` où la
ressource passée en entrée **omet** une entité déclarée du frontmatter → asserter que sa fiche
`wiki/entities/<slug>.md` EST créée (via l'op retournée), qu'un nœud+arête existent, et qu'elle
n'apparaît PAS dans `_candidates.json`. Symétrique pour un thème déclaré. `ingestOne` n'appelle
pas le modèle (il reçoit `markdown` + `detectedNew` en entrée) → preuve **sans clé IA**.

> **Approche déjà validée empiriquement** (démo exécutée avec le vrai `ingestOne`, wiki temporaire,
> entité déclarée « julien », sidecar `links: personnes: [Julien]`) :
> - Sans correctif, IA qui omet la déclaration (frontmatter `entities: []`) → fiche
>   `wiki/entities/julien.md` **non créée** ; l'IA la redécouvre en `detected-new` « Julien Ye »
>   qui part en file d'attente (candidate `julien-ye`, `variants: ["Julien Ye"]`) = reproduit
>   exactement le `julien-ye.md` observé.
> - Avec `forceDeclaredLinks` (ré-injection de `julien` dans `entities:`) → fiche
>   `wiki/entities/julien.md` **créée directement** (`entity_type: personnes`), sans validation.
>   Le « Julien Ye » détecté par l'IA reste en file d'attente — conforme à la règle voulue.
> Script de référence pour le test 5d (à recréer, il vivait dans un scratchpad temporaire) :
> construire un wiki-fixture minimal, `resolveDeclarations(parseSidecar(SIDECAR), await loadRegistries())`,
> puis `ingestOne({ file, markdown, detectedNew, declaredEntities, declaredThemes, registries, today })`
> et inspecter le tableau `ops` (chercher `o.path === 'wiki/entities/julien.md'` et parser l'op
> `wiki/entities/_candidates.json`).

### Fichiers touchés (récap)

| Chantier | Fichiers |
|---|---|
| 1 | `web/lib/wiki-mutate.ts` (nouv. `deleteEntity`), `web/app/api/entities/[slug]/route.ts` (nouv.), `web/components/entities/EntitiesView.tsx` (+ fiche entité), `wiki/entities/jean-baptiste.md` + `wiki/entities/julien-ye.md` + `wiki/graph.json` (nettoyage 1a) |
| 2 | `web/components/upload/ThemePicker.tsx`, `web/components/upload/UploadForm.tsx` |
| 3-4 | `web/components/upload/LinkPicker.tsx`, `web/components/upload/ThemePicker.tsx` |
| 5 | `web/lib/ingest-local.ts` (helper `forceDeclaredLinks` + `buildCandidateOps`), `web/lib/__tests__/ingest-local.test.ts` |

## Décisions

- **Suppression d'entités : fonctionnalité réutilisable, pas nettoyage ponctuel.**
  Alternative écartée : effacer seulement les 2 orphelines à la main. Raison : le problème se
  reproduit à chaque suppression de ressource (les entités ne cascadent jamais) ; l'utilisateur
  doit pouvoir nettoyer lui-même. Décision : `deleteEntity` + route `DELETE` + bouton UI.
- **Ne PAS faire cascader la suppression d'entités depuis `deleteResource`.**
  Alternative écartée : supprimer automatiquement une entité devenue orpheline quand sa dernière
  ressource citante est supprimée (comme auteurs/dates/types). Raison : « Registre = jamais delete »
  est un choix délibéré (une entité + ses alias doivent survivre à la suppression d'une ressource ;
  une entité peut être partagée). La suppression reste un geste explicite.
- **Multi-entités / multi-thèmes = correctif ergonomique (bouton `+`), pas refonte du modèle.**
  Constat : `LinksValue`/`themes` sont déjà des tableaux. Le blocage vécu venait de l'ajout
  uniquement par Entrée (non devinable + Entrée avalée par la datalist ouverte). Alternative
  écartée : retravailler le modèle de données (inutile). Décision : ajouter un bouton `+` explicite,
  garder Entrée, même UI aux deux endroits.
- **Chantier 5 : forcer les déclarations dans le frontmatter (`forceDeclaredLinks`).**
  Alternatives écartées : (a) durcir le prompt pour que l'IA recopie fidèlement les déclarations —
  rejeté car non déterministe (dépend du bon vouloir du modèle) ; (b) créer les pages d'entités
  déclarées dans une boucle séparée à côté de `meta.entities` — rejeté car la ré-injection dans le
  frontmatter rend TOUT le downstream déterministe d'un coup (fiche + nœud + arête de mention +
  exclusion des candidats), sans dupliquer la logique de projection. Décision : (a) `forceDeclaredLinks`
  avant `parseResourceMeta`, (b) durcir l'exclusion dans `buildCandidateOps`.
- **Le bug de validation EST réel (diagnostic initial corrigé).** Une première analyse concluait
  « le comportement voulu existe déjà ». L'utilisateur a maintenu qu'il devait confirmer ses entités
  sur la page Entités. Vérification approfondie + démo exécutable ont confirmé l'utilisateur :
  `julien-ye.md` (`aliases: ["Julien Ye"]`) provient du chemin confirmation, pas de l'ingestion
  directe. Le chantier 5 est donc bien dans le périmètre (l'utilisateur a explicitement retiré le
  report « autre spec »).
- **Nouveaux types de lien : couverts par le correctif entités.** Alternative écartée : mécanisme
  de persistance de type séparé. Raison : les types dérivent des `entity_type` distincts ; créer
  l'entité déclarée suffit à enregistrer son type.
- **Lancement de l'app en mode production.** Alternative écartée : `next dev`. Raison : plante sous
  Node 26 (cf. `tasks/lessons.md`). Décision : `npm run build && npm run start`.

## Hors périmètre

- Ne pas modifier `deleteResource` pour auto-supprimer les entités orphelines (choix délibéré
  « Registre = jamais delete »).
- Pas de refonte du prompt d'ingestion ni du format des fichiers de candidats (`_candidates.json`).
- Pas de fusion automatique « Julien Ye → alias de julien » : un nom réellement différent détecté
  par l'IA reste une proposition en file d'attente (comportement voulu).
- Granularité `chunk` d'une entité déclarée que l'IA n'a placée dans aucune section → rendue au
  niveau ressource (limite assumée ; la granularité reste un indice pour l'IA).
- Pas d'empaquetage Electron ni de configuration de la clé IA (hors sujet ici).

## Todo

Ordre d'exécution recommandé : backend suppression (1) → backend ingestion (5) → UI upload (2,3,4)
→ vérification end-to-end. Chaque étape porte son critère de preuve.

- [x] **1b. `deleteEntity` dans `web/lib/wiki-mutate.ts`** (miroir `deleteResource`, réutiliser
  `parseGraph`, `removeResourceBlock`, `purgeCandidate`, retour `FileOp[]`).
  *Vérif :* test unitaire dans `web/lib/__tests__/wiki-mutate.test.ts` — sur une entité orpheline
  (0 mention), les ops contiennent `{ path: 'wiki/entities/<slug>.md', delete: true }` et un graphe
  sans le nœud `entity:<slug>` ; sur une entité citée par 1 ressource, l'op de cette ressource n'a
  plus le slug dans son frontmatter `entities:`. `npm test` vert. ✅ 6 tests verts (105 au total).
- [x] **1c. Route `DELETE /api/entities/[slug]/route.ts`** (miroir `sources/[slug]/route.ts`).
  *Vérif :* `curl -X DELETE http://localhost:3000/api/entities/<slug-de-test>` → `{ "ok": true }` ;
  slug invalide → 400 ; entité absente → 404. ✅ Curl LIVE : slug invalide → 400, entité absente →
  404 (build+start port 3000). Chemin 200 complet prouvé SUR DISQUE via script isolé (suppression
  fichier + nœud graphe + lien ressource frontmatter/chunk) — pas de delete destructif sur le wiki réel.
- [x] **1a. Supprimer les 2 orphelines** `jean-baptiste`, `julien-ye` via le nouveau mécanisme.
  *Vérif :* `ls web/../wiki/entities/` ne montre plus `jean-baptiste.md` ni `julien-ye.md` ;
  `grep -E "jean-baptiste|julien-ye" wiki/graph.json` → aucun résultat. ✅ État déjà satisfait (0
  fichier, 0 nœud) — retirées entre-temps (autre session). Le mécanisme 1b/1c reste prouvé.
- [x] **5a. `forceDeclaredLinks` + appel dans `ingestOne`** (`web/lib/ingest-local.ts`, avant
  `parseResourceMeta`).
  *Vérif :* couverte par le test 5d ci-dessous. ✅
- [x] **5b. Durcir l'exclusion dans `buildCandidateOps`** (match slug OU `normalizeForm` du
  label/alias déclaré, entités ET thèmes).
  *Vérif :* test 5d — un `detected-new` portant le nom exact d'un déclaré n'apparaît PAS dans
  `_candidates.json`. ✅
- [x] **5d. Tests `ingestOne` (chantier 5)** dans `web/lib/__tests__/ingest-local.test.ts`.
  *Vérif :* `cd web && npm test` vert, incluant : entité déclarée absente du frontmatter IA →
  `wiki/entities/<slug>.md` créée + nœud/arête présents + absente de `_candidates.json` ; idem thème.
  ✅ Test « chantier 5 » vert + le test nominal existant intact (non-régression).
- [x] **2. Granularité thème dans le cadre** (`ThemePicker.tsx` props + `<select>` interne ;
  retrait du bloc `UploadForm.tsx:419-438`).
  *Vérif :* dans l'app (build+start), `/upload`, ajouter un thème → le sélecteur de granularité
  apparaît DANS la boîte « Thèmes », plus en dessous. ✅ Screenshot piloté (CDP) : « Granularité »
  DANS la boîte Thèmes ; ancien bloc externe absent (SSR grep = 0).
- [x] **3. Bouton `+` multi-entités** (`LinkPicker.tsx`, à côté de l'input, `add` + reset draft).
  *Vérif :* `/upload`, ouvrir un type « Personnes », saisir « A » puis `+`, saisir « B » puis `+`
  → 2 chips. ✅ Screenshot piloté : type « Personnes » ouvert, chips « Alice » + « Bob » via `+`.
- [x] **4. Bouton `+` multi-thèmes** (`ThemePicker.tsx`, même UI que 3).
  *Vérif :* `/upload`, ajouter 2 thèmes via `+` → 2 chips. ✅ Screenshot piloté : chips « Veille
  perso » + « Agentic coding » via `+`.
- [x] **Vérification end-to-end finale.**
  *Vérif :* `cd web && rm -rf .next && npm run build && npm run start` sans erreur ; `npm test` vert ;
  contrôle visuel des chantiers 2-4 sur `/upload` ; suppression d'entité via l'UI prouvée sur disque.
  ✅ Build OK, `npm test` 105 verts, screenshots pilotés (upload + liste entités + modale de
  suppression), route de suppression prouvée. Non couvert (hors périmètre, pas de clé) : upload RÉEL
  appelant l'IA — chantier 5 prouvé sans clé par test `ingestOne`.

## Bilan

**Fait (tous les chantiers).**
- **Chantier 1 (suppression d'entités).** `deleteEntity` déterministe (`web/lib/wiki-mutate.ts`) :
  fiche supprimée, nœud + arêtes du graphe retirés, lien retiré du frontmatter ET des annotations
  chunk de chaque ressource citante, purge défensive d'une candidate résiduelle. Route
  `DELETE /api/entities/[slug]`. Bouton « Supprimer » sur la liste (`EntitiesView.tsx`) ET sur la
  fiche entité (`EntityDeleteButton.tsx`), via une modale dédiée `DeleteEntityModal.tsx`. 6 tests
  unitaires + curl live (400/404) + chemin 200 prouvé sur disque + screenshots.
- **Chantier 2.** Granularité des thèmes déplacée DANS la boîte « Thèmes » ; ancien bloc externe
  retiré de `UploadForm.tsx`.
- **Chantiers 3 & 4.** Bouton `+` explicite (même UI) pour ajouter plusieurs entités / thèmes,
  touche Entrée conservée.
- **Chantier 5 (le vrai bug).** `forceDeclaredLinks` ré-injecte les déclarations sidecar dans le
  frontmatter avant projection → fiche + nœud + arête créés dans le run, hors file d'attente, quelle
  que soit la fidélité de l'IA. Exclusion des candidats durcie (slug OU forme normalisée du
  label/alias). Test `ingestOne` dédié (déclaration OMISE par l'IA → fiche créée + absente des
  candidats ; nom réellement différent → reste en file). Non-régression du test nominal.

**Écarts au plan (et pourquoi).**
1. **1a — rien à supprimer.** Les 2 orphelines (`jean-baptiste`, `julien-ye`) étaient DÉJÀ absentes
   (fichiers + graphe) au moment de l'implémentation — retirées entre-temps par une autre session
   Claude active sur le dépôt. L'état visé par 1a est donc atteint ; le mécanisme (1b/1c) reste
   pleinement implémenté et prouvé. Le « dogfooding » (supprimer via la nouvelle fonction) n'avait
   plus d'objet.
2. **1d — `DeleteEntityModal` dédié plutôt que `ConfirmDialog`.** Le plan suggérait `ConfirmDialog`
   (bouton vert, sans état réseau). J'ai préféré calquer `DeleteSourceModal` (bouton rouge, gestion
   busy/erreur), plus adapté à une action destructive avec appel réseau — c'est le patron établi
   pour les suppressions dans ce codebase. Bouton ajouté aux DEUX emplacements proposés (liste +
   fiche), pas un seul.
3. **`deleteEntity` — signature enrichie + nettoyage chunk.** La signature du plan
   (`{ slug, entityContent, graph, referencingResources? }`) omettait `candidatesJson`, pourtant
   nécessaire à la purge de candidate demandée dans le corps du plan : ajouté en optionnel (+ `slugify`
   injecté). Et le lien d'entité est retiré du frontmatter ET des annotations chunk `` `entities: […]` ``
   (le plan ne mentionnait que le frontmatter) — plus correct pour une entité liée au niveau section.
4. **Vérification adaptée à une session concurrente.** Une autre session Claude occupait le port
   3000 + le build `.next` partagé (cf. `lessons.md` 2026-07-21). Sur autorisation d'Arthur, j'ai
   arrêté SON serveur (jamais son code source), reconstruit, et — faute de Playwright — piloté l'UI
   via Chrome headless + DevTools Protocol (`WebSocket` natif de Node 26, zéro dépendance ajoutée)
   pour capturer des screenshots. Le chemin de suppression 200 a été prouvé sur un wiki temporaire
   isolé (pas de delete destructif sur le wiki réel).

**Hors périmètre confirmé non couvert.** Upload RÉEL déclenchant l'IA (pas de clé gateway) — le
chantier 5 est néanmoins prouvé sans clé par le test `ingestOne` (qui n'appelle pas le modèle).
