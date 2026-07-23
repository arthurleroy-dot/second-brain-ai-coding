# Remontée déterministe des thèmes de section vers le frontmatter (fix bug « aucun thème »)

## Contexte

### Demande d'origine
Après avoir déposé une note de test via la plateforme, l'utilisateur constate que la ressource
ingérée n'affiche **aucun thème** (ni pastille, ni ligne « Thèmes : … »), alors que le texte parle
frontalement de FinOps, de gestion du contexte et d'agents autonomes. Les entités, elles, sont bien
détectées et affichées. Demande : « résoudre le problème des thèmes pour qu'il n'arrive plus jamais ».

### Diagnostic (établi et prouvé)
La ressource cassée est
`wiki/resources/point-equipe-plateforme-etat-de-notre-pratique-du-coding-assiste-par-ia.md`
(source `raw/note-3.txt`, clé manifeste `note-3.txt`). État observé :
- frontmatter `topics: []` (VIDE) et `entities: []` (VIDE) ;
- ligne de nav dégénérée en tête de corps : `> Thèmes : …` (la note n'a ni auteur ni date, donc
  l'IA n'a pas pu écrire `> Par …`) ;
- annotations de section correctes : 3 sections portent `` `topics: [...]` `` totalisant **6 slugs de
  thèmes connus** : `agentic-coding`, `outils-et-marche`, `finops-ia`, `context-engineering`,
  `securite-et-risques`, `transformation-organisationnelle` ; une section porte
  `` `entities: [claude-code, n8n, supabase, databricks]` `` ;
- `graph.json` : le nœud `resource:point-…` existe, avec `has_type`, `has_origin`, 4× `mentions`,
  mais **AUCUNE arête `belongs_to_theme`** ;
- les 6 pages `wiki/themes/<slug>.md` existent déjà (labels : « Agentic Coding », « Outils et Marché »,
  « FinOps IA », « Context Engineering », « Sécurité et Risques », « Transformation Organisationnelle »).

**Cause racine (une seule, deux couches d'expression).** Le frontmatter `topics:` est traité comme
autoritaire/complet, mais rien ne garantit qu'il contient les thèmes annotés en section. Les ENTITÉS
sont partout traitées via l'UNION frontmatter+section → elles remontent ; les THÈMES via le frontmatter
seul → ils sont perdus quand l'IA laisse `topics: []`.

- **Couche projection** — `web/lib/wiki-project.ts`, fonction `projectResource` : `const meta =
  parseResourceMeta(...)` donne `meta.topics`/`meta.entities` = union(frontmatter, chunk), mais le code
  dérive ensuite `const feTopics = fmArray(fm, 'topics')` = **frontmatter seul**. TOUS les sites de
  thème itèrent `feTopics` : boucle des pages `themes/`, `resource_count`, graphe (node `theme:<slug>`
  + arête `belongs_to_theme`), `index.md` (via `updateIndex`), colonnes « Topics » des tables
  by-date/auteur. Les ENTITÉS itèrent `meta.entities` (union) : pages `entities/`, graphe (arête
  `mentions`). La ressource canonique est écrite **VERBATIM** (`ops.push({ path:
  'wiki/resources/<slug>.md', content: resourceContent })`) — le moteur ne régénère NI le frontmatter
  NI la ligne de nav.
- **Couche affichage** — `web/lib/wiki-parser.ts`, fonction `parseResource` (L78-100) : `entities`
  = union frontmatter + `extractChunkEntities(body)` (L82), mais `topics: arr(data.topics)` = frontmatter
  seul (L92). Il n'existe PAS d'`extractChunkTopics` (seul `extractChunkEntities`, L62-70). La fiche
  `web/app/sources/[id]/page.tsx` affiche les pastilles de thème depuis `source.topics` (L48-60) → vide ;
  les pastilles d'entités depuis `source.entities` (L62-74) → remplies. La ligne « Thèmes : … » visible
  est le blockquote `> Thèmes : …` : `stripChunkAnnotations` (`web/lib/wiki-md.ts` L30-40) ne retire que
  les lignes `^>\s*Par\s+` (L36), pas `> Thèmes :` → rendu verbatim (vide). De plus `listTopics()`
  (`wiki-parser.ts` L139-159) rattache une ressource à un thème via `s.topics.includes(slug)` (L149) =
  frontmatter seul → la ressource cassée n'apparaît sous aucun thème.

**Contrainte de cohérence avec le vérificateur.** `web/scripts/wiki-verify.ts` lit lui aussi
`feThemes: arr(data.topics)` (frontmatter seul) et n'exige les arêtes `belongs_to_theme` que pour ces
topics. Aujourd'hui `feThemes = []` → 0 arête exigée → **le verify passe au vert malgré le bug** (raison
pour laquelle il est passé inaperçu). Conséquence dure : **remplir le frontmatter DOIT s'accompagner
d'une re-projection** ; sinon le verify réclamera les arêtes manquantes (`graph-missing-edge`). Le
backfill respecte cet ordre.

