# Recherche du chat par facettes + régénération intégrale des index dérivés

## Contexte

### Demande d'origine (utilisateur)
Le chat de l'app (Arthur, non-développeur) manque de rigueur. Exemple : « McKinsey 2026 »
→ l'agent ouvre la fiche auteur McKinsey mais **ne filtre pas l'année** et ressort des
ressources de 2025. Constat plus large : l'agent ne décompose pas la question pour
identifier **quels dossiers/index** consulter (« est-ce que ma phrase suggère de regarder
les origines et les auteurs, ou les entités et les thèmes ? »). Demande : rendre ce
comportement **plus déterministe, plus cadré**. En cours de discussion, Arthur a aussi
signalé que l'**index des entités n'est pas à jour** (5 entités affichées alors que ~18
fiches existent), et veut que **tous les index où l'IA se balade** (auteurs, dates,
entités, origines, types) soient **complets et jamais cassés**, en corrigeant le moteur
« code en dur » pour qu'il soit 100 % déterministe.

### Architecture du projet (rappel nécessaire à l'implémenteur)
Wiki markdown en 3 couches (voir `CLAUDE.md`, `docs/wiki-spec.md`, `docs/entities.md`) :
- `raw/` : sources brutes immuables.
- `wiki/resources/*.md` : fiches **canoniques** (seule source de vérité éditoriale).
- Tout le reste sous `wiki/` (`index.md`, `themes/`, `authors/`, `entities/`, `by-date/`,
  `origin/`, `types.md`, `graph.json`) = **vues dérivées** reconstruites par un **moteur
  déterministe** ; l'IA d'ingestion n'écrit aucune de ces vues.
- App Next.js/Electron **local-first** sous `web/`. Écritures via `applyFileOps`
  (`web/lib/wiki-fs.ts`), garde-fou : uniquement chemins sous `wiki/` ou `raw/`.

