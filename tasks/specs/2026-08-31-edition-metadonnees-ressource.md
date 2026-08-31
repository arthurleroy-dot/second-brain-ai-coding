# Édition des métadonnées d'une ressource existante

## Contexte

**Demande d'origine (utilisateur) :** pouvoir corriger, après ingestion, les
métadonnées « déclarées » d'une ressource (liens/entités, dates, thèmes, type,
origine, auteur, titre, url) sans redéposer la source ni relancer l'IA. Depuis
la page qui liste toutes les ressources (`/sources`), on sélectionne une
ressource, on clique un bouton « Modifier les informations de la ressource », et
un écran identique à la page de dépôt s'ouvre **pré-rempli** avec ce qui a déjà
été déclaré. On modifie, on ajoute, on retire, on valide — et **tout le wiki se
met à jour de façon déterministe** : la page ressource, toutes les vues dérivées
(thèmes, entités, dates, auteurs, index, types, origine), et **les liens du
graphe**. Ce qui est retiré disparaît partout ; ce qui est ajouté apparaît
partout.

**Le point délicat identifié (et confirmé par l'audit) :** ce n'est pas un simple
formulaire. Une édition propre doit *rejouer* la reconstruction déterministe sur
une ressource existante — donc **retirer l'ancien état** des vues + graphe **puis
ajouter le nouveau**, en nettoyant les traces des anciennes valeurs (blocs de
thème/entité, lignes de table, arêtes du graphe, compteurs, pages devenues
orphelines).

**État des lieux (audit du code) :**

- Les métadonnées éditables vivent **toutes dans le frontmatter** de
  `wiki/resources/<slug>.md` (règle cardinale 3 : c'est la source canonique ;
  tout le reste sous `wiki/` en dérive).
- Il existe **deux moteurs déterministes purs et symétriques** :
  - `projectResource(input): FileOp[]` — `web/lib/wiki-project.ts:348` — **ajoute**
    UNE ressource à toutes les vues + graphe (upserts ciblés, PAS de
    reconstruction globale).
  - `deleteResource(input): FileOp[]` — `web/lib/wiki-mutate.ts:792` — l'exact
    inverse : **retire** UNE ressource de toutes les vues + graphe, purge les
    nœuds dérivés orphelins (auteur/date/type qui ne servent plus).
  - `index.md` et `wiki/by-date/**` sont, eux, **reconstruits EN ENTIER** après
    chaque lot par `rebuildDerivedIndexes(today): Promise<FileOp[]>` —
    `web/lib/ingest-local.ts:1038`.
- Le **patron d'écriture** déjà rôdé (route DELETE, `web/app/api/sources/[slug]/route.ts:107-120`)
  est : *lire les vues concernées → un moteur pur renvoie `FileOp[]` →
  `applyFileOps(ops)` → `applyFileOps(await rebuildDerivedIndexes(today))`*. C'est
  exactement le squelette de l'édition.
- La liste `/sources` (`web/components/sources/SourceList.tsx` +
  `web/components/sources/SourceRow.tsx`) affiche déjà, au survol de chaque ligne,
  un bouton « Supprimer » (`SourceRow.tsx:48-69`). Un bouton « Modifier » se place
  juste à côté.
- Le formulaire de dépôt (`web/components/upload/UploadForm.tsx`) est déjà découpé
  en composants réutilisables : `ThemePicker` (`web/components/upload/ThemePicker.tsx`,
  valeur `string[]`, poignée impérative `flush(): string[]`), `LinkPicker`
  (`web/components/upload/LinkPicker.tsx`, valeur `Record<entity_type, string[]>`,
  poignée `flush(): LinksValue`), et de simples `<input>`/`<select>` pour
  title/author/date/type/origin/url.

**Conséquence majeure :** éditer des métadonnées **ne rappelle jamais l'IA** (le
corps verbatim est conservé). L'édition est donc **synchrone, instantanée et
gratuite**, contrairement au dépôt (async + appel modèle).

---

## Plan

### Vue d'ensemble de l'architecture

```
[Bouton « Modifier »] (SourceRow + page détail)
   → /sources/<slug>/modifier   (server component : pré-remplit depuis le frontmatter)
      → <EditForm> (client : mêmes champs que le dépôt, SANS contenu, SANS granularité)
         → PATCH /api/sources/<slug>   (JSON, AUCUN fichier, AUCUN appel IA)
            → PHASE A : retract (deleteResource, filtré) + applyFileOps
            → PHASE B : project (loadProjectViews + projectResource sur disque post-retract) + applyFileOps
            → PHASE C : applyFileOps(rebuildDerivedIndexes(today))
```

Le cœur réutilise **à l'identique** les deux moteurs purs existants
(`deleteResource`, `projectResource`) et le chargeur de vues d'ingestion
(`loadProjectViews`). Le seul code déterministe **neuf** est la construction du
**nouveau contenu de la ressource** (frontmatter mis à jour + réconciliation des
annotations de section + nav), extrait en fonctions **pures et testables**.

### 1. Front — bouton « Modifier »