**Registres au moment du bug** (référence pour les tests) : entités (toutes `entity_type: tool`) =
`claude-code`, `databricks`, `n8n`, `supabase` ; thèmes = `agentic-coding`, `context-engineering`,
`finops-ia`, `labor-market-evolution`, `outils-et-marche`, `securite-et-risques`,
`transformation-organisationnelle`.

### Résultat visé
Le frontmatter `topics:` est TOUJOURS complet (= union frontmatter+sections), ce qui répare les deux
couches d'un coup ; la nav est régénérée déterministiquement (y compris note sans auteur/date) ; les
ressources déjà cassées sont réparées par backfill ; le bug ne peut plus se reproduire à l'ingestion.

---

## Plan

> **Périmètre : THÈMES uniquement.** Ne PAS toucher aux entités (problème distinct — voir Hors
> périmètre). `web/lib/wiki-project.ts` n'est **pas** modifié : il devient correct dès que le
> frontmatter est complet — c'est tout l'intérêt du fix-à-la-source.

### 1. `web/lib/ingest-local.ts` — prévention (cœur)

Ajouter **2 helpers exportés**, sur le patron exact de `forceDeclaredLinks` (fonction existante qui
remonte déjà des slugs déclarés dans le frontmatter via `patchInlineArray` avant projection ; située
juste avant `ingestOne`). Repérer dans le fichier l'enchaînement, en tête de `ingestOne` :
`forceSourceFile` → `forceDeclaredLinks` → `parseResourceMeta` → (chargement des vues + `themeLabels`)
→ `projectResource`.

**`rollupSectionTopics`** — remonte l'union des topics de section dans le frontmatter `topics:` :
```ts
/** Remonte l'UNION des topics de section dans le frontmatter `topics:` (miroir thèmes de forceDeclaredLinks). */
export function rollupSectionTopics(markdown: string): string {
  const meta = parseResourceMeta(markdown, '');          // meta.topics = union(frontmatter, chunk)
  const { fm, rest } = splitFrontmatter(markdown);
  let nf = fm;
  for (const t of meta.topics) nf = patchInlineArray(nf, 'topics', t);  // idempotent ; crée la clé si absente
  return withFrontmatter(nf, rest);
}
```