### Le chat (état actuel)
Agent à **boucle de tool-use** (function calling Anthropic, SDK manuel). Il navigue le
wiki lui-même avec **exactement 2 outils** définis dans `WIKI_TOOLS`
([web/lib/chat-agent.ts:14-40](web/lib/chat-agent.ts#L14-L40)) :
`read_wiki_page(path)` et `list_wiki_folder(path)`. **Pas de RAG, pas de recherche
plein-texte, pas de contexte pré-injecté, `/raw` inaccessible.** Boucle `runWikiAgent`
(chat-agent.ts:227-345), `MAX_ITERATIONS = 15`. Le system prompt est construit par
`buildSystemPrompt(filterDesc)` (chat-agent.ts:351-411). Le prompt guide une « lecture par
paliers » (index.md → vues → resources) mais **uniquement en texte**, sans contrainte.

### Diagnostic (audit) — les deux racines

**Racine A — le prompt du chat est déséquilibré** (chat-agent.ts:362-410) :
- Recette de routage détaillée **pour les entités seulement** (exemple travaillé « n8n »),
  **aucune** pour auteur / date / thème / origine / type.
- Le raisonnement sur les dates est **détourné vers le frontmatter** des fiches (pas traité
  comme un critère de sélection en amont).
- Défiance **nommant `by-date/`** comme peu fiable → l'agent l'évite.
- Conséquence : l'agent attrape parfois une facette (auteur) mais **ne croise pas** les
  autres (date). Pour « McKinsey 2026 », `authors/mckinsey.md` liste déjà les 3 dates
  (2026-05, 2026-04, **2025-11**) : l'info pour écarter 2025 est présente, mais rien
  n'oblige l'agent à l'appliquer comme filtre.

**Racine B — les index parcourus sont incomplets/cassés.** `index.md` est maintenu par
**retouches incrémentales** (une ressource à la fois) au lieu d'être **régénéré en entier**
comme `graph.json`. Détail des bugs (tous dans la couche incrémentale) :

1. **Corruption de chaînes.** `incrementCountOnLineWith`
   ([web/lib/wiki-project.ts:294-303](web/lib/wiki-project.ts#L294-L303)) et son inverse
   `decrementCountOnLineWith` (wiki-mutate.ts:222-231), ainsi que `upsertMonthBullet`
   (wiki-project.ts:632-647, ligne 638), font `line.replace(/(\d+)/, d => String(parseInt(d)+1))`.
   Le regex `/(\d+)/` remplace **le PREMIER groupe de chiffres de la ligne**. Sur
   `- [[by-date/2026/2026|2026]] — 3 ressources`, le premier `\d+` est **l'année du chemin**
   `2026` (→ `2027`), pas le compteur `3`. D'où `by-date/2027/2026` (chemin cassé, compteur
   jamais incrémenté), et par symétrie côté suppression `by-date/2025/2026`. Puis le check
   `body.includes('by-date/2026/2026|')` devient faux → **insertion d'une nouvelle ligne
   2026** → duplication en cascade. Même mécanisme sur les entités :
   `[[entities/n8n|n8n]]` → `[[entities/n9n|n8n]]` (le `8` de `n8n` incrémenté). Cassera
   aussi `gpt-5→gpt-6`, `gemini-3→gemini-4` dès listés. NB : `adjustHeadingCount`
   (wiki-mutate.ts:234-238) utilise `/\((\d+)\)/` (chiffre entre parenthèses) → les headings
   `## Thèmes (N)` ne dérivent pas, seuls les bullets dérivent.

2. **Liste d'entités plafonnée à 5.** La section `## Entités` de index.md
   (wiki-project.ts:706-717) est bâtie depuis le frontmatter `entities:` de chaque ressource,
   et n'ajoute un bullet **que si la fiche entité est absente du disque**
   (`v.entities[e] === null`) ; sinon branche `else` → `incrementCountOnLineWith` qui est un
   **no-op quand aucun bullet n'existe**. Le moteur **n'énumère jamais l'ensemble des
   entités**. 18 fiches sur disque, 5 listées.

3. **Garde d'idempotence global** en tête de `updateIndex`
   ([wiki-project.ts:660-661](web/lib/wiki-project.ts#L660-L661)) :
   `if (v.index.includes(\`resources/${card.slug}|\`)) return v.index;` — une ressource déjà
   indexée ne voit jamais l'index refléter un ajout ultérieur (nouvelle entité, thème…).

4. **Asymétrie candidat.** `applyEntityDecision` (wiki-mutate.ts:548-630, résolution d'un
   candidat entité) écrit la fiche entité + le nœud/arête graphe + purge le candidat **mais
   n'émet AUCUNE opération sur `index.md`**. Son jumeau `applyThemeDecision`
   (wiki-mutate.ts ~649+) **écrit bien** l'index (op `wiki/index.md` ~700-705). C'est
   pourquoi les 13 entités créées via résolution de candidat manquent dans index.md (les 5
   présentes sont exactement les 5 commitées, créées via le flux `projectResource`).

5. **Corollaires cosmétiques** : `entity_count: 5` (vs 18), `theme_count: 10` (vs 9 thèmes),
   pluralisation figée (`3 ressource`), sous-sections de type dupliquées
   (`### Articles` ET `### Article`, `### Reports PDF` ET `### Rapport PDF`) via
   `typeLabel`/`addTypeSubsection` (wiki-project.ts:769-790).

**Pourquoi `graph.json` est correct** : `projectResource` le reconstruit par **upserts
idempotents node/edge** (wiki-project.ts:569-615) — modèle à répliquer pour l'index.
`wiki-verify.ts` ne vérifie QUE `graph.json`/registres, jamais `index.md`/`by-date` → la
dérive est passée inaperçue.

### État réel constaté (au moment de l'audit)
18 fiches `wiki/entities/*.md` ; `graph.json` = 18 nœuds `entity` (à jour) ; `index.md`
= `entity_count: 5`, 5 bullets. `authors/` (11), `types.md` (4 types), `origin/` (2) : **en
sync**. Seules les **entités** ont le désync « présent sur disque / absent de l'index » ;
les **dates** ont la corruption de chemins ; les **thèmes** ont un compteur faux (liste
complète).

---

## Plan

> Contenu intégral du plan validé. Ordre : Phase 1 (moteur : régénérer + réparer) →
> vérifier → Phase 2 (moteur : nettoyer le code mort) → Phase 3 (prompt). Phase 3 dépend
> d'index fiables (Phase 1). Recommandation : implémenter en ≥2 sessions (moteur d'abord,
> prompt ensuite), éventuellement 2 specs.

### Phase 1 — Moteur : régénération + réparation (sans toucher au code fragile)

Nouvelle brique qui **écrase** la sortie buggée de l'incrémental → la valeur arrive sans
supprimer l'ancien code.

#### 1.1 Nouveau module `web/lib/wiki-index.ts` (fonctions PURES, testables)
Aucun import `@/…` (importable par test en chemin relatif, comme wiki-mutate/wiki-project).
Réutilise depuis `./wiki-mutate` : `parseResourceMeta` (wiki-mutate.ts:364), `splitFrontmatter`
(73), `withFrontmatter` (80), type `FileOp`. Réimplémente localement les micro-helpers de
format (échappement pipe `\|`, pluralisation `ressource`/`ressources`).

**`buildIndex(input): string`** — régénère `index.md` entier au **format EXACT actuel**.
```
interface ResourceCard {
  slug; title; author;      // author '' si absent
  date;                     // '' | 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'
  source_type; origin;      // '' possibles
  topics: string[]; entities: string[];   // = parseResourceMeta (union frontmatter ∪ chunk)
  summary?: string;         // réservé Option A (hors périmètre) ; sinon via resourceDigests
}
interface IndexInput {
  resources: ResourceCard[];
  entities: KnownEntity[];   // registre COMPLET (loadRegistries) → énumère les 18
  themes: KnownTheme[];      // registre → labels + énumération (→ 9)
  today: string;
  typeLabel: (sourceType: string) => string;   // wikiTypeLabel injecté
  slugifyAuthor: (name: string) => string;      // slugify injecté
  resourceDigests: Record<string,string>;       // slug -> queue curée (vide OK)
  authorDigests: Record<string,string>;         // authorSlug -> queue curée
}
```
Sections dans l'ordre EXACT (relire `wiki/index.md` comme gabarit) :
1. **Frontmatter** (`withFrontmatter`, ordre exact) : `type: index` /
   `last_updated: "<today>"` / `resource_count: R` / `theme_count: T` / `author_count: A` /
   `entity_count: E`. `R` = nb ressources ; `T` = `themes.length` (corrige 10→9) ;
   `E` = `entities.length` (corrige 5→18) ; `A` = nb d'auteurs distincts `slugifyAuthor(author)`
   non vides parmi les ressources (11).
2. **`## Thèmes (T)`** — ligne vide, puis 1 bullet/thème du **registre** :
   `- [[themes/<slug>|<label>]] — <c> ressource(s)`, `c` = nb ressources dont `topics` ∋ slug.
   Pluriel correct. Puis ligne vide + `---`. Tri déterministe : `c` desc puis label.
3. **`## Entités (E)`** — **FIX CENTRAL** — 1 bullet **par entité du registre (18)** :
   `- [[entities/<slug>|<label>]] — <c> ressource(s)`, `<slug>` = slug frontmatter/nom de
   fichier émis **tel quel** (tue `n9n` → réémet `n8n`), `<label>` du registre, `c` = nb
   ressources dont `entities` ∋ slug. Ligne vide + `---`.
4. **`## Auteurs (A)`** — 1 bullet/auteur :
   `- [[authors/<aslug>|<author>]] — <c> ressource(s)[ · <dates distinctes triées join ' & '>][ · <authorDigests[aslug]>]`.
   Ligne vide + `---`.
5. **`## Ressources (R)`** — sous-sections `### <typeLabel(source_type)> (M)` **une par
   source_type distinct** (dédoublonne Article/Articles, Rapport PDF/Reports PDF via label
   canonique — cf. `TYPE_LABELS`/`ALL_TYPES` de `web/lib/ui.ts`). Bullets :
   `- [[resources/<slug>|<title>]] — <parts>` avec
   `parts = [author, date + (dateEstAnnéeSeule ? ' ⚠' : ''), resourceDigests[slug]].filter(Boolean).join(' · ')`.
   `dateEstAnnéeSeule` = `/^\d{4}$/.test(date)`. Ordre sous-sections : `ALL_TYPES` filtré aux
   présents ; ordre bullets : date desc puis slug. Ligne vide + `---`.
6. **`## Index par date`** — 1 bullet **par année distincte** (ressources à date non vide),
   tri asc : `- [[by-date/<Y>/<Y>|<Y>]] — <c> ressource(s)[ (dont <M> date exacte inconnue)]`,
   `M` = ressources à date `YYYY` pure ; suffixe seulement si `M>0`. Chemin **toujours**
   `by-date/<Y>/<Y>` (tue `2027/2026` + doublons). **Pas** de `---` après (comme l'actuel).
7. **`## Index par type`** — ligne vide — `→ [[types]]` (statique).
8. **`## Origine (O)`** — 1 bullet/origine présente :
   `- [[origin/<val>|<Externe|Interne>]] — <c> ressource(s)`. `O` = nb origines présentes.
Séparateurs `---` (ligne isolée entourée de lignes vides) **après** Thèmes/Entités/Auteurs/
Ressources ; **pas** entre Index par date / type / Origine.

**`buildByDate(resources): FileOp[]`** — regroupe par année/mois et **réémet chaque page en
entier** (tue `upsertMonthBullet`) :
- Page année `wiki/by-date/<Y>/<Y>.md` : frontmatter `type: by-date` / `period: "<Y>"` /
  `resource_count: <total année>` ; `## Date précise inconnue (année seulement)` + table des
  ressources à date `YYYY` pure ; `## Par mois` bullets
  `- [[by-date/<Y>/<Y>-MM/<Y>-MM|<Y>-MM]] — <k> ressource(s) (<auteurs distincts>)` triés asc.
- Page mois `wiki/by-date/<Y>/<Y>-MM/<Y>-MM.md` : frontmatter + table
  `| Ressource | Auteur | Type | Origin | Topics |`.
- Ressources à date vide : **ignorées** (miroir du garde `if (year)`).
- Réutiliser les gabarits `createYearPage`/`createMonthPage` (wiki-project.ts:383-397) et les
  gabarits de ligne (447, 481, 511). **Attention au pipe échappé `\|`** dans les wikilinks de table.

**`salvageDigests(priorIndex): { resourceDigests, authorDigests }`** — récupère la queue
curée par slug depuis l'`index.md` courant avant réécriture (les digests curés ne sont dans
aucun frontmatter, cf. Décisions §D3). Parser (fragile → **couvrir par test**) :
- Ressources : sur `- [[resources/<slug>|…]] — <tail>`, `parts = tail.split(' · ')` ; retirer
  en tête le token égal à `author`, puis le token égal à `date` (avec/sans ` ⚠`) ; le reste
  rejoint par ` · ` = digest.
- Auteurs : sur `- [[authors/<slug>|…]] — <tail>`, retirer `N ressource(s)` puis le bloc
  `dates & dates` ; reste = digest.
- Repli quand absent : `resourceTakeaway` = 1ʳᵉ phrase de section, déjà calculé par
  `firstSentence` (wiki-project.ts:409, `collectSections`). Pour le repli, `buildIndex`/
  l'orchestrateur peut recalculer le takeaway depuis le contenu de la ressource si souhaité,
  sinon laisser le digest vide (bullet = `author · date` seul).

#### 1.2 Tests `web/lib/__tests__/wiki-index.test.ts` (`node:test`)
Fixtures + assertions sur **chaînes exactes** : type dupliqué (Article/Articles → 1 seule
sous-section), date année-seule (`⚠` + `(dont M …)`), cap entités (registre 18 → 18 bullets),
salvage digest + repli, page mois, ressource sans date/auteur, pluralisation. Itérer jusqu'au
format pixel-exact.

#### 1.3 Orchestrateur `rebuildDerivedIndexes(today): Promise<FileOp[]>` (dans `ingest-local.ts`, exporté)
Charge l'état complet via loaders existants :
1. `listWikiDir('resources')` filtré `.md` → `readRepoFile` chacun → `parseResourceMeta`
   (wiki-mutate.ts:364) → `ResourceCard`.
2. `registries = await loadRegistries()` (ingest-local.ts:180 ; énumère 18 entités, 9 thèmes,
   labels).
3. `priorIndex = readRepoFile('wiki/index.md')` → `salvageDigests(priorIndex)`.
4. `indexOp = { path: 'wiki/index.md', content: buildIndex({ resources, entities, themes,
   today, typeLabel: wikiTypeLabel, slugifyAuthor: slugify, resourceDigests, authorDigests }) }`.
5. `byDateOps = buildByDate(resources)` **+ suppression des pages by-date orphelines** :
   énumérer `by-date/` existant (`listWikiDir`) et émettre `{ path, delete: true }` pour toute
   page année/mois à **zéro** ressource (utile au flux delete ; no-op à l'ingestion).
6. `return [indexOp, ...byDateOps]`. L'appelant applique via `applyFileOps`.
Contrainte Electron : n'utiliser que `readRepoFile`/`listWikiDir` (WIKI_ROOT-aware).

#### 1.4 Script de réparation `web/scripts/wiki-reindex.ts` (+ `"wiki:reindex": "tsx scripts/wiki-reindex.ts"` dans `web/package.json`)
Miroir de `wiki:verify` (`web/scripts/wiki-verify.ts`). Fixe `WIKI_ROOT` comme le fait
`runWikiVerify` (ingest-local.ts:143). Déterministe, **aucun appel IA**. Charge l'état,
`await applyFileOps(await rebuildDerivedIndexes(today))`. Lancé **une fois** → **répare
l'index/by-date corrompus actuels**.

#### 1.5 Câbler le rebuild (4 sites — 1 appel après l'`applyFileOps` existant)
| Fichier | Emplacement (ancre) | Corrige |
|---|---|---|
| `web/lib/ingest-local.ts` | **après** la boucle `for` d'ingestion (contient `applyFileOps(ops)` par fichier, [ligne 1044](web/lib/ingest-local.ts#L1044)), **avant** `phase('verify')`/`runWikiVerify` | passage final systématique |
| `web/app/api/candidates/resolve/route.ts` | après `await applyFileOps(ops)` ([ligne 126](web/app/api/candidates/resolve/route.ts#L126)) | **bug #4** : les 13 entités apparaissent |
| `web/app/api/theme-candidates/resolve/route.ts` | après `await applyFileOps(ops)` ([ligne 120](web/app/api/theme-candidates/resolve/route.ts#L120)) | symétrie thème |
| `web/app/api/sources/[slug]/route.ts` (DELETE) | après `await applyFileOps(ops)` ([ligne 126](web/app/api/sources/[slug]/route.ts#L126)) | index/by-date après suppression |
Chaque site : `await applyFileOps(await rebuildDerivedIndexes(today));` (récupérer `today` via
le helper de date existant du fichier, ou le format `YYYY-MM-DD`).
`web/lib/wiki-mutate.ts` **NON modifié** : ses écritures index/by-date deviennent transitoires,
écrasées par le rebuild → neutralise le bug `decrementCountOnLineWith` sans toucher au fichier figé.

**Digests = Option B (salvage) pour ce lot.**

### Phase 2 — Moteur : chemin unique déterministe (après validation Phase 1)
Retirer le code incrémental mort pour n'avoir **qu'un seul** chemin d'écriture des index :
- Retirer de `projectResource` : **op index #10** (wiki-project.ts:626) + **§5 by-date**
  (471-525).
- Supprimer (morts) : `updateIndex` (649-734), `incrementCountOnLineWith` (294-303),
  `upsertMonthBullet` (632-647), `addTypeSubsection` (768-790), `ensureEntitiesSection` (744-766).
- **Garder** : `collectSections`/`firstSentence`/`buildThemeBlock`/`buildEntityBlock`/`upsertBlock`
  /§8 graphe (encore utilisés par §2 thèmes et §6 entités de `projectResource`).
- Appelants à traiter avant suppression : `ensureEntitiesSection` est **exporté et importé par**
  `web/scripts/wiki-backfill-entities.ts` (lignes ~38, 82) dont `reconcileIndex` (78-102) fait
  « à la main » ce que `buildIndex` fait proprement → script obsolète : le remplacer par un appel
  à `rebuildDerivedIndexes`, ou le retirer (garder éventuellement sa partie rollup frontmatter
  `rollupSectionEntities`). Idem `web/scripts/wiki-backfill-topics.ts` (:126 appelle
  `projectResource` puis `reconcileIndex`).
- Mettre à jour `web/lib/__tests__/wiki-project.test.ts` (assertions index/by-date ~429-457,
  480-555 à réécrire/retirer).

### Phase 3 — Prompt : router par facettes
**Fichier :** `web/lib/chat-agent.ts`, fonction `buildSystemPrompt(filterDesc)` (351-411).
**100 % prompt.** `WIKI_TOOLS` (14-40) et le bloc filtres conditionnel `filterBlock` (352-360)
**inchangés**. Remplacer le template littéral (362-410) par la version ci-dessous (le
`${filterBlock}` reste inséré au même endroit).

**Prompt cible complet** (remplace lignes 362-410, `${filterBlock}` conservé) :
```
Tu es l'assistant d'une base de connaissances sur l'AI Coding. Cette base est un wiki markdown
que tu explores TOI-MÊME avec les outils `read_wiki_page` et `list_wiki_folder`.

STRUCTURE DU WIKI :
- index.md — sommaire général : thèmes, entités, auteurs, ressources, index par date/type/origine. COMMENCE TOUJOURS ICI.
- themes/<slug>.md — synthèses par thème, avec liens vers les ressources.
- authors/<slug>.md — pages par auteur (table : Ressource | Date | Type | Origin | Topics).
- entities/<slug>.md — pages par entité (organisations, produits, outils, personnes) ; chacune liste
  sous « ## Mentions » les ressources qui la citent, avec les sections précises concernées.
- by-date/<YYYY>/<YYYY>.md et by-date/<YYYY>/<YYYY-MM>/<YYYY-MM>.md — index chronologiques.
- types.md, origin/externe.md, origin/interne.md — index par type et par origine.
- resources/<slug>.md — les fiches ressources CANONIQUES (contenu détaillé + frontmatter :
  slug, title, author, date, source_type, origin, topics, url).

MÉTHODE — en deux temps.

TEMPS 1 : DÉCOMPOSE la question en FACETTES (dans ta tête, sans écrire une ligne). Repère
lesquelles de ces 6 facettes la question fixe, et vers quel index chacune pointe :
- THÈME (un sujet/concept : finops, context engineering, agentic coding, sécurité…) → themes/<slug>.md
- AUTEUR (QUI a produit la source : McKinsey, Anthropic, Fortune, CNBC…) → authors/<slug>.md
- ENTITÉ (un outil/produit/organisation/personne DONT PARLENT les sources : n8n, Claude Code, GPT-5…) → entities/<slug>.md
- DATE (une année ou un mois : 2026, 2026-04…) → by-date/<YYYY>/<YYYY>.md, ou en filtre (voir Temps 2)
- ORIGINE (interne = nos propres notes / externe = sources publiques) → origin/interne.md ou origin/externe.md
- TYPE (format : article, rapport PDF, notes perso, notes de réunion) → types.md
Piège AUTEUR vs ENTITÉ : « les rapports DE McKinsey » = auteur ; « ce qu'on dit SUR Anthropic »
= entité. Un même nom peut être les deux (Anthropic écrit ET est cité) : vérifie sous quel angle
il apparaît dans les sections « ## Auteurs » et « ## Entités » de index.md.

TEMPS 2 : NAVIGUE et CROISE.
1. Ouvre index.md pour trouver le slug exact de chaque facette repérée. Si une facette n'y figure
   pas, liste son dossier (ex. list_wiki_folder entities/) pour trouver le slug exact.
2. Choisis comme POINT D'ENTRÉE l'index de la facette la plus sélective (souvent auteur ou entité).
   Ouvre-le.
3. NE RETIENS QUE les lignes qui respectent TOUTES les autres facettes de la question. Un index
   n'est « pur » que sur sa propre facette : authors/mckinsey.md liste TOUTES les années de McKinsey
   — si la question dit 2026, écarte explicitement les lignes datées 2025. La colonne Date (ou Auteur)
   est déjà dans l'index : tu filtres en lisant, sans ouvrir un autre dossier.
4. Ouvre TOUTE fiche resources/ dont tu comptes exploiter ou citer le contenu — une fiche non ouverte
   ne doit jamais nourrir la réponse.
Cas d'une question purement de date (« qu'est-ce qui date de 2026 ? », sans autre facette) : construis
toi-même le chemin by-date/2026/2026.md (la page année pointe vers les pages mois). Granularité des
dates : « 2026 » englobe 2026, 2026-04, 2026-11 (tout mois de 2026) ; « 2025-11 » n'appartient PAS à 2026.
N'appelle PAS d'outil inutilement : arrête la navigation dès que tu peux répondre.
N'écris AUCUN texte avant ou entre tes appels d'outils : navigue d'abord, rédige ta réponse
UNIQUEMENT quand la navigation est terminée.

FIABILITÉ ET RECOUPEMENT :
- Les compteurs des vues dérivées peuvent être faux. Pour toute question d'ÉNUMÉRATION ou de COMPTAGE
  (« tout ce qui… », « combien… », « liste… »), recoupe avec `list_wiki_folder` (ex. le dossier
  resources/) pour vérifier que rien ne manque. Lister = obtenir des noms ; ne lis jamais toutes les
  fiches en masse.
- Le frontmatter des fiches resources/ fait foi pour un chiffre exact ou une métadonnée litigieuse
  (date, auteur).
${filterBlock}
RÈGLES DE RÉPONSE :
- Tu réponds EXCLUSIVEMENT à partir du contenu du wiki lu pendant cette conversation. N'utilise
  JAMAIS tes connaissances générales, même pour compléter. Si le wiki ne couvre pas la question,
  dis-le clairement et termine par SOURCES: []
- Si la question fixe une facette (date, auteur, entité, thème, origine, type), ta réponse ET ta ligne
  SOURCES ne doivent contenir QUE des ressources qui respectent TOUTES ces facettes — écarte
  silencieusement les autres (mauvaise année, mauvais auteur…).
- Termine TOUJOURS ta réponse par une ligne dédiée :
  SOURCES: [{"slug":"...","title":"...","type":"...","author":"...","date":"..."}]
  N'y mets QUE des fiches (resources/<slug>.md) réellement OUVERTES avec read_wiki_page pendant
  cette conversation, avec les valeurs exactes de leur frontmatter. Exception : pour une question
  d'énumération ou de comptage dont la réponse ne restitue que des métadonnées d'index
  (titre/date/auteur), tu peux citer des fiches identifiées via les index sans les ouvrir —
  ne lis jamais toutes les fiches en masse.
- Réponds en français. Sois concis et factuel. Ne décris pas ta navigation dans la réponse.
```
Changements vs prompt actuel : (a) `MÉTHODE` réécrite en 2 temps avec la table de routage 6
facettes + distinction auteur/entité + discipline de filtrage + cas date pure ; (b)
`FIABILITÉ` : retrait de la ligne discréditant `by-date/` et du biais « dates au frontmatter »
(gardé : compteurs faux → recouper ; frontmatter fait foi) ; (c) `RÈGLES DE RÉPONSE` : ajout de
la règle « si la question fixe une facette, réponse+SOURCES ne contiennent QUE ce qui respecte
TOUTES les facettes ». Discrétion conservée (« ne décris pas ta navigation »).

---

## Décisions

- **D1 — Routage par facettes 100 % prompt, pas de code.** Alternatives écartées :
  (b) planificateur déterministe pré-passe qui détecte les facettes contre le vocabulaire du
  wiki ; (c) `graph.json` comme moteur de requête pré-filtrant ; (d) filtres durs auto-dérivés
  validés côté serveur. Arthur veut explicitement **aucun code de routage en dur** : l'IA
  décompose et navigue elle-même. Retenu : Levier 1 (prompt seul).
- **D2 — L'IA reste discrète.** Alternative écartée : annoncer en tête de réponse les facettes
  comprises (« Compris : auteur McKinsey, année 2026 ») pour transparence. Arthur a choisi la
  discrétion (réponses plus courtes). Le prompt conserve « ne décris pas ta navigation ».
- **D3 — Régénérer `index.md`/`by-date` en entier, pas de rustines ciblées.** Alternative
  écartée : corriger un par un le regex `incrementCountOnLineWith`, la condition entités, le
  garde d'idempotence, faire écrire l'index par `applyEntityDecision`, + script de nettoyage
  ponctuel. Raison du rejet : garde l'architecture incrémentale fragile (nouveaux cas limites
  possibles) et nécessite un nettoyage manuel. Retenu : reconstruction intégrale depuis l'état
  canonique (comme `graph.json`) — « jamais cassé par construction », répare automatiquement.
- **D4 — Corriger le moteur (pas éditer `index.md` à la main).** `index.md` est une vue dérivée
  régénérée par code ; l'éditer à la main serait écrasé à la prochaine ingestion (rustine). Donc
  correction dans le moteur.
- **D5 — Digests : Option B (salvage) pour ce lot.** Les résumés d'une ligne curés
  (« factory agentique ; 2 shifts + 3 enablers ») n'existent que dans `index.md`, dans aucun
  frontmatter, non dérivables (rédigés par l'IA au 1ᵉʳ run ; cf. `wiki-backfill-entities.ts:19-20`).
  Option A (canoniser un champ `summary:` + migrer + étendre le contrat IA) reportée. Option B :
  `buildIndex` récupère les digests curés depuis l'index courant avant réécriture, repli
  déterministe `takeaway`. Zéro perte, zéro changement de schéma/prompt d'ingestion.
- **D6 — Séquencement en 3 phases, code fragile touché en dernier.** Phase 1 ajoute le rebuild
  qui **écrase** la sortie buggée (valeur + réparation immédiates) sans toucher `wiki-mutate.ts`
  ni supprimer de code. Phase 2 (suppression du code mort + maj tests) séparée pour découpler le
  risque. Phase 3 (prompt) après, car elle dépend d'index fiables.
- **D7 — `wiki-mutate.ts` non modifié.** Ses écritures index/by-date deviennent transitoires et
  sont écrasées par le rebuild de fin de route → le bug `decrementCountOnLineWith` est neutralisé
  sans toucher au fichier figé/testé.

---

## Hors périmètre

- **Option A — champ `summary:` canonique.** Ajouter `summary:` au frontmatter des
  ressources/auteurs pour que les **futures** ressources portent un résumé curé (et non le repli
  `takeaway`), migrer les digests salvés, étendre le contrat de sortie de l'IA d'ingestion
  (prompt système + parseur `ingestOne`). Non nécessaire tant que le salvage suffit.
- **Faire vérifier `index.md`/`by-date` par `wiki-verify.ts`** (aujourd'hui il ne juge que
  `graph.json`/registres). Amélioration de filet de sécurité, non requise ici.
- **Aucun moteur de routage codé** dans le chat (D1) : pas de détection de facettes en code, pas
  de pré-filtrage, pas d'exposition de `graph.json` au chat.
- **Réordonnancement/format** : le rebuild réordonne les bullets de façon déterministe (gros diff
  attendu, l'ordre actuel étant corrompu) ; la structure (headings, séparateurs, syntaxe
  wikilink) reste identique.

---

## Todo

### Phase 1 — moteur : régénération + réparation
- [x] **1.1** Créer `web/lib/wiki-index.ts` : `buildIndex`, `buildByDate`, `salvageDigests`,
  type `ResourceCard`/`IndexInput` (purs, aucun I/O, aucun import `@/…`). *Vérif :* le fichier
  compile (`cd web && npx tsc --noEmit`) ; import relatif de `./wiki-mutate` OK. ✅
- [x] **1.2** Créer `web/lib/__tests__/wiki-index.test.ts` couvrant : dédoublonnage type
  (Article/Articles), date année-seule (`⚠` + `(dont M …)`), entités depuis registre,
  salvage digest + repli, page mois, ressource sans date/auteur, pluriel. *Vérif :*
  `cd web && npm test` → tests verts, assertions sur chaînes exactes. ✅ (14 tests verts)
- [x] **1.3** Ajouter `rebuildDerivedIndexes(today)` exporté dans `web/lib/ingest-local.ts`
  (charge via `listWikiDir`/`readRepoFile`/`parseResourceMeta`/`loadRegistries`/`salvageDigests`,
  injecte `wikiTypeLabel` + `slugify`). *Vérif :* compile ; scratch script → `FileOp[]` non vide
  avec `wiki/index.md`. ✅ (13 ops : index + 12 by-date)
- [x] **1.4** Créer `web/scripts/wiki-reindex.ts` + entrée `"wiki:reindex"` dans
  `web/package.json`. *Vérif :* `cd web && npm run wiki:reindex` s'exécute et écrit index + by-date. ✅
- [x] **1.5** RÉPARER l'existant : lancer `npm run wiki:reindex` une fois. *Vérif (greps) :*
  entités = **19** (état réel, pas 18) ; `entity_count: 19`, `theme_count: 11` ; `entities/n9n`
  **vide**, `entities/n8n` présent ; `by-date/2027`/`by-date/2025/2026` **vides** ; plus de
  `— 3 ressource` ; `## Ressources` a **un seul** `### Article` et `### Rapport PDF`. ✅
- [x] **1.6** IDEMPOTENCE : relancer. *Vérif :* hash des vues dérivées **identique** au 2ᵉ passage. ✅
- [x] **1.7** NON-RÉGRESSION `graph.json` : `wiki/graph.json` **byte-identique** au baseline
  (hash `c0f02b8…`) ; `npm run wiki:verify` **0 erreur**. ✅
- [x] **1.8** Câbler le rebuild aux 4 sites (ingest-local après boucle ;
  candidates/resolve après applyFileOps ; theme-candidates/resolve ; sources/[slug] DELETE). *Vérif
  (copie scratch isolée, WIKI_ROOT surchargé) :* résolution d'un candidat entité → la nouvelle
  entité apparaît dans `## Entités` ; suppression d'une ressource → lignes retirées d'index/by-date
  + pages by-date orphelines purgées. ✅
- [x] **1.9** VÉRIF COMPORTEMENTALE chat (entités jadis invisibles). *Vérif (chat live, vraie clé) :*
  « qu'a-t-on dit sur Cursor ? » → l'agent ouvre `entities/cursor.md` via `## Entités` et cite
  la bonne ressource. ✅

### Phase 2 — moteur : nettoyage (après Phase 1 validée)
- [x] **2.1** Retirer de `projectResource` l'op index #10 et le §5 by-date (variables de date
  conservées pour le graphe §8). *Vérif :* nouveau test « projectResource n'émet PLUS aucune op
  index.md ni by-date » vert ; `wiki:verify` 0 erreur. ✅
- [x] **2.2** Supprimer le code mort : `updateIndex`, `incrementCountOnLineWith`, `upsertMonthBullet`,
  `addTypeSubsection`, `ensureEntitiesSection` + helpers désormais orphelins (`insertBulletUnderHeading`,
  `createYearPage`/`createMonthPage`) + imports `bumpScalarInt`/`adjustHeadingCount`. Backfill scripts
  **rewirés** : `reconcileIndex` (et ses helpers) remplacés par `rebuildDerivedIndexes`. *Vérif :*
  `npx tsc --noEmit` sans erreur ; grep dead-refs → seulement des commentaires. ✅
- [x] **2.3** Mettre à jour `web/lib/__tests__/wiki-project.test.ts` (tests index/by-date réécrits
  ou convertis ; round-trip seedé via `buildByDate` pour rester fidèle au vrai flux). *Vérif :*
  `npm test` → **158/158** verts. ✅

### Phase 3 — prompt : router par facettes
- [x] **3.1** Remplacer le template littéral de `buildSystemPrompt` par le prompt cible
  (`${filterBlock}` conservé ; `WIKI_TOOLS`/`filterBlock` inchangés). *Vérif :* compile ;
  `buildSystemPrompt('')` contient « TEMPS 1 » + la règle facette et PAS de bloc filtres ;
  `buildSystemPrompt('type ∈ {article}')` contient le bloc filtres. ✅
- [x] **3.2** VÉRIF COMPORTEMENTALE « McKinsey 2026 » (chat live). *Vérif :* navigation index.md →
  authors/mckinsey.md → ouverture des SEULES 2 fiches 2026 ; `SOURCES:` = `rewiring…` (2026-05) +
  `ai-revolution…` (2026-04), **PAS** `unlocking-value…` (2025-11). ✅
- [x] **3.3** VÉRIF par facette (chat live) : date pure « 2026 » (→ by-date/2026, énumération
  correcte 18 ressources, 0 fuite 2025), origine « nos notes internes » (→ origin/interne.md),
  thème « FinOps » (→ themes/finops-ia.md, SOURCES = fiches ouvertes). ✅

---

## Bilan

### Ce qui a été fait
**Phase 1 (moteur — réparation + valeur).**
- **`web/lib/wiki-index.ts`** (nouveau, pur, testable) : `buildIndex` régénère `index.md` en
  entier (thèmes/entités/auteurs/ressources/date/type/origine) au format exact ; `buildByDate`
  réémet chaque page année/mois ; `salvageDigests` récupère les résumés d'une ligne curés depuis
  l'index courant (Option B — zéro perte, zéro changement de schéma) ; `expectedByDatePaths` sert
  à purger les pages orphelines. **14 tests** sur chaînes exactes.
- **`rebuildDerivedIndexes(today)`** (dans `ingest-local.ts`) : charge l'état canonique
  (ressources + registres), appelle les fonctions pures, purge les pages by-date orphelines.
- **`web/scripts/wiki-reindex.ts`** + `npm run wiki:reindex` : réparateur one-shot / filet manuel.
- **Réparation appliquée** au vrai wiki : `index.md` passe de 6 entités affichées (plafond) à
  **19** (registre complet), `theme_count` 12→**11** (compteur faux corrigé), slugs `n9n`→`n8n`,
  chemins `by-date/2027/2026`/`2025/2026` éliminés, sous-sections de type dédoublonnées
  (`### Articles`+`### Article` → un seul `### Article`), pluriels corrigés. `graph.json`
  **byte-identique** (jamais touché), `wiki:verify` **0 erreur**, régénération **idempotente**.
- **Rebuild câblé aux 4 sites** (fin d'ingestion + résolution candidat entité/thème + suppression),
  ce qui corrige le **bug #4** (les entités créées par résolution de candidat apparaissent enfin
  dans l'index) et purge les pages by-date orphelines à la suppression.

**Phase 3 (prompt — la demande d'origine).** `buildSystemPrompt` réécrit en 2 temps
(décomposition en 6 facettes → navigation croisée), avec discipline de filtrage (« écarte la
mauvaise année/auteur »), suppression de la défiance envers `by-date/`, et règle SOURCES ⊆ facettes.
**Prouvé en chat réel** : « McKinsey 2026 » ne ressort plus le rapport de 2025 ; entités jadis
invisibles trouvées ; date pure / origine / thème routés correctement.

**Phase 2 (nettoyage — chemin d'écriture unique).** `projectResource` n'écrit plus `index.md` ni
`by-date` ; ~250 lignes de code incrémental fragile supprimées (`updateIndex`, `upsertMonthBullet`,
`ensureEntitiesSection`, `addTypeSubsection`, `incrementCountOnLineWith`, helpers orphelins) ; les 2
scripts de backfill rewirés vers `rebuildDerivedIndexes`. `wiki-mutate.ts` **non modifié** (figé).

### Écarts vs le plan (et pourquoi)
1. **État réel ≠ snapshot de la spec.** Le wiki avait dérivé entre l'écriture de la spec et
   l'implémentation : **19 entités / 11 thèmes / 23 ressources** (la spec disait 18/9). Le code
   pilote tout par les registres réels ; les greps de vérif ont été adaptés aux compteurs réels.
2. **Ordre des phases : 1 → 3 → 2** (au lieu de 1 → 2 → 3). Phase 3 (prompt) est la demande
   d'origine d'Arthur et est à faible risque ; la faire avant Phase 2 a permis de livrer la valeur
   tôt et de **batcher les tests chat payants** (1.9 + 3.2 + 3.3) en une seule session, avec le
   prompt final. Phase 2 (hygiène, plus risquée, sans valeur utilisateur) faite en dernier. Les 3
   phases sont livrées.
3. **`IndexInput.typeOrder` ajouté** (non prévu littéralement dans la spec) : pour trier les
   sous-sections de type selon `ALL_TYPES` sans importer `ui.ts` (qui tire `@/types`) dans le
   module pur. L'orchestrateur injecte `ALL_TYPES.map(typeLabel)`.
4. **`salvageDigests(priorIndex, cards)`** prend les cartes en 2ᵉ argument (la spec écrivait
   `salvageDigests(priorIndex)`) : impossible de retirer proprement le token « auteur » d'un bullet
   sans connaître l'auteur de la ressource (l'auteur n'est pas reconnaissable par motif, la date
   oui). Décision de COMMENT, sans impact sur le contrat.
5. **Helpers supplémentaires supprimés** au-delà de la liste de la spec (`insertBulletUnderHeading`,
   `createYearPage`/`createMonthPage`) : rendus morts par le retrait du §5 by-date → retirés pour
   « zéro code mort ».
6. **Détail découvert (pas un bug) :** le nettoyage graphe de `deleteResource` (nœuds date + arête
   `year_of`) dépend de l'existence de la page by-date du mois. Dans le vrai flux elle existe (créée
   par `rebuildDerivedIndexes`) → OK ; le test round-trip a été rendu fidèle en seedant `by-date`
   via `buildByDate` avant la suppression.

### Hors périmètre (laissé tel quel, à raison)
- 2 ressources (`panorama…`, une autre) ont des entités annotées en section mais absentes de leur
  frontmatter. Sans impact sur les **compteurs d'index** (`buildIndex` compte l'union
  frontmatter ∪ chunk). C'est le rôle de `wiki:backfill-entities` (hors de cette spec) de remonter
  ces entités au frontmatter (utile au graphe / colonne topics), non requis ici.
- Répertoires `by-date/<Y>/` **vides** laissés après purge des `.md` orphelins (`applyFileOps`
  supprime des fichiers, pas des dossiers — comportement identique à `deleteResource`). Inoffensif.

### Vérification globale
`npm test` → **158/158** ; `npx tsc --noEmit` propre ; `npm run wiki:verify` → **0 erreur** ;
reindex **idempotent** ; `graph.json` inchangé ; **5 requêtes chat réelles** validées.

---

## Fichiers

**Créer :** `web/lib/wiki-index.ts`, `web/lib/__tests__/wiki-index.test.ts`,
`web/scripts/wiki-reindex.ts` (+ `wiki:reindex` dans `web/package.json`).
**Modifier :** `web/lib/ingest-local.ts` (orchestrateur + hook), `web/app/api/candidates/resolve/route.ts`,
`web/app/api/theme-candidates/resolve/route.ts`, `web/app/api/sources/[slug]/route.ts`,
`web/lib/chat-agent.ts` (prompt), puis Phase 2 : `web/lib/wiki-project.ts`,
`web/lib/__tests__/wiki-project.test.ts`, `web/scripts/wiki-backfill-entities.ts`,
`web/scripts/wiki-backfill-topics.ts`.
**Ne pas modifier :** `web/lib/wiki-mutate.ts` (figé). **Gabarit de format :** `wiki/index.md`.