**a. `web/components/sources/SourceRow.tsx`** — ajouter, à côté du bouton
Supprimer existant (`SourceRow.tsx:48-69`), un bouton/lien « Modifier »
(icône `Pencil` de `lucide-react`) pointant vers `/sources/${source.slug}/modifier`.
Contrainte : la ligne entière est un `<Link href={/sources/${slug}}>`
(`SourceRow.tsx:21`). Le bouton Modifier doit être **frère** du `Link` (comme
l'est déjà le bouton Supprimer), afin que le clic « Modifier » ne déclenche pas
la navigation vers la page détail (utiliser un `<Link>` séparé, ou un `onClick`
avec `e.preventDefault(); e.stopPropagation();` + `router.push`). Révélé au
survol, même style que Supprimer.

**b. `web/app/sources/[id]/page.tsx`** — ajouter dans l'en-tête de la page détail
un bouton « Modifier les informations » (lien vers `/sources/${slug}/modifier`).
NB : le segment dynamique s'appelle `[id]` mais reçoit le **slug**
(`[id]/page.tsx:16-24`).

### 2. Front — l'écran d'édition (server component + client form)

**a. `web/app/sources/[id]/modifier/page.tsx`** (NOUVEAU, server component,
`export const dynamic = 'force-dynamic'`) :
- Lit la ressource : `getResource(slug)` (`web/lib/wiki-parser.ts:130`) → renvoie
  `{ source, body }` avec `source` = frontmatter parsé (`slug, title, type,
  author, date, url, deposited_by, topics, entities, origin, source_file`). 404 si
  `null`.
- Charge le registre des entités pour **grouper les entités par `entity_type`**
  (le frontmatter ne stocke que des slugs à plat `entities: [a, b]` ; `LinkPicker`
  attend `Record<entity_type, string[]>`). Utiliser la fonction serveur qui
  alimente `GET /api/entities` (`web/app/api/entities/route.ts:11`) — elle renvoie
  `{ types, entities: [{ slug, label, entity_type, aliases }] }`. Construire
  `initialLinks: Record<string, string[]>` en regroupant `source.entities` par
  l'`entity_type` de chaque entité (jointure sur le slug). Une entité absente du
  registre (cas de bord) → la ranger sous son type si connu, sinon l'ignorer en
  émettant un warning console (ne doit pas arriver : toute entité a une page).
- Passe à `<EditForm slug initial={{ title, author, date, type: source_type,
  origin, url, links: initialLinks, themes: source.topics }} />`.

**b. `web/components/sources/EditForm.tsx`** (NOUVEAU, client component `'use client'`) :
- Réutilise **`ThemePicker`** et **`LinkPicker`** (mêmes imports que `UploadForm`)
  + `ConfirmDialog`.
- Champs (état React, un par champ, seedé depuis `initial`) : `title`, `author`,
  `date` (input texte, formats `YYYY`/`YYYY-MM`/`YYYY-MM-DD`), `type`
  (`<select>` alimenté par `GET /api/types`), `origin` (`<select>`
  `interne`|`externe` — **pas** d'option « Auto » en édition : la ressource a déjà
  une origine concrète), `url` (input texte), `links` (via `LinkPicker`, seedé
  avec `initial.links`), `themes` (via `ThemePicker`, seedé avec `initial.themes`).
- **Pré-remplissage des pickers avec les SLUGS** (décision D3) : `LinkPicker` et
  `ThemePicker` sont seedés avec les slugs courants (valeurs qui slugifient vers
  elles-mêmes → **zéro dérive de slug**, règle cardinale 5). Les puces affichent
  donc les slugs — acceptable pour v1.
- Le `<select>` Type **doit inclure le type courant en option** même s'il n'est
  plus dans le registre (ex. `unknown`, ou un type retiré) — sinon le type
  courant serait perdu au submit.
- **PAS** de bloc contenu (ni onglets coller/uploader, ni fichier). **PAS** de
  contrôles de granularité (décision D4).
- Mention à l'écran : « L'identifiant de la ressource (slug) et son URL ne
  changent pas. » (le titre est éditable mais le slug est gelé).
- Au submit : appeler `linkRef.current.flush()` / `themeRef.current.flush()` pour
  ramasser les brouillons non validés (comme `UploadForm.tsx:241-242`), puis
  `fetch('/api/sources/'+slug, { method: 'PATCH', headers: {'content-type':
  'application/json'}, body: JSON.stringify(payload) })`.
  Payload JSON :
  ```json
  {
    "title": "…", "author": "…", "date": "…",
    "type": "<source_type-slug>", "origin": "interne|externe", "url": "…",
    "links": { "<entity_type>": ["<slug|nom>", …] },
    "themes": ["<slug|nom>", …]
  }
  ```
  (granularité non envoyée ; tout traité en `auto` côté serveur).
- Sur succès (`{ ok: true }`) : `router.push('/sources/'+slug)` + `router.refresh()`.
  Sur erreur : afficher le message renvoyé.

### 3. Back — la route `PATCH /api/sources/[slug]`

**Fichier : `web/app/api/sources/[slug]/route.ts`** (existe déjà avec `DELETE` ;
**ajouter** `export async function PATCH(req, { params })`). Ne pas dupliquer les
imports déjà présents (`applyFileOps`, `readRepoFile`, `repoPathExists`,
`slugify`, `typeLabel`, `parseResourceMeta`, `rebuildDerivedIndexes`).

Étapes :

1. Valider `slug` (`SLUG_RE = /^[a-z0-9-]+$/`, déjà défini). Lire
   `oldContent = await readRepoFile('wiki/resources/'+slug+'.md')` → 404 si `null`.
2. Parser l'ancien état : `oldMeta = parseResourceMeta(oldContent, slug)`
   (`web/lib/wiki-mutate.ts:367`) → `topics, entities, author, date, source_type,
   origin, source_file, title, body`.
3. Parser + normaliser le payload JSON (réutiliser les parseurs du dépôt — voir
   décision D5) :
   - `title/author/date/url` : chaînes trimées (`''` autorisé).
   - `type` → `slugify(type)` (peut être `''` → traité comme `unknown` via
     `forceType`-like : si vide, retomber sur `oldMeta.source_type` ou `'unknown'`).
   - `origin` → accepté seulement si `interne|externe`, sinon garder
     `oldMeta.origin`.
   - `links` → `Record<slugify(type), slugify(nom)[]>` (types vides retirés).
   - `themes` → `slugify(nom)[]` dédupliqué.
4. Charger les registres : `reg = await loadRegistries()`
   (`web/lib/ingest-local.ts:181`) puis résoudre les déclarations en slugs
   définitifs : `{ declaredEntities, declaredThemes } = resolveDeclarations(
   { links, themes, entitiesGranularity: {}, themesGranularity: 'auto', origin,
   date }, reg)` (`web/lib/ingest-local.ts:297`). Cela reproduit **exactement** la
   logique de résolution du dépôt : entité de même type existante → s'y relie ;
   inconnue → **créée directement** (isNew=true), **sans passer par le sas des
   candidats** (décision D2). `declaredEntities[i].slug` sont les slugs finaux ;
   `declaredThemes[i].slug` idem. Construire les ensembles cibles :
   `newTopics = declaredThemes.map(t => t.slug)` (dédupliqués, ordre stable) ;
   `newEntities = declaredEntities.map(e => e.slug)` (dédupliqués).
   Construire `themeLabels: Record<slug,label>` depuis `declaredThemes` + `reg`.
5. **Construire le nouveau contenu** de la ressource (fonctions pures neuves,
   §4) :
   `newContent = buildEditedResourceContent(oldContent, { title, author, date,
   source_type, origin, url, topics: newTopics, entities: newEntities },
   themeLabels)`.
6. **PHASE A — retract de l'ancien état.** Charger les `DeleteViews` de l'ANCIENNE
   ressource **exactement comme la route DELETE** (`route.ts:42-105` : themes de
   `oldMeta.topics`, entities de `oldMeta.entities`, author/origin/by-date/graph/
   manifest/index/types). Puis :
   ```ts
   const delOps = deleteResource({ slug, resourceContent: oldContent, views,
     slugifyAuthor: slugify, typeLabel: wikiTypeLabel })
     .filter(op => !op.path.startsWith('raw/')             // raw immuable (jamais touché)
                && op.path !== `wiki/resources/${slug}.md`); // NE PAS supprimer la page canonique
   await applyFileOps(delOps);
   ```
   Le filtre garantit que **la page canonique et le fichier brut ne sont jamais
   supprimés** ; seules les vues dérivées + le graphe sont « rétractés ».
7. **PHASE B — project du nouvel état.** Recharger les vues FRAÎCHES (= disque
   post-retract) pour la NOUVELLE ressource via le chargeur d'ingestion, puis
   projeter :
   ```ts
   const { views: pViews, slug: s2 } = await loadProjectViews(
     newContent, reg, today, declaredEntities, declaredThemes); // web/lib/ingest-local.ts:873
   const projOps = projectResource({ slug, resourceContent: newContent,
     views: pViews, slugifyAuthor: slugify, typeLabel: wikiTypeLabel, today });
   await applyFileOps(projOps);
   ```
   `projectResource` réécrit la page canonique (op #1), ré-ajoute les blocs de
   thème/entité, la ligne auteur, le bloc origine, la ligne `types.md` (avec
   recompte des compteurs, calculés sur le disque post-retract → **corrects**),
   ré-ajoute le node ressource + les 7 arêtes du graphe (sur le graphe
   post-retract → **anciennes arêtes déjà retirées, nouvelles ajoutées**), et
   ré-ajoute la clé `_ingested.json`. Les entités/thèmes déclarés-nouveaux sont
   créés ici (`createEntityPage`/`createThemePage`).
8. **PHASE C — reconstruction globale des index :**
   `await applyFileOps(await rebuildDerivedIndexes(today))` (index.md + by-date/**
   régénérés en entier → dates/compteurs cohérents, pages by-date orphelines
   purgées).
9. `today = new Date().toISOString().slice(0,10)`. Répondre `{ ok: true, slug }`.
   Envelopper les 3 `applyFileOps` dans un `try/catch` → 500 avec message en cas
   d'échec (comme DELETE, `route.ts:115-126`).

**Exports à ajouter dans `web/lib/ingest-local.ts`** (si pas déjà exportés) :
`loadRegistries`, `rebuildNav` (voir §4). `resolveDeclarations`, `loadProjectViews`,
`humanize` sont **déjà exportés**.

### 4. Cœur déterministe neuf — construction du nouveau contenu (pur, testable)

**Fichier : `web/lib/wiki-edit.ts`** (NOUVEAU). Comme `wiki-mutate.ts` : **aucun
import `@/…`**, seulement des imports relatifs purs (`./wiki-mutate` pour
`splitFrontmatter`, `withFrontmatter`, `setScalar`) afin de rester testable sous
`node:test` par chemin relatif.

Exporter :

**a. `setInlineArray(fm: string, key: string, slugs: string[]): string`** —
remplace (ou crée) la ligne `key: [a, b, c]` du frontmatter par la liste
**complète** fournie (contrairement à `patchInlineArray` de `wiki-mutate.ts:108`
qui ne fait qu'ajouter). Format inline sans guillemets : `key: [a, b]`, ou
`key: []` si vide. Si `key === 'entities'` et la clé est absente, l'insérer juste
après la ligne `topics:` (comme `patchInlineArray`).

**b. `reconcileChunkAnnotations(body: string, keepTopics: Set<string>,
keepEntities: Set<string>): string`** — pour chaque ligne du corps de la forme
`` `topics: [ … ]` `` ou `` `entities: [ … ]` `` (annotations de section, cf.
`chunkArray` `web/lib/wiki-mutate.ts:356` et `collectSections`
`web/lib/wiki-project.ts:134`), filtrer les slugs pour ne garder que ceux présents
dans l'ensemble correspondant. Réécrire la ligne (`` `topics: [x, y]` `` ; si
vide, `` `topics: []` ``). **Ne toucher à AUCUNE autre ligne** (le verbatim est
préservé — ces annotations ne sont pas du verbatim, ce sont des repères
structurels autorisés, règle cardinale 6). **Critique** : `projectResource`
calcule `meta.entities` = frontmatter ∪ annotations de section (via
`parseResourceMeta`) — une entité retirée mais laissée dans une annotation de
section serait **ré-ajoutée**. La réconciliation est donc **obligatoire** pour
les entités (et faite aussi pour les topics par cohérence).

**c. `buildEditedResourceContent(oldContent: string, next: { title: string;
author: string; date: string; source_type: string; origin: string; url: string;
topics: string[]; entities: string[] }, themeLabels: Record<string,string>):
string`** — assemble le nouveau contenu :
1. `{ fm, rest } = splitFrontmatter(oldContent)`.
2. Mettre à jour les scalaires (les clés existent toujours dans un frontmatter
   d'ingestion) via `setScalar` :
   - `title` → `setScalar(fm, 'title', JSON.stringify(next.title))`
   - `author` → `setScalar(fm, 'author', JSON.stringify(next.author))`
   - `date` → `setScalar(fm, 'date', JSON.stringify(next.date))`
   - `source_type` → `setScalar(fm, 'source_type', next.source_type)` (non quoté)
   - `origin` → `setScalar(fm, 'origin', next.origin)` (non quoté)
   - `url` → `setScalar(fm, 'url', JSON.stringify(next.url))`
   - **`slug` et `source_file` : NE PAS toucher** (gelés).
3. `topics`/`entities` → `setInlineArray(fm, 'topics', next.topics)` puis
   `setInlineArray(fm, 'entities', next.entities)`.
4. `bodyReconciled = reconcileChunkAnnotations(rest, new Set(next.topics),
   new Set(next.entities))`.
5. Recomposer `withFrontmatter(fmMisÀJour, bodyReconciled)`.
6. Régénérer la ligne de nav : `rebuildNav(content, next.author, next.date,
   next.topics, themeLabels)` (`web/lib/ingest-local.ts:824`). **Exporter
   `rebuildNav` s'il ne l'est pas.** Si `rebuildNav` a des dépendances I/O
   (à vérifier ; a priori non — il réécrit juste le blockquote depuis des données
   passées), l'appeler ici ; sinon l'appeler depuis la route après
   `buildEditedResourceContent` et passer `themeLabels`.

### 5. Tests

**a. `web/lib/__tests__/wiki-edit.test.ts`** (NOUVEAU, `node:test`) — teste les
fonctions PURES :
- `setInlineArray` : remplacement d'une liste existante, création si absente,
  liste vide `[]`, insertion `entities` après `topics`.
- `reconcileChunkAnnotations` : retrait d'un slug d'une annotation de section,
  annotation vidée → `[]`, préservation du verbatim (lignes non-annotation
  intactes), topics ET entities.
- `buildEditedResourceContent` : changement de titre/date/origine/type/url ;
  ajout et retrait de thèmes et d'entités (frontmatter cohérent, chunks
  réconciliés, slug/source_file inchangés) ; nav régénérée.

**b. Vérification bout-en-bout (à exécuter et à prouver) :**
1. `npm --prefix web run dev` (serveur local, hot reload).
2. Sur une ressource réelle (ex. `note-de-veille-perso-31-aout-2026`, qui a
   `entities: [bolt-new, stackblitz]` et plusieurs `topics`) : ouvrir
   `/sources/<slug>/modifier`, **changer la date**, **retirer une entité**,
   **ajouter un thème**, valider.
3. Prouver la propagation déterministe :
   - `git status` / `git diff` sur `wiki/` : la page ressource, la/les page(s)
     thème (ajout + retrait), la/les page(s) entité (retrait de mention),
     `wiki/graph.json` (arête `mentions` retirée, arête `belongs_to_theme`
     ajoutée, node date mis à jour), `wiki/by-date/**`, `wiki/index.md`,
     `wiki/types.md` (si type changé) doivent refléter exactement le diff.
   - **`npm --prefix web run wiki:verify` doit rester VERT** (aucune incohérence
     introduite).
   - Vérifier qu'AUCUN fichier `raw/` n'a été modifié/supprimé
     (`git status raw/` vide).
4. Cas de bord à exercer : changement d'auteur (ancienne page auteur supprimée si
   orpheline, nouvelle créée) ; changement de type (compteurs `types.md` +
   node type orphelin purgé du graphe) ; ajout d'une entité **inédite** (page
   entité créée directement, **absente** de `wiki/entities/_candidates.json`).

---

## Décisions

**D1 — Application en 2 phases (retract puis project), PAS un lot unique
« atomique ».**
En discussion, j'avais proposé un moteur dédié `editResource` produisant **un seul
lot atomique**. À la lecture du code réel, ce choix s'est avéré **sous-optimal** :
- Un lot unique impose de calculer les opérations de projection sur l'état
  *post-retract* du graphe et de `types.md` (fichiers uniques où `projectResource`
  ne sait qu'*ajouter*, jamais retirer) — ce qui obligerait à **matérialiser en
  mémoire** l'application des opérations de retract avant de projeter, du code neuf
  non trivial pour un bénéfice marginal.
- Le patron **2 phases** (`applyFileOps(delOps)` puis
  `applyFileOps(projOps)`) réutilise **100 % des moteurs testés** (`deleteResource`,
  `loadProjectViews`, `projectResource`) sans matérialisation, et **la phase B lit
  le disque post-retract → graphe et compteurs corrects**.
- Le risque de non-atomicité est **limité aux vues dérivées** (jamais la page
  canonique ni `raw/` ni la clé manifeste : le retract est filtré pour les
  épargner) et **auto-réparable** (`wiki:verify` ou ré-édition). C'est **le même
  profil de risque que la route DELETE existante**, déjà en 2 `applyFileOps`
  successifs — cohérence avec le codebase + simplicité (principes « Simplicité
  d'abord », « ne pas sur-ingénierer »).
*Alternative écartée :* moteur `editResource` pur en lot unique avec
matérialisation mémoire — plus de code, gain d'atomicité réel mais marginal (vues
dérivées seulement). Reste le repli si un besoin d'atomicité stricte émerge.

**D2 — Entités/thèmes ajoutés en édition = créés directement, PAS de sas
candidats.**
En édition, l'utilisateur *déclare explicitement* un lien/thème (comme une
déclaration au dépôt). On réutilise `resolveDeclarations` → création directe
(`isNew`), jamais `_candidates.json`. *Alternative écartée :* router les ajouts
vers le sas des candidats (incohérent : le sas sert aux détections **IA**
incertaines, pas aux déclarations humaines).

**D3 — Pré-remplissage des pickers avec les SLUGS (pas les libellés).**
Garantit un aller-retour sans **dérive de slug** (règle cardinale 5) :
`slugify(slug) === slug`, et `resolveDeclarations` re-relie à l'entité/thème
existant. Coût : les puces affichent des slugs (ex. `claude-code`) plutôt que des
libellés. *Alternative écartée :* seeder avec les libellés — plus joli, mais
risque de dérive si `slugify(label) !== slug` (rare mais possible) → création
d'une entité fantôme. Polissage futur possible (afficher label, transporter slug).

**D4 — Contrôles de granularité masqués en édition (tout `auto`).**
La granularité (`resource`/`chunk`/`auto`) ne sert qu'à l'IA au dépôt pour
répartir les annotations par section. En édition, `projectResource` détermine le
niveau ressource vs section par la présence d'annotations de section (corps), pas
par la granularité déclarée. Les items existants gardent leurs ancres de section ;
un item **ajouté** n'a aucune annotation de section → traité niveau ressource.
*Alternative écartée :* exposer la granularité (parité avec le dépôt) — inutile et
source de confusion, sans effet réel.

**D5 — Payload PATCH en JSON (pas multipart), et parseurs de champs mutualisés.**
Pas de fichier en édition → JSON naturel (plus simple que le multipart du dépôt).
Les parseurs `field`/`parseLinks`/`parseThemes`/slugification du dépôt
(`web/app/api/upload/route.ts:41-102`) sont réutilisés ; si la mutualisation est
simple, les extraire dans `web/lib/upload-fields.ts` et les importer depuis les
deux routes ; sinon, réimplémenter la normalisation minimale (slugify + validation
`origin`) directement dans le handler PATCH (elle est courte). *Alternative
écartée :* réutiliser le multipart + `buildSidecar` — inadapté (on ne touche pas
au sidecar, cf. D6).

**D6 — On ne touche PAS à `raw/` ni au sidecar `raw/<source>.meta.md`.**
La page ressource (frontmatter) est canonique (règle 3) et devient la vérité
courante ; `raw/` reste immuable (règle 2). Le sidecar garde la déclaration
d'origine, sans impact : la ressource ne sera jamais ré-ingérée (sa clé reste dans
`wiki/_ingested.json`, préservée par le filtre du retract + ré-ajoutée par la
projection). *Alternative écartée :* réécrire le sidecar pour refléter l'édition —
nouvelle entorse à l'immuabilité de `raw/`, sans bénéfice.

**D7 — Bouton « Modifier » sur la page détail ET au survol de chaque ligne.**
Choix utilisateur (le plus accessible). *Alternatives écartées :* détail seul /
ligne seule.

**D8 — Périmètre complet des champs.** Titre, auteur, date, type, origine, url,
thèmes ET liens/entités (choix utilisateur). *Alternatives écartées :* « tout sauf
liens/entités » / « champs plats seulement » — ne couvrent pas la demande.

**D9 — Le slug (identité) et `source_file` sont gelés.** Le titre est éditable
mais le slug ne change jamais (renommer casserait tous les wikilinks, règle 5).
Mention explicite dans le formulaire.

---

## Hors périmètre

- **Modifier le corps verbatim** de la ressource (texte de la source). Seules les
  métadonnées + les annotations structurelles de section sont éditées ; le
  verbatim est préservé (règle 6).
- **Renommer le slug** d'une ressource (gelé, règle 5).
- **Remplacer le fichier source** (`raw/`) ou re-téléverser un contenu. Pour
  changer le contenu, le flux reste : supprimer + redéposer.
- **Réécrire le sidecar** `raw/<source>.meta.md` (cf. D6).
- **Édition en masse** (plusieurs ressources à la fois) — une ressource à la fois.
- **Historique / annulation** des éditions (au-delà de ce que `git` offre déjà sur
  les fichiers wiki).
- **Lot atomique strict** (cf. D1) — repli documenté, non implémenté en v1.
- **Affichage des libellés dans les puces** des pickers en édition (cf. D3) —
  polissage futur.

---

## Todo

- [x] **1. `web/lib/wiki-edit.ts` — helpers purs.** Créer `setInlineArray`,
  `reconcileChunkAnnotations`, `buildEditedResourceContent` (imports relatifs
  purs uniquement, cf. §4). *Vérif :* le module compile (`npm --prefix web run
  build` ou `tsc --noEmit`) et n'importe rien via `@/`.
  ✔ `tsc --noEmit` 0 erreur ; seuls imports `./wiki-mutate`. NB : `buildEditedResourceContent`
  ne prend PAS `themeLabels` (nav régénérée côté route via `rebuildNav`, cf. repli §4c).
- [x] **2. Tests unitaires `web/lib/__tests__/wiki-edit.test.ts`.** Couvrir les 3
  fonctions (cas §5a). *Vérif :* `npm --prefix web test` (ou la commande de test
  du projet) — tous verts, incluant les cas ajout/retrait de thème et d'entité,
  et la préservation du verbatim.
  ✔ 11 tests verts ; suite complète 216/216. Nav testée en bout-en-bout (§9), pas en unitaire
  (déplacée hors de `buildEditedResourceContent`).
- [x] **3. Exports dans `web/lib/ingest-local.ts`.** Exporter `loadRegistries` et
  `rebuildNav` s'ils ne le sont pas déjà (vérifier `resolveDeclarations`,
  `loadProjectViews`, `humanize` : déjà exportés). Confirmer que `rebuildNav` est
  pur (sans I/O) ; sinon, l'appeler côté route. *Vérif :* imports résolus, build
  OK.
  ✔ Les 5 (`loadRegistries`, `rebuildNav`, `resolveDeclarations`, `loadProjectViews`, `humanize`)
  étaient DÉJÀ exportés — aucune modif nécessaire. `rebuildNav` est pur (splitFrontmatter +
  slugify, aucune I/O) → appelé côté route.
- [x] **4. (Si simple) `web/lib/upload-fields.ts`.** Extraire `field`,
  `parseLinks`, `parseThemes` de `web/app/api/upload/route.ts` et les réimporter
  dans la route upload (comportement inchangé) + la route PATCH. *Vérif :* le
  dépôt existant fonctionne toujours (un upload de test aboutit à une ingestion).
  Sinon, sauter cette étape (D5) et normaliser en ligne dans PATCH.
  ✔ SAUTÉE (repli D5) : les parseurs du dépôt travaillent sur `FormData`+chaîne JSON, alors
  que PATCH reçoit un objet JSON déjà parsé → mutualisation NON simple. Normalisation minimale
  (slugify + validation origin) en ligne dans le handler PATCH. Route upload NON touchée.
- [x] **5. Route `PATCH /api/sources/[slug]`.** Ajouter le handler dans
  `web/app/api/sources/[slug]/route.ts` selon §3 (parse → resolve → build →
  phase A retract filtré → phase B project → phase C rebuild). *Vérif :* `curl -X
  PATCH http://localhost:3000/api/sources/<slug> -H 'content-type:
  application/json' -d '{…}'` renvoie `{ ok: true, slug }` ; `git diff wiki/`
  montre la propagation ; `git status raw/` vide.
  ✔ Handler PATCH pilote en direct (DATA_ROOT isolé) → HTTP 200 `{ok:true,slug}`. Lecture des
  `DeleteViews` factorisée dans `readDeleteViews` (partagée DELETE+PATCH, comportement identique).
  Propagation + raw intact prouvés en §9.
- [x] **6. Écran d'édition serveur `web/app/sources/[id]/modifier/page.tsx`.**
  Pré-remplir depuis `getResource` + registre entités (groupage par
  `entity_type`), passer à `<EditForm>`. *Vérif :* la page charge sans erreur avec
  les valeurs actuelles visibles.
  ✔ GET /sources/<slug>/modifier → HTTP 200 (instance dev saine 3001) : titre pré-rempli,
  mention slug gelé, puces thèmes/entités en slugs (D3), origine « interne » sélectionnée.
- [x] **7. `web/components/sources/EditForm.tsx`.** Formulaire client (§2b),
  réutilise `ThemePicker`/`LinkPicker`, sans contenu ni granularité, submit
  PATCH → redirection. *Vérif :* dans le navigateur, éditer une ressource, voir
  la redirection vers la page détail avec les nouvelles valeurs.
  ✔ Rendu HTTP 200 (3001) : « Enregistrer les modifications » présent, ZÉRO sélecteur
  « Granularité » (D4 : `showGranularity={false}` ajouté à ThemePicker/LinkPicker). Submit
  PATCH → `router.push('/sources/'+slug)` + `refresh`. Redirection navigateur non pilotée
  (l'e2e §9 prouve la propagation serveur ; les 500 du port 3000 = `.next` corrompu
  multi-instances, cf. lessons 2026-07-21, PAS mon code — le 3001 rend tout).
- [x] **8. Boutons « Modifier ».** `SourceRow.tsx` (à côté de Supprimer, sans
  déclencher la navigation de ligne) + en-tête de `sources/[id]/page.tsx`.
  *Vérif :* les deux boutons mènent à `/sources/<slug>/modifier` ; le clic
  « Modifier » sur une ligne n'ouvre PAS la page détail.
  ✔ SourceRow : `<Link>` FRÈRE (icône Pencil, `right-9`, `stopPropagation`) → pas de
  navigation de ligne. Page détail : bouton « Modifier les informations » présent (HTTP 200).
- [x] **9. Vérification bout-en-bout complète (§5b).** Éditer une vraie ressource
  (date + retrait entité + ajout thème + changement type/auteur), prouver le diff
  wiki + graphe, `wiki:verify` VERT, `raw/` intact, entité inédite créée hors
  `_candidates.json`. *Vérif :* sortie des commandes `git diff`, `wiki:verify`
  collée en preuve.
  ✔ Prouvé sur COPIE ISOLÉE (`DATA_ROOT` scratch, vrai wiki intact, zéro appel IA — lessons
  2026-07-22/28) sur `note-de-veille-perso-31-aout-2026`. Édition combinée : titre + auteur
  ("" → « Arthur Leroy », page auteur CRÉÉE) + date (2026-08-31 → 2026-07-15, page mois orphelin
  SUPPRIMÉE) + type (personal-notes → article, compteurs types.md 8→7 / 7→8) + origine (interne
  → externe) + retrait entité (stackblitz) + ajout entité INÉDITE (test-edition-entite, concept)
  + retrait thèmes + ajout thème INÉDIT (test-edition-theme). Résultats :
  • HTTP 200 `{ok:true}` ;
  • `wiki:verify` → **0 erreur** (38 avert., dont 1 attendu « Developer Experience cité mais
    absent des topics » — thème retiré volontairement, mots encore dans le verbatim) ;
  • `raw/` STRICTEMENT identique (diff vide) ;
  • graphe : node ressource re-labellisé/re-daté, `written_by`/`has_type`/`has_origin` recâblés,
    `mentions→stackblitz` RETIRÉE, `mentions→bolt-new` (ancre section conservée) + entité inédite
    AJOUTÉES, `date:2026-08` PURGÉE, thèmes recâblés ;
  • entité + thème inédits créés DIRECTEMENT, ABSENTS de `_candidates.json` (D2) ;
  • manifeste `_ingested.json` : clé `note-10.txt` PRÉSERVÉE (pas de ré-ingestion).
- [x] **10. Lessons.** Après toute correction de l'utilisateur durant
  l'implémentation, noter le pattern dans `tasks/lessons.md`.
  ✔ Run `/implement` autonome — AUCUNE correction utilisateur → rien à consigner. (Le bug
  `rebuildNav` a été trouvé et corrigé par moi, pas signalé par Arthur ; documenté au Bilan.)

---

## Bilan

**Statut : FAIT.** Édition des métadonnées d'une ressource opérationnelle de bout en bout,
prouvée sur copie isolée (propagation déterministe correcte, `wiki:verify` vert, `raw/`
intact) et à l'écran (rendu HTTP 200 avec pré-remplissage).

### Ce qui a été fait (conforme au plan)

- **`web/lib/wiki-edit.ts`** (neuf, pur) : `setInlineArray`, `reconcileChunkAnnotations`,
  `buildEditedResourceContent`. Imports relatifs purs uniquement. 11 tests unitaires verts.
- **`PATCH /api/sources/[slug]`** : parse/normalise (inline, D5) → `resolveDeclarations` (D2)
  → `buildEditedResourceContent` + `rebuildNav` → **phase A** retract filtré (`deleteResource`
  moins `raw/` et la page canonique) → **phase B** project sur disque post-retract
  (`loadProjectViews` + `projectResource`) → **phase C** `rebuildDerivedIndexes`. Les 2 moteurs
  purs existants réutilisés à l'identique (D1).
- **Front** : écran serveur `sources/[id]/modifier/page.tsx` (pré-remplissage, groupage des
  entités par `entity_type`) + `EditForm.tsx` (client, réutilise `ThemePicker`/`LinkPicker`,
  sans contenu ni granularité) + boutons « Modifier » (ligne `SourceRow` + en-tête détail).
- Décisions D1–D9 respectées (2 phases, création directe entités/thèmes, pré-remplissage slugs,
  granularité masquée, payload JSON, `raw/`+sidecar intouchés, slug & `source_file` gelés).

### Déviations par rapport au plan (et pourquoi)

1. **`buildEditedResourceContent` ne régénère PAS la nav** (la spec §4c le prévoyait comme option).
   Raison : `rebuildNav` vit dans `ingest-local.ts` (dépendances `@/` lourdes : fs, SDK, unpdf…)
   et dépend de `slugify`. L'importer aurait cassé la contrainte « `wiki-edit.ts` sans import `@/`,
   testable en relatif ». La nav est donc régénérée **par la route** juste après (repli explicite
   documenté dans la spec §4c). Le paramètre `themeLabels` de la fonction devient inutile → retiré.
2. **Todo #4 (`upload-fields.ts`) sautée** (repli D5) : parseurs du dépôt = `FormData`+chaîne JSON ;
   PATCH = objet JSON déjà parsé → mutualisation non triviale. Normalisation minimale inline dans
   PATCH ; route upload NON touchée.
3. **`readDeleteViews` extrait** (refactor non prévu) : la lecture des `DeleteViews`, dupliquée
   entre DELETE et PATCH (phase A), est factorisée en un helper interne au fichier route.
   Comportement de DELETE inchangé (extraction pure) ; le helper est prouvé par l'e2e PATCH.

### Bug de cause racine corrigé en cours de route (hors plan)

**`rebuildNav` ne strippait pas les navs SANS auteur** (celles débutant par `> [[../by-date/…`
au lieu de `> Par …`). Conséquence : (a) à l'édition d'une ressource sans auteur, l'ancienne nav
périmée survivait à côté de la neuve ; (b) à l'ingestion, cela créait déjà une **nav dupliquée**
(bug latent visible dans le fichier d'origine de la note test). Corrigé à la source : le motif de
strip reconnaît désormais les trois débuts de nav possibles (`Par `, `Thèmes :`, `[[../by-date/`).
Vérifié : suite 216/216 verte (ingestion non régressée) + nav unique et correcte après édition.
Ce n'était pas une correction demandée par Arthur mais un défaut découvert et traité au passage.

### Preuves (résumé)

- `tsc --noEmit` : **0 erreur** sur tout le projet.
- `npm --prefix web test` : **216/216** verts (dont 11 neufs `wiki-edit`).
- e2e handler PATCH (DATA_ROOT isolé) : **HTTP 200**, `wiki:verify` **0 erreur**, `raw/` diff vide,
  graphe/vues/index/types/by-date correctement propagés, entité+thème inédits hors `_candidates`,
  clé manifeste préservée.
- UI : page `/modifier` et bouton détail rendus **HTTP 200** (instance dev saine).

### Hors périmètre confirmé non traité

Corps verbatim, renommage de slug, remplacement de source, réécriture du sidecar, édition en
masse, historique, lot atomique strict, affichage des libellés (vs slugs) dans les puces (D3).