**`rebuildNav`** — régénère déterministiquement la ligne de nav depuis le frontmatter (remplace la
nav écrite par l'IA) :
```ts
/** Régénère la ligne de nav `> Par … · … · Thèmes : …` depuis le frontmatter (déterministe). */
export function rebuildNav(
  markdown: string,
  author: string | null,
  date: string | null,
  topics: string[],
  themeLabels: Record<string, string>,
): string { /* voir logique ci-dessous */ }
```
Logique de `rebuildNav` :
- `const { fm, rest } = splitFrontmatter(markdown)` ;
- filtrer du corps `rest` toute ligne de nav existante : une ligne dont le trim matche
  `^>\s*Par\s+` **OU** `^>\s*Th[èe]mes\s*:` ;
- construire les segments (dans cet ordre, uniquement s'ils existent) :
  - auteur : `Par [[../authors/${slugify(author)}|${author}]]` ;
  - date : lien by-date — `[[../by-date/${y}/${ym}/${ym}|${ym}]]` si `date.length >= 7`
    (avec `y = date.slice(0,4)`, `ym = date.slice(0,7)`), sinon `[[../by-date/${y}/${y}|${y}]]` ;
  - thèmes : `Thèmes : ${topics.map(t => \`[[../themes/${t}|${themeLabels[t] ?? t}]]\`).join(', ')}` ;
- si aucun segment → renvoyer `withFrontmatter(fm, corpsSansNav)` (pas de ligne de nav) ;
- sinon insérer `> ${segments.join(' · ')}` en tête de corps :
  `withFrontmatter(fm, \`\n${nav}\n\n${corpsSansNav.replace(/^\n+/, '')}\`)`.
- **Cas note sans auteur ni date** (le bug) : seul le segment thèmes existe → nav `> Thèmes : …`,
  masquée à l'affichage grâce au strip élargi (§2). Doit rester **idempotent** (re-appliquer sur une
  nav déjà correcte ne change rien de significatif).

`slugify` est déjà importé dans `ingest-local.ts` (depuis `@/lib/wiki-parser`).

**Câblage dans `ingestOne`** :
- après `forceDeclaredLinks`, insérer `rollupSectionTopics` **avant** le `parseResourceMeta` qui
  produit `meta` :
  ```ts
  const withSource   = forceSourceFile(input.markdown, file);
  const withDeclared = forceDeclaredLinks(withSource, input.declaredEntities, input.declaredThemes);
  let markdown = rollupSectionTopics(withDeclared);   // section topics → frontmatter (union)
  const { fm } = splitFrontmatter(markdown);
  const meta = parseResourceMeta(markdown, '');        // meta.topics = frontmatter (déjà union)
  ```
  (passer `const markdown` → `let markdown`.)
- après la boucle qui construit `themeLabels` (map slug→label sur `meta.topics`), insérer :
  ```ts
  markdown = rebuildNav(markdown, meta.author, meta.date, meta.topics, themeLabels);
  ```
  avant l'appel `projectResource({ slug, resourceContent: markdown, views, … })`.

`projectResource` reçoit alors un frontmatter union + une nav propre ; il re-parse et reconstruit
toutes les vues + le graphe correctement. Les `feTopics`/`feEntities` re-dérivés en interne par
`projectResource` deviennent l'union — inoffensif.

**Refactor additif recommandé (DRY, pour le backfill)** : extraire le bloc de `ingestOne` qui charge
les vues fraîches (lecture de `themes`/`entities`/author/origin/by-date/graph/manifest/index/types →
objet `ProjectViews`, avec `themeLabels`) en une fonction exportée
`export async function loadProjectViews(markdown: string, registries: Registries, today: string):
Promise<{ views: ProjectViews; themeLabels: Record<string,string>; slug: string }>`, réutilisée par
`ingestOne` ET par le backfill. Additif, comportement inchangé, une seule source de vérité.

**Ne PAS toucher aux entités** (hors périmètre ; `meta.entities` remonte déjà l'union partout).

### 2. `web/lib/wiki-md.ts` — affichage (couche 2)

Dans `stripChunkAnnotations` (L30-40), à côté du filtre `^>\s*Par\s+` (L36), ajouter :
```ts
if (/^>\s*Th[èe]mes\s*:/i.test(t)) return false; // nav dégénérée (note sans auteur/date)
```
Masque le rendu verbatim du `> Thèmes : …` de la ressource cassée.

### 3. `web/lib/wiki-parser.ts` — affichage durci (defense-in-depth)

- Ajouter `extractChunkTopics(body)` juste après `extractChunkEntities` (L62-70), **miroir exact** :
  ```ts
  /** Récupère les thèmes déclarés en chunk (`topics: [...]` sous un heading). */
  function extractChunkTopics(body: string): string[] {
    const out: string[] = [];
    const re = /^`topics:\s*\[([^\]]*)\]`\s*$/;
    for (const line of body.split('\n')) {
      const m = line.trim().match(re);
      if (m) out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
    }
    return out;
  }
  ```
- Dans `parseResource`, remplacer L92 `topics: arr(data.topics),` par :
  ```ts
  topics: [...new Set([...arr(data.topics), ...extractChunkTopics(body)])],
  ```

Effet : `source.topics` = union → pastilles de thèmes, rattachement `listTopics`, `listAllSources`.
Corrige l'UI **immédiatement** même avant backfill, et découple l'affichage de la couche écriture.
Ne remplace pas le rollup (le graphe et la nav en dépendent toujours).

### 4. `web/scripts/wiki-backfill-topics.ts` (NOUVEAU) + `web/package.json`

`web/package.json` : ajouter dans `scripts` l'entrée
`"wiki:backfill-topics": "tsx scripts/wiki-backfill-topics.ts"` (aligner sur la forme de l'entrée
`wiki:verify` existante).

Script tsx one-shot, déterministe (zéro appel IA), idempotent, option `--dry-run`. Réutilise
`readRepoFile`/`applyFileOps` (`web/lib/wiki-fs.ts`), `loadRegistries`, `rollupSectionTopics`,
`rebuildNav`, `loadProjectViews`, `projectResource`, `wikiTypeLabel`, `humanize`, `fmArray`,
`splitFrontmatter`, `parseResourceMeta`, `slugify`. Logique :
```
today = <AAAA-MM-JJ> ; registries = await loadRegistries()
pour chaque fichier de wiki/resources/*.md :
  content = await readRepoFile(`wiki/resources/${file}`)
  feTopics = fmArray(splitFrontmatter(content).fm, 'topics')
  meta = parseResourceMeta(content, slug)                 // meta.topics = union
  missing = meta.topics.filter(t => !feTopics.includes(t))
  si missing.length === 0 → continue                       // GARDE d'idempotence (union ⊋ frontmatter)
  themeLabels[t] = registries.themes.find(x => x.slug === t)?.label ?? humanize(t)
  fixed = rebuildNav(rollupSectionTopics(content), meta.author, meta.date, meta.topics, themeLabels)
  { views } = await loadProjectViews(fixed, registries, today)
  ops = projectResource({ slug, resourceContent: fixed, views, slugifyAuthor: slugify, typeLabel: wikiTypeLabel, today })
  si dryRun → log(slug, missing) ; sinon → await applyFileOps(ops)
après application : réconcilier les compteurs de thèmes de l'index (voir ci-dessous)
```

**Réconciliation de l'index** (nécessaire) : `updateIndex` (dans `wiki-project.ts`) court-circuite
quand la ressource est déjà présente dans `index.md`, donc les bullets `## Thèmes` ne s'incrémentent
pas lors du re-projet d'une ressource existante. Après application, pour chaque thème affecté : lire
`resource_count:` du frontmatter de `wiki/themes/<t>.md` (que la projection maintient correct) et
réécrire le bullet correspondant `- [[themes/<t>|<label>]] — N ressource(s)` dans `wiki/index.md`
(créer le bullet s'il manque). ~15 lignes déterministes ; auto-répare toute dérive de compteur.

**Sûreté** : (a) n'agit que si `missing.length > 0` → relançable = no-op ; (b) `--dry-run` liste sans
écrire ; (c) `applyFileOps` est atomique (temp+rename) et refuse tout chemin hors `wiki/`/`raw/` ;
(d) `projectResource` est idempotent (upserts blocs/arêtes) → n'ajoute que le manquant ;
(e) ne touche jamais `raw/`.

### 5. `web/scripts/wiki-verify.ts` — miroir défensif (facultatif, low-priority)

Dans `proseOnly`, ajouter le même filtre `^>\s*Th[èe]mes\s*:` que le strip d'affichage, pour ne pas
laisser les labels de la nav dégénérée polluer `proseNorm` (évite de faux `missed-theme-link`, un warn).

### Utilitaires réutilisés (déjà présents, ne pas réécrire)
- `web/lib/wiki-mutate.ts` : `splitFrontmatter` (L73), `withFrontmatter` (L80), `patchInlineArray`
  (L105-137 : idempotent, crée la clé si absente), `parseResourceMeta` (L364-378 : union
  frontmatter+chunk via `chunkArray`), `setScalar`. **NE PAS exporter `chunkArray`** — le rollup
  passe par `parseResourceMeta().topics` (déjà exporté) ; `wiki-mutate.ts` reste figé.
- `web/lib/ingest-local.ts` : `forceDeclaredLinks` (patron), `forceSourceFile`, `loadRegistries`,
  `wikiTypeLabel`, `humanize`, `fmArray`, type `Registries`.
- `web/lib/wiki-project.ts` : `projectResource` (INCHANGÉ), type `ProjectViews`.
- `web/lib/wiki-fs.ts` : `readRepoFile`, `applyFileOps`, `DATA_ROOT`.
- `web/lib/wiki-parser.ts` : `extractChunkEntities` (patron d'`extractChunkTopics`).

### Tests (`npm --prefix web test` ; glob `lib/__tests__/*.test.ts`)
- **`web/lib/__tests__/ingest-local.test.ts`** — le test « chantier 5 » (rollup des DÉCLARATIONS via
  `forceDeclaredLinks`) reste INCHANGÉ et vert. Ajouter le test dédié du bug : fixture ressource
  **sans thème déclaré** (sidecar sans `themes:`), frontmatter `topics: []`, plusieurs sections
  annotées (ex. section A `` `topics: [agentic-coding, outils-et-marche]` ``, section B
  `` `topics: [finops-ia, context-engineering]` ``). Deux variantes : (1) avec auteur+date, (2) SANS
  auteur ni date (cas dégénéré). Après `ingestOne` + `applyFileOps`, asserter :
  - fiche : frontmatter `topics:` = union des slugs ;
  - chaque `wiki/themes/<t>.md` contient `## [[../resources/<slug>…]]` + `resource_count: 1` ;
  - `graph.json` : une arête `belongs_to_theme` + un nœud `theme:<t>` par slug de l'union ;
  - nav : variante 1 → `> Par …· Thèmes : [[…]], …` ; variante 2 → `> Thèmes : [[…]], …` ;
  - affichage : `resourceBodyForDisplay(body)` ne contient plus de ligne `> Thèmes :`.
- Tests unitaires ciblés des helpers exportés : `rollupSectionTopics` (frontmatter vide + 2 sections →
  union) ; `rebuildNav` (auteur+date+topics / topics seuls / rien → pas de nav / idempotence).
- **`web/lib/__tests__/wiki-project.test.ts`** — ajouter un cas multi-thèmes/multi-sections (fixture
  dont le frontmatter porte DÉJÀ l'union, 2 sections aux topics distincts) : chaque page thème ne
  reçoit QUE le bullet de sa section, `resource_count` exact, une arête `belongs_to_theme` par topic.
- **`web/lib/__tests__/wiki-mutate.test.ts`** — aucun changement.

### Vérification end-to-end
La ressource cassée est **déjà ingérée** (clé `note-3.txt` au manifeste → `detectPending` la saute) :
sa correction vient du **backfill**, la prévention protège les futures ingestions.
1. `npm --prefix web test` → vert (nouveaux + existants).
2. `npm --prefix web run wiki:backfill-topics -- --dry-run` → liste `point-equipe-…` (+ tout autre
   `topics` frontmatter incomplet) avec ses `missing`.
3. Relancer sans `--dry-run`.
4. `wiki/resources/point-…-ia.md` : frontmatter `topics: [agentic-coding, outils-et-marche, finops-ia,
   context-engineering, securite-et-risques, transformation-organisationnelle]` ; ligne `> Thèmes : [[…]], …`.
5. `grep belongs_to_theme wiki/graph.json` filtré sur `resource:point-…` → 6 arêtes ; nœuds `theme:*` présents.
6. Chaque `wiki/themes/<t>.md` : bloc `## [[../resources/point-…]]` ; `resource_count` bumpé ; bullet index à jour.
7. UI : `/sources/point-…` affiche les 6 pastilles de thème, plus aucun blockquote `> Thèmes :` ;
   chaque `/wiki/<t>` liste la ressource.
8. `npm --prefix web run wiki:verify -- --json` → `errors === 0`.

---

## Décisions

- **D1 — Rollup = union COMPLÈTE des thèmes de section (vs seuil « ≥2 sections »).**
  Choix : union complète. Raison : les annotations `` `topics:` `` de section sont des classifications
  délibérées de l'IA ; on imite exactement les entités (union partout). Un seuil ≥2 sections jetterait
  à tort des thèmes centraux vus dans une seule section (ici `agentic-coding` et `outils-et-marche`).
  Le seuil ≥2 du vérificateur est une heuristique pour détecter des thèmes non liés dans la prose, pas
  pour arbitrer des annotations autoritaires. *Décision utilisateur explicite.*

- **D2 — Corriger À LA SOURCE (remplir le frontmatter) vs modifier `projectResource` pour itérer
  `meta.topics`.** Choix : à la source. Raison : un seul point de correction répare projection +
  affichage + verify + graphe d'un coup, préserve le contrat « frontmatter autoritaire » de
  `projectResource`, et corrige aussi le fichier ressource persisté (frontmatter + nav). Modifier
  `projectResource` laisserait le frontmatter/nav de la ressource toujours vides.

- **D3 — Nav = régénération déterministe complète (vs réutiliser `addThemeToNav`).**
  Choix : régénération (`rebuildNav`). Raison : `addThemeToNav` (`wiki-mutate.ts` L456-468) ne matche
  que les lignes `^>\s*Par\s+` → elle ne touche NI la nav dégénérée `> Thèmes : …` NI une nav absente,
  et ne sait pas créer/normaliser une nav. La régénération gère le cas note-sans-auteur-ni-date et
  supprime la dépendance à la fidélité de l'IA sur la nav.

- **D4 — Durcir `parseResource` (ajout `extractChunkTopics`) = OUI.** Raison : corrige l'UI
  (pastilles + `listTopics`) immédiatement, même avant backfill, et découple l'affichage de la couche
  écriture. Coût quasi nul (miroir d'`extractChunkEntities`). Ne remplace pas le rollup.

- **D5 — Réparer l'existant = OUI, via script de backfill déterministe (vs re-ingestion IA, vs
  prévention seule).** Choix : backfill tsx déterministe. Raison : la note cassée est déjà au manifeste
  (`detectPending` la saute) ; une re-ingestion coûterait un appel IA et exigerait la source dans
  `raw/` ; le backfill est gratuit, idempotent, et réutilise `projectResource`. *Décision utilisateur
  explicite.*

- **D6 — Ne pas exporter `chunkArray` de `wiki-mutate.ts`.** Raison : le rollup passe par
  `parseResourceMeta().topics` (déjà l'union, déjà exporté) → `wiki-mutate.ts` reste figé, surface de
  changement minimale.

---

## Hors périmètre

- **Problème n°2 (à traiter séparément ensuite) :** les entités n'apparaissent pas dans le graphe
  interrogeable et ne sont pas trouvables via le chat (« Qu'est-ce qui a été dit sur n8n ? » → « aucune
  mention » alors que `wiki/entities/n8n.md` existe). Aucune modification du code d'entités dans cette
  spec.
- **Modifier `web/lib/wiki-project.ts` :** interdit — il est déjà correct une fois le frontmatter
  complet ; on ne fait que le consommer.
- **Rafraîchir les colonnes « Topics » des lignes auteur/by-date déjà présentes** (`feTopics.join(', ')`,
  garde `hasTableRow` du moteur) : cosmétique, non jugé par le verify, sans objet pour la note cassée
  (auteur/date vides). Follow-up éventuel.
- **Exporter/modifier `chunkArray`** et tout autre changement de `wiki-mutate.ts` : hors périmètre.

---

## Todo

- [x] **1. Helpers `rollupSectionTopics` + `rebuildNav`** exportés dans `web/lib/ingest-local.ts`
  (après `forceDeclaredLinks`), selon les extraits du §1.
  *Vérif :* tests unitaires (todo 7) `rollupSectionTopics` et `rebuildNav` verts ; `npx tsc --noEmit` sans erreur de type.

- [x] **2. Refactor additif `loadProjectViews`** : extraire le chargement des vues de `ingestOne` en
  fonction exportée, réutilisée par `ingestOne`.
  *Vérif :* `npm --prefix web test` — les tests existants d'`ingest-local.test.ts` (dont « chantier 5 » et « chaîne complète ») restent verts (comportement inchangé).

- [x] **3. Câbler `rollupSectionTopics` + `rebuildNav` dans `ingestOne`** (rollup avant
  `parseResourceMeta`, `rebuildNav` après construction de `themeLabels`, `let markdown`).
  *Vérif :* le nouveau test dédié du bug (todo 8) passe dans ses 2 variantes (avec/sans auteur-date).

- [x] **4. Élargir `stripChunkAnnotations`** (`web/lib/wiki-md.ts`) au cas `^>\s*Th[èe]mes\s*:`.
  *Vérif :* test d'affichage — `resourceBodyForDisplay(body)` d'une ressource à nav `> Thèmes : …` ne contient plus cette ligne (asserté dans le test dédié du bug + prouvé sur la note réelle).

- [x] **5. Ajouter `extractChunkTopics` + union dans `parseResource`** (`web/lib/wiki-parser.ts`, L92).
  *Vérif :* test de parse — une ressource `topics: []` frontmatter + `` `topics: [a, b]` `` en section donne `parseResource(...).source.topics` = `['a','b']`.

- [x] **6. Cas multi-thèmes/multi-sections** dans `web/lib/__tests__/wiki-project.test.ts`.
  *Vérif :* le test passe : chaque page thème n'a que le bullet de sa section, `resource_count` exact, une arête `belongs_to_theme` par topic.

- [x] **7. Tests unitaires des helpers** (`rollupSectionTopics`, `rebuildNav`) dans
  `web/lib/__tests__/ingest-local.test.ts`.
  *Vérif :* `npm --prefix web test` vert sur ces cas (union ; nav auteur+date / topics seuls / rien / idempotence).

- [x] **8. Test dédié du bug** dans `web/lib/__tests__/ingest-local.test.ts` (frontmatter `topics: []`
  + 2 sections annotées, sans thème déclaré, 2 variantes auteur/date).
  *Vérif :* asserts du §Tests tous verts (frontmatter union, pages thèmes + `resource_count`, arêtes+nœuds graphe, nav par variante, corps d'affichage nettoyé).

- [x] **9. Script `web/scripts/wiki-backfill-topics.ts`** + entrée `wiki:backfill-topics` dans
  `web/package.json`, avec `--dry-run` et réconciliation d'index (§4).
  *Vérif :* `npm --prefix web run wiki:backfill-topics -- --dry-run` liste `point-equipe-…` avec ses 6 `missing` (+ 8 autres) ; un 2ᵉ dry-run après application ne liste plus rien (idempotence).

- [x] **10. (Facultatif) Miroir strip dans `wiki-verify.ts` `proseOnly`** (§5).
  *Vérif :* `wiki:verify` ne produit pas de `missed-theme-link` dû à la nav (0 warn sur le vrai wiki).

- [x] **11. Exécution du backfill sur les données réelles + preuve end-to-end** (§Vérification, points 3-8).
  *Vérif :* frontmatter de la note = 6 thèmes ; 6 arêtes `belongs_to_theme` dans `graph.json` ; corps d'affichage sans blockquote `> Thèmes :` (prouvé via `resourceBodyForDisplay`) ; `wiki:verify --json` → `errors === 0`, `warns === 0`.

- [x] **12. Non-régression globale.**
  *Vérif :* `npm --prefix web test` → 131/132 (le seul échec, `wiki-tools.test.ts` « 13 fiches », est **préexistant** et data-dépendant, hors périmètre) ; `npx tsc --noEmit` clean ; `wiki:verify --json` → `errors === 0`.

---

## Bilan

### Ce qui a été fait (conforme au plan)

**Prévention (cœur) — `web/lib/ingest-local.ts`.** Deux helpers exportés sur le patron
de `forceDeclaredLinks` : `rollupSectionTopics` (remonte l'union des topics de section
dans le frontmatter, idempotent) et `rebuildNav` (régénère la ligne de nav depuis le
frontmatter, gère la note sans auteur ni date → nav dégénérée `> Thèmes : …`). Câblés
dans `ingestOne` : rollup juste après `forceDeclaredLinks`, `rebuildNav` avant
`projectResource`. `projectResource` **n'a pas été touché** (il devient correct dès que
le frontmatter est complet — tout l'intérêt du fix-à-la-source). Résultat : à l'ingestion,
le frontmatter `topics:` est TOUJOURS l'union frontmatter+sections ; le bug ne peut plus
réapparaître.

**Refactor DRY — `loadProjectViews`.** Le bloc de chargement des vues fraîches (entités,
thèmes, auteur, origin, by-date, graphe, manifeste, index, types) a été extrait de
`ingestOne` en fonction exportée, réutilisée par `ingestOne` ET le backfill. Comportement
inchangé (les 13 tests d'ingestion préexistants restent verts). Les déclarations sont des
paramètres optionnels (absentes au backfill).

**Affichage durci — `web/lib/wiki-md.ts` + `web/lib/wiki-parser.ts`.** `stripChunkAnnotations`
masque désormais le blockquote `> Thèmes : …`. `parseResource` calcule `source.topics` =
union(frontmatter, sections) via un nouvel `extractChunkTopics` — l'UI affiche les pastilles
et rattache la ressource aux thèmes **même avant backfill**, découplant l'affichage de la
couche écriture.

**Réparation — `web/scripts/wiki-backfill-topics.ts` (nouveau) + `web/package.json`.** Script
`tsx` déterministe, gratuit (zéro appel IA), idempotent, `--dry-run`. Réutilise le moteur
(`rollupSectionTopics`, `rebuildNav`, `loadProjectViews`, `projectResource`) + une
réconciliation des compteurs de thèmes de l'index (que la re-projection court-circuite).
Appliqué au vrai wiki : **9 ressources corrigées** (la note `point-equipe-…` + 8 autres au
frontmatter incomplet).

**Filet — `web/scripts/wiki-verify.ts`.** Miroir du strip dans `proseOnly` (évite un faux
`missed-theme-link` dû à la nav dégénérée).

**Tests.** +6 tests, tous verts : cas multi-thèmes/multi-sections (`wiki-project.test.ts`) ;
unitaires `rollupSectionTopics`/`rebuildNav`, parse-union, et test dédié du bug en 2 variantes
(`ingest-local.test.ts`).

### Preuves (démontrées, pas affirmées)

- `point-equipe-…` : frontmatter `topics:` = les 6 thèmes ; `graph.json` : 6 arêtes
  `belongs_to_theme` ; `resourceBodyForDisplay` ne contient plus `> Thèmes`.
- `wiki:verify --json` sur le vrai wiki → **errors: 0, warns: 0** (validé aussi sur copie
  scratch AVANT le write réel).
- Backfill idempotent : 2ᵉ dry-run après application → 0 ressource à corriger.
- `npx tsc --noEmit` (strict) → aucune erreur.
- Suite de tests : **131/132** (voir déviation ci-dessous).

### Déviations par rapport au plan

1. **`loadProjectViews` prend les déclarations en paramètres optionnels** (le plan esquissait
   `loadProjectViews(markdown, registries, today)`). Nécessaire pour préserver À L'IDENTIQUE
   la création d'entités déclarées-nouvelles de `ingestOne` (branche §R11) ; au backfill les
   déclarations sont absentes (défaut `[]`). La fonction renvoie aussi `warnings` (que
   `ingestOne` retournait déjà).
2. **Exports ajoutés dans `ingest-local.ts`** : `humanize`, `wikiTypeLabel`, `fmArray` (le
   plan les listait comme « réutilisés » par le backfill mais ils étaient privés). `fmArray`,
   devenu inutilisé dans `ingestOne` après le refactor, retrouve un consommateur.
3. **Validation sur copie scratch AVANT le write réel** (dicté par `tasks/lessons.md`
   2026-07-22) : le working tree était déjà modifié par une autre session ; j'ai prouvé le
   backfill sur une copie isolée (`DATA_ROOT` surchargé) puis appliqué au vrai wiki.
4. **Test préexistant hors périmètre non corrigé** : `wiki-tools.test.ts` « renvoie les 13
   fiches » échoue (17 fiches réelles) — il code en dur un compteur de ressources et échouait
   DÉJÀ au démarrage de ma session (avant toute modification). Data-dépendant, sans rapport
   avec les thèmes → laissé tel quel (`CLAUDE.md` : « ne toucher que le nécessaire »).
