# Ingestion locale peu coûteuse (« IA + déterministe »)

## Contexte

**Demande d'origine.** Le POC d'ingestion coûte **6,64 $ pour une seule
ressource** (375 s, 65 allers-retours modèle, 33 écritures, routé Sonnet 4.5 via
la gateway LiteLLM). Objectif : descendre à **quelques dizaines de centimes** par
dépôt (Sonnet retenu pour la fidélité — cf. Décisions).

**Ce que fait l'ingestion.** Elle transforme une source brute déposée dans `raw/`
en une page wiki canonique `wiki/resources/<slug>.md` **plus ~25 vues dérivées**
(dossiers `themes/`, `authors/`, `entities/`, `by-date/`, plus `types.md`,
`origin/`, `index.md`, `graph.json`, `_ingested.json`, `log.md`). Elle tourne
**in-process** dans `web/` (Next.js), déclenchée automatiquement en fin d'upload
et par un bouton de relance manuelle (ni cron ni watcher ; la détection idempotente
par `_ingested.json` rattrape au prochain déclenchement). Elle utilise aujourd'hui
un agent Claude Code embarqué (`@anthropic-ai/claude-agent-sdk`, `query()`),
authentifié en **Bearer** (`ANTHROPIC_AUTH_TOKEN`) vers la gateway
(`ANTHROPIC_BASE_URL=https://llm-gateway.m33.tech`, `ANTHROPIC_MODEL=claude-sonnet-4-6`
routé côté gateway vers Sonnet 4.5).

**Causes racines du coût** (confirmées par lecture du code) :
1. L'agent édite lui-même les ~25 vues, **une écriture = un tour** facturé.
2. Boucle agentique : l'historique complet est renvoyé au modèle **à chaque tour**,
   et l'agent lit/garde en contexte de gros fichiers (`graph.json`, `index.md`).
3. Prompt utilisateur **géant** : `prompts/ingest-prompt.md` + `CLAUDE.md` +
   `docs/ingestion.md` + `docs/wiki-spec.md` + `docs/entities.md` concaténés.
4. **Aucun prompt caching** posé par le code, **jamais vérifié** à travers la
   gateway ; **aucun logging du `usage`** (seul `total_cost_usd` est loggé).

Or les ~25 vues sont **entièrement déductibles** du frontmatter + des annotations
de chunk de la page ressource. D'où le plan ci-dessous.

---

## Plan

*(Contenu intégral du plan validé, enrichi de la référence technique nécessaire à
l'autosuffisance — voir aussi la section « Référence technique » en fin de spec.)*

### Approche retenue — deux leviers combinés

#### A. Scinder « IA + déterministe »
- **L'IA ne produit QUE `wiki/resources/<slug>.md`** (frontmatter + blockquote de
  nav + corps paraphrasé fidèle + annotations `` `topics:` ``/`` `entities:` `` par
  section) + la **détection** des entités/thèmes inédits.
- Une **nouvelle fonction déterministe `projectResource(...)`** (symétrique de
  `deleteResource`, dans un **nouveau module `web/lib/wiki-project.ts`**, sans
  toucher à `web/lib/wiki-mutate.ts`) reconstruit **toutes** les vues à partir de
  cette page. Zéro LLM.

#### B. Remplacer l'agent Claude Code par un appel Messages API unique
Le chat utilise déjà `@anthropic-ai/sdk` avec `x-api-key` **qui passe la gateway**
(`web/lib/claude.ts:12-19`). On abandonne `claude-agent-sdk` (boucle multi-tours,
prompt système Claude Code géant, auth Bearer fragile, binaire natif) au profit
d'**un appel `anthropic.messages.create` par ressource** :
- **système** = prompt d'ingestion **court** (rôle + schéma de frontmatter + enum
  `source_type` + heuristique `origin` + format des annotations + règles de liens +
  **snapshot compact des registres** thèmes/entités connus), marqué
  `cache_control: {type:'ephemeral'}`.
- **user** = contenu brut de `raw/<file>` (+ sidecar `raw/<file>.meta.md`) **passé
  inline** (plus de lecture par outil).
- **sortie** = la page `.md` + un bloc final `<detected-new>` (JSON) listant les
  entités/thèmes inédits.

**Format de sortie = texte délimité, PAS `output_config.format`** : les sorties
structurées ne sont pas garanties sur Sonnet 4.5 ni à travers LiteLLM. Parser un
`.md` délimité + un bloc `<detected-new>` en fin.

### Contraintes & invariants

- **NE PAS modifier `web/lib/wiki-mutate.ts`** (moteur pur figé/testé). Réutiliser
  ses helpers **exportés** ; ré-implémenter ses briques **privées** dans
  `wiki-project.ts`.
- La sortie doit passer **`npm --prefix web run wiki:verify`** sans erreur.
- **Point non-évident capital** (audit de `web/scripts/wiki-verify.ts`) : le verify
  **ne lit PAS le corps** de `themes/`, `authors/`, `by-date/`, `types.md`,
  `index.md`. Le pass/fail porte sur : **(a)** `graph.json` (nodes + edges des 7
  relations), **(b)** `_ingested.json`, **(c)** dédoublonnage registres
  entités/thèmes, **(d)** existence non vide des 2 pages `origin/`, **(e)**
  complétude des liens entités/thèmes dans la prose (`missed-link`/`missed-theme-link`
  = warnings). → **Priorité absolue de `projectResource` : `graph.json` + manifeste
  exacts.** Les formats markdown des vues sont exigés par la spec (fidélité) mais ne
  font pas échouer le verify.
- **Deux slugs distincts** : `slugify` (`web/lib/wiki-parser.ts:31` — enlève accents,
  réduit les tirets) pour fichiers/nodes ; `headingSlug` (`web/lib/wiki-mutate.ts:56`,
  **exporté** — garde accents, ne réduit pas) pour les ancres `[[..#ancre|..]]`.
- **Slugs immuables** ; l'IA ne relie qu'à des slugs **connus** (registre) — tout
  inédit part en **candidate** `_candidates.json` (arbitrage humain existant,
  inchangé). Cela satisfait exactement `unknown-theme`/`unknown-entity`.
- `raw/` immuable : `projectResource` **ne récrit pas** les fichiers bruts.

### Fichiers à créer / modifier

| Fichier | Action |
|---|---|
| `web/lib/wiki-project.ts` | **Créer** : `projectResource(input): FileOp[]` + briques ré-implémentées |
| `web/lib/__tests__/wiki-project.test.ts` | **Créer** : unitaires + round-trip avec `deleteResource` |
| `web/lib/ingest-local.ts` | **Réécrire** le cœur : `query()` agent → boucle `anthropic.messages` + projection + logging `usage`/coût |
| `prompts/ingest-prompt.md` | **Réécrire** en prompt **système court** (distille format ressource + règles de liens ; on cesse d'injecter les docs entières) |
| `web/components/upload/IngestStatus.tsx` | **Nettoyer** les textes UI périmés (« commit /raw → Action », « rattrapage chaque nuit ») **+ afficher le coût** en fin d'ingestion (cf. « Affichage du coût ») |
| `web/app/api/ingest-status/route.ts` | **Étendre** la réponse pour porter `costUsd` (+ `perFile`) |

Helpers **exportés réutilisables** de `wiki-mutate.ts` : `parseResourceMeta`,
`splitFrontmatter`/`withFrontmatter`, `setScalar`/`bumpScalarInt`/`patchInlineArray`,
`adjustHeadingCount`, `countResourceBlocks`/`countTableRows`, `parseGraph`/`serializeGraph`,
`headingSlug`, `addChunkLink`, `addThemeToNav`. Injecter `slugify`
(`web/lib/wiki-parser.ts:31`) et `typeLabel` (`web/lib/ui.ts:51`) comme le fait la
route DELETE (`web/app/api/sources/[slug]/route.ts:13-23`).

### Détail — `projectResource(input): FileOp[]`

Signature **miroir** de `deleteResource` (voir corps verbatim en Référence
technique §R7) : `{ slug, resourceContent, views: ProjectViews, slugifyAuthor,
typeLabel } → FileOp[]`. La route parse le frontmatter de la sortie IA pour savoir
quelles vues charger (comme la route DELETE), les lit **fraîches sur disque**,
appelle la fonction pure, puis `applyFileOps(ops)` (`web/lib/wiki-fs.ts:68`).
`ProjectViews` porte le contenu courant de chaque vue, **`null` = page à créer**.

Op par op (inverse exact de `deleteResource`) :
1. `wiki/resources/<slug>.md` ← écrit (op #1).
2. **themes/** : pour chaque `topic` du frontmatter, upsert bloc `## [[../resources/<slug>|Titre]]`
   + ligne méta backtickée `` `date · source_type · origin — author` `` + puces
   `- [[../resources/<slug>#<headingSlug(section)>|Section]] — <takeaway>` (une par
   section dont l'annotation `topics:` contient ce thème ; sinon `- Ressource entière — <takeaway>`).
   Recompute `resource_count` via `countResourceBlocks(rest,'##')`. Page thème
   **toujours existante** (registre gardé) — être défensif si `null`. Idempotence :
   si un bloc existe déjà pour ce slug, le remplacer.
3. **authors/** : page à **créer** si auteur nouveau (frontmatter `type:author`/`slug`/`label`/`resource_count:1`
   + table 1 ligne), sinon ajouter la ligne + `bumpScalarInt(resource_count,+1)`.
4. **origin/** : upsert bloc `## [[..]]` + `` `date · source_type · author` `` (PAS d'origin
   dans la méta), recompute count. Page toujours existante.
5. **by-date/** : page **mois** à créer si absente, page **année** à créer si absente ;
   ajouter la ligne/la puce mois, recompute counts. Normalisation : `date.length>=7` → mois.
6. **entities/** : pour chaque entité (frontmatter ∪ chunks), upsert bloc `### [[../resources/<slug>|Titre]]`
   dans `## Mentions` + `` `date · source_type — author` `` + puces (`- Ressource entière : …`
   deux-points, ou `- [[..#ancre|Section]] — …`). Page entité existante si l'entité est **connue** ou **déclarée** ; si elle est **déclarée mais nouvelle**, la page est **créée** ici (frontmatter `type:entity`/`entity_type`(déclaré)/`slug`/`label`/`aliases`) — cf. §R11. `ProjectViews` porte donc, pour chaque entité sans page, son `entity_type` déclaré.
7. **types.md** : ajouter la ligne + incrémenter/créer le heading `## <source_type brut> (N ressources)`.
8. **graph.json** *(CRITIQUE)* : upsert node `resource:<slug>` (`label`, `date`)
   + edges `written_by`→`author:<slugify>`, `has_type`→`type:<source_type>`,
   `has_origin`→`origin:<val>` (absent si origin=""), `belongs_to_theme`→`theme:<t>`
   (par topics **frontmatter**), `mentions`→`entity:<e>` (avec `sections:[...]` si
   niveau chunk), `published_on`→`date:<AAAA[-MM]>`, `year_of` (`date:AAAA-MM`→`date:AAAA`).
   Upsert nodes `author:/type:/date:` manquants. Sérialiser via `serializeGraph`.
9. **_ingested.json** : `addManifestKey` (**helper neuf**, inverse de `removeManifestKey`) :
   clé = `source_file` exact → `{ slug, ingested_at, run:"local" }`.
10. **index.md** : ajouter le bullet ressource sous le bon sous-titre de type,
    incrémenter `## Ressources (N)` + `### <TypeLabel> (N)` (via `adjustHeadingCount(..,+1)`) ;
    bullet auteur si nouveau + `author_count` ; incrémenter compteurs thèmes/origin/date ;
    `resource_count` frontmatter.
11. **raw/** : rien (immuable).
12. **log.md** : entrée append-only optionnelle (le verify l'ignore) — faite par la
    route, pas par `projectResource`.

**Briques à ré-implémenter dans `wiki-project.ts`** (privées dans `wiki-mutate.ts`,
non importables — cf. Référence technique §R5/§R6) : constructeurs de blocs
thème/entité + lignes méta, upserts de graphe (`upsertNode` + edges), insertion
**ordonnée** dans une vue existante (neuf), `addManifestKey`, extraction du
**takeaway = première phrase de la section**.

### Détail — refonte `web/lib/ingest-local.ts`

Conserver **tel quel** : verrou (`acquireLock`/`releaseLock`/`lockHeld` lignes 72-94),
`detectPending` (103-122), état persistant (`readIngestState`/`writeIngestState` 54-67),
`runWikiVerify` (126-146). **Remplacer** le bloc `query()` agent (lignes 189-248) par,
**pour chaque `pending` (boucle, un appel par ressource)** :
1. Lire `raw/<file>` + `raw/<file>.meta.md`.
2. `anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 16000,
   system:[{type:'text', text: SYSTEM_PROMPT_INGEST, cache_control:{type:'ephemeral'}}],
   messages:[{role:'user', content: <brut + sidecar + consigne de sortie>}] })` — via
   le client exporté `anthropic` de `web/lib/claude.ts` (x-api-key gateway). Streamer
   si sortie longue.
3. Parser la réponse : page `.md` + bloc `<detected-new>`.
4. **Calculer et remonter le coût** : depuis `usage` (`input_tokens`, `output_tokens`,
   `cache_creation_input_tokens`, `cache_read_input_tokens`) × barème Sonnet §R8, calculer
   le **coût par ressource** et l'accumuler en **coût total du run**. Écrire l'`usage`
   détaillé dans `ingest.log` ET stocker un champ **structuré `costUsd`** (total, + option
   `perFile:[{file, costUsd}]`) dans `ingest-state.json` (pour l'UI). Si la gateway expose
   son propre coût (en-tête réponse type `x-litellm-response-cost`, lisible via la réponse
   brute du SDK), **le préférer** au coût estimé. Montant en **USD** ; **estimation** basée
   sur les tarifs publics Sonnet quand aucun coût gateway n'est fourni.
5. Parser le frontmatter, charger les vues concernées, `projectResource` → `applyFileOps`.
6. **Confiance graduée entités/thèmes** (cf. §R11, `docs/entities.md §4`) : les
   entités/thèmes **déclarés au sidecar** (autoritaires) → création directe de la page
   si nouveaux (règle de slug suffixé pour collision de type) + lien ; les
   entités/thèmes **détectés et inconnus** (bloc `<detected-new>`) → entrées candidates
   dans `wiki/entities/_candidates.json` / `wiki/themes/_candidates.json` ; les connus →
   simple lien. Arbitrage humain des candidates inchangé.

**Testabilité (structurer pour ça)** : isoler l'appel modèle dans une petite fonction
**injectable** `generateResource(raw, sidecar) → { markdown, detectedNew }` (le vrai
modèle en prod ; une sortie « en conserve » en test). Tout le reste — parsing de la
sortie, confiance graduée (§R11), écriture des candidates, `projectResource`,
`applyFileOps`, log `usage` — forme alors une **tuyauterie déterministe testable sans
appel payant** (cf. Todo « Test d'intégration de la chaîne »).

Prompt système (identique d'une ressource à l'autre dans un run → **cache hits dès la
2ᵉ ressource**) : schéma frontmatter, enum `source_type`, heuristique `origin`
(+ `needs_review` **uniquement** si origin indéductible), format blockquote nav +
annotations, règle « ne relier qu'aux slugs **connus** (registres injectés) ; détecter
les inédits dans `<detected-new>` », mandat de fidélité (chiffres/citations/exemples).

**Simplifications** : supprimer `fakeHome`/`CLAUDE_CONFIG_DIR`/`ANTHROPIC_AUTH_TOKEN`
(Bearer), `canUseTool` + `WRITE_TOOLS` (l'IA n'écrit plus), l'injection des docs
entières (`INJECTED_DOCS`). Corriger le résidu `run:"gha"` → `run:"local"` du prompt.

### Affichage du coût à l'utilisateur (exigence produit)

À la fin de chaque ingestion, la plateforme **affiche le coût** à l'utilisateur (pas
seulement dans les logs). Chaîne complète :
`runIngestion` calcule le coût (étape 4 ci-dessus) → **étendre l'interface `IngestState`**
(`web/lib/ingest-local.ts:38`) avec `costUsd?: number` (total du run) et
`perFile?: { file: string; costUsd: number }[]` → `GET /api/ingest-status` renvoie ces
champs → `IngestStatus.tsx` les affiche dans l'état **terminé** (ex. « Ingestion terminée —
coût ≈ $0,18 »). Formater les petits montants en cents (« ≈ 18 ¢ »). Indiquer discrètement
qu'il s'agit d'une **estimation en USD** (tarifs Sonnet), ou du **coût gateway** si
disponible. `costUsd` est aussi persisté dans `ingest-state.json` (survit au rechargement).

---

## Référence technique (auto-suffisance — extraits d'exploration)

### R1. Frontmatter d'une ressource `wiki/resources/<slug>.md` (noms RÉELS)

| Champ | Format | Notes |
|---|---|---|
| `slug` | string non quoté | dérivé du **titre** via `slugify`, ≤ ~60 chars, **immuable** |
| `title` | string **quoté** | titre complet |
| `author` | string **quoté** | **singulier** (`author`, pas `authors`) — personne OU organisation |
| `date` | string **quoté** | `AAAA` \| `AAAA-MM` \| `AAAA-MM-JJ` |
| `source_type` | string non quoté (enum) | `article`\|`report-pdf`\|`tweet`\|`interview`\|`presentation`\|`meeting-notes`\|`transcript`\|`personal-notes` |
| `origin` | string non quoté | `interne`\|`externe`\|`""` |
| `topics` | **liste plate de slugs de thèmes** `[finops-ia, agentic-coding]` | champ « thèmes/tags » (pas de champ `themes`/`tags`) |
| `entities` | **liste plate de slugs**, optionnel `[claude-code]` | pas de `tools`/`clients` (ce sont des `entity_type` du registre) |
| `url` | string **quoté** | |
| `source_file` | string **quoté** | nom EXACT du fichier de contenu dans `/raw` (pas le `.meta.md`) |
| `needs_review` | booléen | `true` **uniquement** si `origin` indéductible |

**Corps** : (1) blockquote nav sous le frontmatter
`> Par [[../authors/<slug>|Label]] · [[../by-date/2026/2026|2026]] · Thèmes : [[../themes/<slug>|Label]]`
(le lien by-date pointe le **mois** si connu) ; (2) sous chaque heading `##`/`###`,
annotations inline-code `` `topics: [finops-ia, outils-et-marche]` `` et optionnel
`` `entities: [claude-code, n8n]` `` (regex verify exige la forme exacte) ; (3) contenu
intégral paraphrasé, une section = un `##`/`###`, fidélité totale.

### R2. Formats des vues dérivées (exemples réels sous `wiki/`)

- **`themes/<slug>.md`** (ex. `wiki/themes/finops-ia.md`) : frontmatter `type:theme`/`slug`/`label`/`aliases`(opt)/`resource_count`/`last_updated` ; corps blocs `## [[../resources/<slug>|Titre]]` + ligne méta `` `date · source_type · origin — author` `` + puces `- [[../resources/<slug>#anchor|Section]] — takeaway` (ou `- Ressource entière — context`), blocs séparés par `---`. **Registre existant** : `agentic-coding`, `context-engineering`, `finops-ia`, `outils-et-marche`, `securite-et-risques`, `transformation-organisationnelle`. ⚠️ Ne PAS reproduire le suffixe legacy `· ⚠ needs_review (date)`.
- **`authors/<slug>.md`** (ex. `wiki/authors/mckinsey.md`) : frontmatter `type:author`/`slug`/`label`/`resource_count` ; table `| Ressource | Date | Type | Origin | Topics |`, `\|` **échappé** dans le wikilink, topics `, `-séparés.
- **`entities/<slug>.md`** (ex. `wiki/entities/claude-code.md`) : frontmatter `type:entity`/`entity_type`/`slug`/`label`/`aliases` ; corps `# Label` + `` `entity_type: …` `` + description + `## Mentions` + blocs **niveau `###`** `### [[../resources/<slug>|Titre]]` + méta `` `date · source_type — author` `` (**PAS d'origin**) + puces `- Ressource entière : …` (**deux-points**) ou `- [[..#anchor|Section]] — …`. Seed registre : `n8n`, `claude-code`, `databricks`, `supabase`.
- **`by-date/<Y>/<Y>.md`** (année) : frontmatter `type:by-date`/`period`/`resource_count` ; `## Date précise inconnue (année seulement)` (table, liens `../../resources/`) + `## Par mois` (puces `- [[by-date/Y/Y-M/Y-M|Y-M]] — N ressources (Auteurs)`). Format non uniforme selon années (verify ignore le corps by-date).
- **`by-date/<Y>/<Y-M>/<Y-M>.md`** (mois) : frontmatter `type:by-date`/`period`/`resource_count` ; table `| Ressource | Auteur | Type | Origin | Topics |`, liens `../../../resources/`.
- **`types.md`** : frontmatter `type:index`/`label`/`last_updated` ; `## <source_type brut> (N ressources)` + table `| Ressource | Auteur | Date | Origin |`, liens `resources/`.
- **`origin/<val>.md`** (`interne` ET `externe` **toujours présentes**, même vides) : frontmatter `type:origin`/`slug`/`label`/`resource_count`/`last_updated` ; blocs `## [[../resources/<slug>|Titre]]` + `` `date · source_type · author` `` (auteur précédé de ` · `, pas ` — `).
- **`index.md`** : frontmatter `type:index`/`last_updated`/`resource_count`/`theme_count`/`author_count` ; sections `## Thèmes (N)`, `## Auteurs (N)`, `## Ressources (N)` → `### <TypeLabel> (N)`, `## Index par date`, `## Index par type` (`→ [[types]]`), `## Origine (2)`.

### R3. `graph.json` — structure exacte (LE juge principal)

`{ "generated": "AAAA-MM-JJ", "nodes":[...], "edges":[...] }`.

**Nodes** : `resource:<slug>` (`label`, `date`) · `theme:<slug>` (`label`) ·
`author:<slugify(author)>` (`label`) · `entity:<slug>` (`entity_type`, `label` ;
namespace toujours `entity:`) · `type:<source_type>` (`label`) · `origin:interne`/`origin:externe`
(`label`, les deux toujours présents) · `date:AAAA` ou `date:AAAA-MM` (`granularity`
"year"/"month", `year` pour les mois).

**Edges** (7 relations) : `written_by` (resource→author) · `has_type` (resource→type) ·
`has_origin` (resource→origin, **absent si origin inconnu**) · `belongs_to_theme`
(resource→theme, suit les topics **frontmatter**) · `mentions` (resource→entity,
`sections:[...]` si niveau chunk) · `published_on` (resource→date) · `year_of`
(date:AAAA-MM→date:AAAA). Normalisation date : `length>=7` → `date:AAAA-MM`, sinon `date:AAAA`.
Mise à jour **incrémentale**, jamais régénéré de zéro.

### R4. `wiki-verify.ts` — ce qu'il juge (sévérité)

Commande : `npm --prefix web run wiki:verify` (= `tsx scripts/wiki-verify.ts`,
`WIKI_ROOT` défaut `../wiki`). Flags `--strict` (exit 1 si ≥1 issue, **erreurs ET
warnings comptent**), `--json`.
- **error** : `duplicate-entity`/`duplicate-theme` · `invalid-origin` · `origin-page-missing`
  · `unknown-entity` · `unknown-theme` · `candidate-collision`/`theme-candidate-collision`
  · `graph-missing-node` (entity/origin/theme[frontmatter topics]/author/type/date) ·
  `graph-missing-edge` (mentions/has_origin/belongs_to_theme/written_by/has_type/published_on,
  matching **source→target uniquement**) · `graph-orphan-node`/`graph-orphan-edge` ·
  `manifest-missing`/`manifest-orphan` · `*-file` (JSON illisible).
- **warn** : `missed-link` (entité connue en prose non reliée) · `missed-theme-link`
  (thème ≥2× en prose non listé, seuil `THEME_MENTION_THRESHOLD=2`) · `invented-type`.
- **NE lit PAS** le corps de `themes/`/`authors/`/`by-date/`/`types.md`/`index.md` ;
  lit `origin/*.md` seulement pour tester l'existence non vide ; ne vérifie NI la
  résolution des wikilinks, NI les ancres, NI les `resource_count`.

### R5. Helpers **exportés** de `wiki-mutate.ts` (réutiliser tel quel)

`headingSlug(text):string` `:56` · `splitFrontmatter(content):{fm,rest}` `:73` ·
`withFrontmatter(fm,rest):string` `:80` · `setScalar(fm,key,rawValue):string`
(no-op si clé absente) `:85` · `bumpScalarInt(fm,key,delta):string` (borné 0) `:92` ·
`patchInlineArray(fm,key,item,opts?:{quote?}):string` (idempotent) `:105` ·
`removeResourceBlock(text,level,slug)` `:147` · `removeTableRow(text,slug)` `:183` ·
`removeLinesWithResource(text,slug)` `:192` · `countResourceBlocks(text,level):number`
`:201` · `countTableRows(text):number` `:207` · `decrementCountOnLineWith(text,needle)`
`:222` · `adjustHeadingCount(text,headingRe,delta)` `:234` · `parseGraph(content):Graph`
`:244` · `serializeGraph(g):string` `:262` · `purgeCandidate(json,normalized)` `:314` ·
`removeManifestKey(json,sourceFile)` `:323` · `parseResourceMeta(content,slug):ResourceMeta`
`:364` · `addChunkLink(body,sectionSlug,key,slug)` `:429` · `addThemeToNav(body,slug,label)`
`:456` · `applyEntityDecision(input):FileOp[]` `:548` · `applyThemeDecision(input):FileOp[]`
`:649` · `deleteResource(input):FileOp[]` `:782`.

**Types** : `FileOp = {path;content} | {path;delete:true}` `:24` ·
`GraphNode = {id;type;[k]:unknown}` `:28` · `GraphEdge = {source;target;relation;sections?;[k]:unknown}`
`:33` · `Graph = {generated;nodes;edges}` `:40` · `ResourceMeta = {slug;title;author;date;
source_type;origin;topics:string[];entities:string[];source_file;body}` (scalaires `string|null`) `:332`.

### R6. Briques **privées** à ré-implémenter (gabarits, ne pas importer)

Non exportées : `escapeRe` `:65` · `upsertNode` `:277` · `upsertMentionEdge` `:285` ·
`upsertThemeEdge` `:303` · `findHeading` `:397` · `entityMetaLine` `:473` ·
`mentionBullet` `:478` · `buildEntityMentionBlock` `:487` · `appendEntityMention` `:495` ·
`themeMetaLine` `:504` · `buildThemeBlock` `:510` · `addThemeBullet` `:729`.
**Meilleurs gabarits de code** à ouvrir : `applyThemeDecision` (`:649`, création de page
neuve + `buildThemeBlock`) et `applyEntityDecision` (`:548`, `buildEntityMentionBlock`)
— montrent exactement comment composer un bloc + frontmatter neuf.
**Manques structurels (écrire de zéro)** : upserts d'edges `written_by`/`has_type`/
`has_origin`/`published_on`/`year_of` + nodes `author:/type:/date:` (seul l'IA les créait ;
`deleteResource` ne fait que les filtrer) · `addManifestKey` (inverse de `removeManifestKey`) ·
insertion **ordonnée** dans une vue existante · création de page (author, by-date year/month) ·
extraction du takeaway (1ʳᵉ phrase de section).

### R7. Corps verbatim de `deleteResource` (LE modèle à inverser)

```ts
export function deleteResource(input: DeleteResourceInput): FileOp[] {
  const meta = parseResourceMeta(input.resourceContent, input.slug);
  const { slug } = input;
  const v = input.views;
  const ops: FileOp[] = [];
  const orphanAuthors: string[] = [];
  const orphanDates: string[] = [];

  // 1. La ressource canonique.
  ops.push({ path: `wiki/resources/${slug}.md`, delete: true });

  // 2. Thèmes : retirer le bloc + recompute resource_count. Registre = jamais delete.
  for (const topic of meta.topics) {
    const content = v.themes[topic];
    if (!content) continue;
    let out = removeResourceBlock(content, '##', slug);
    const { fm, rest } = splitFrontmatter(out);
    const newFm = setScalar(fm, 'resource_count', String(countResourceBlocks(rest, '##')));
    ops.push({ path: `wiki/themes/${topic}.md`, content: withFrontmatter(newFm, rest) });
  }

  // 3. Auteur : retirer la ligne. Orphelin (0 ligne) → delete page + node.
  if (meta.author && v.authorContent && v.authorPath) {
    const authorSlug = input.slugifyAuthor(meta.author);
    const out = removeTableRow(v.authorContent, slug);
    if (countTableRows(out) === 0) {
      ops.push({ path: v.authorPath, delete: true });
      orphanAuthors.push(authorSlug);
    } else {
      const { fm, rest } = splitFrontmatter(out);
      ops.push({ path: v.authorPath, content: withFrontmatter(setScalar(fm, 'resource_count', String(countTableRows(rest))), rest) });
    }
  }

  // 4. Origine : retirer le bloc + recompute. Jamais delete (enum).
  if (meta.origin && v.originContent && v.originPath) {
    const out = removeResourceBlock(v.originContent, '##', slug);
    const { fm, rest } = splitFrontmatter(out);
    ops.push({ path: v.originPath, content: withFrontmatter(setScalar(fm, 'resource_count', String(countResourceBlocks(rest, '##'))), rest) });
  }

  // 5. by-date : mois puis année. Orphelins → delete + nodes.
  const date = meta.date ?? '';
  const isMonth = date.length >= 7;
  const year = date.slice(0, 4);
  const ym = date.slice(0, 7);
  if (isMonth && v.monthContent && v.monthPath) {
    const out = removeTableRow(v.monthContent, slug);
    if (countTableRows(out) === 0) {
      ops.push({ path: v.monthPath, delete: true });
      orphanDates.push(`date:${ym}`);
      if (v.yearContent && v.yearPath) {
        v.yearContent = removeLinesWithMonth(v.yearContent, ym);
      }
    } else {
      const { fm, rest } = splitFrontmatter(out);
      ops.push({ path: v.monthPath, content: withFrontmatter(setScalar(fm, 'resource_count', String(countTableRows(rest))), rest) });
    }
  }
  if (v.yearContent && v.yearPath) {
    let yearOut = removeTableRow(v.yearContent, slug);
    const rowsLeft = countTableRows(yearOut);
    const monthsLeft = /^-\s*\[\[by-date\//m.test(yearOut);
    if (rowsLeft === 0 && !monthsLeft) {
      ops.push({ path: v.yearPath, delete: true });
      orphanDates.push(`date:${year}`);
    } else {
      const { fm, rest } = splitFrontmatter(yearOut);
      ops.push({ path: v.yearPath, content: withFrontmatter(bumpScalarInt(fm, 'resource_count', -1), rest) });
    }
  }

  // 6. Entités : retirer le bloc `### [[..]]` des Mentions. Registre = jamais delete.
  for (const ent of meta.entities) {
    const content = v.entities[ent];
    if (!content) continue;
    ops.push({ path: `wiki/entities/${ent}.md`, content: removeResourceBlock(content, '###', slug) });
  }

  // 7. types.md : retirer la ligne + décrémenter le compteur « (N ressources) ».
  if (v.types && meta.source_type) {
    let out = removeTableRow(v.types, slug);
    out = out.replace(
      new RegExp(`^(## ${escapeRe(meta.source_type)}) \\((\\d+) ressources?\\)`, 'm'),
      (_m, h, n) => {
        const next = Math.max(0, parseInt(n, 10) - 1);
        return `${h} (${next} ressource${next > 1 ? 's' : ''})`;
      },
    );
    ops.push({ path: 'wiki/types.md', content: out });
  }

  // 8. graph.json : retirer le node ressource + ses edges ; puis nodes dérivés orphelins.
  const graph = parseGraph(v.graph);
  const rid = `resource:${slug}`;
  graph.edges = graph.edges.filter((e) => e.source !== rid && e.target !== rid);
  graph.nodes = graph.nodes.filter((n) => n.id !== rid);
  for (const a of orphanAuthors) graph.nodes = graph.nodes.filter((n) => n.id !== `author:${a}`);
  if (meta.source_type) {
    const typeId = `type:${meta.source_type}`;
    if (!graph.edges.some((e) => e.relation === 'has_type' && e.target === typeId)) {
      graph.nodes = graph.nodes.filter((n) => n.id !== typeId);
    }
  }
  for (const d of orphanDates) {
    graph.nodes = graph.nodes.filter((n) => n.id !== d);
    graph.edges = graph.edges.filter((e) => !(e.relation === 'year_of' && (e.source === d || e.target === d)));
  }
  ops.push({ path: 'wiki/graph.json', content: serializeGraph(graph) });

  // 9. _ingested.json : retirer la clé source_file.
  if (meta.source_file) {
    ops.push({ path: 'wiki/_ingested.json', content: removeManifestKey(v.manifest, meta.source_file) });
  }

  // 10. index.md : retrait du bullet + décréments.
  let index = v.index;
  const { fm: ifm, rest: ibody } = splitFrontmatter(index);
  let body = removeLinesWithResource(ibody, slug);
  body = adjustHeadingCount(body, /^## Ressources \(\d+\)/m, -1);
  if (meta.source_type) {
    const label = input.typeLabel(meta.source_type);
    body = adjustHeadingCount(body, new RegExp(`^### ${escapeRe(label)} \\(\\d+\\)`, 'm'), -1);
  }
  for (const topic of meta.topics) body = decrementCountOnLineWith(body, `themes/${topic}|`);
  if (meta.origin) body = decrementCountOnLineWith(body, `origin/${meta.origin}|`);
  if (year) body = decrementCountOnLineWith(body, `by-date/${year}/${year}|`);
  if (meta.author) {
    const authorSlug = input.slugifyAuthor(meta.author);
    if (orphanAuthors.includes(authorSlug)) {
      body = removeLinesWithResource2(body, `authors/${authorSlug}|`);
      body = adjustHeadingCount(body, /^## Auteurs \(\d+\)/m, -1);
    } else {
      body = decrementCountOnLineWith(body, `authors/${authorSlug}|`);
    }
  }
  let newIfm = bumpScalarInt(ifm, 'resource_count', -1);
  if (orphanAuthors.length) newIfm = bumpScalarInt(newIfm, 'author_count', -orphanAuthors.length);
  index = withFrontmatter(newIfm, body);
  ops.push({ path: 'wiki/index.md', content: index });

  // 11. Fichiers bruts.
  if (meta.source_file) {
    ops.push({ path: `raw/${meta.source_file}`, delete: true });
    if (v.metaExists) ops.push({ path: `raw/${meta.source_file}.meta.md`, delete: true });
  }

  return ops;
}
```

`DeleteViews` (à mirrorer en `ProjectViews`) : `themes: Record<string,string>` ·
`authorPath`/`authorContent: string|null` · `originPath`/`originContent: string|null` ·
`entities: Record<string,string>` · `yearPath`/`yearContent`/`monthPath`/`monthContent: string|null` ·
`graph`/`manifest`/`index: string` · `types: string|null` · `metaExists: boolean`.

### R8. Auth, modèle, caching, coût

- **Client** : `anthropic` exporté de `web/lib/claude.ts:12` (`new Anthropic({apiKey: ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL})`) — **x-api-key, passe la gateway** (prouvé par le chat). `CLAUDE_MODEL` (`claude.ts:19`) = `process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'`.
- **Ne PAS** utiliser Bearer/`ANTHROPIC_AUTH_TOKEN` (spécifique à l'agent SDK, cf. `tasks/lessons.md:48-60`).
- **`usage`** exposé sur la réponse `messages.create` : `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`.
- **Prompt caching** : `cache_control:{type:'ephemeral'}` sur le bloc système. Vérifier `cache_read_input_tokens > 0` au 2ᵉ appel du run. **Préfixe cacheable minimum ≈ 1024 tokens** pour Sonnet 4.5 (le prompt système doit dépasser ce seuil). Le préfixe (`system`) doit rester **byte-identique** entre ressources d'un run.
- **Barème coût Sonnet 4.5** (à hardcoder pour le log) : entrée **3 $/1M**, sortie **15 $/1M**, cache-write **3,75 $/1M** (1,25×), cache-read **0,30 $/1M** (0,1×).
- **Sorties structurées `output_config.format` : ne pas utiliser** (non garanti Sonnet 4.5 / LiteLLM) → sortie texte délimitée.

### R9. Candidates (workflow d'arbitrage — inchangé, à alimenter)

Contrat candidate entité (`wiki/entities/_candidates.json`) :
`{ name, normalized, variants, note, seen_in:[{resource, section, context}], suggested_aliases:[{slug,label,score}], suggested_types:[...⊆ entity_type registre], status:"pending", decision:{target_slug:null, entity_type:null, slug:null}, updated_at }`.
Candidate thème (`wiki/themes/_candidates.json`) : **identique SANS `suggested_types`**,
`decision:{target_slug, slug}`. Fichier enveloppe : `{ "version":1, "generated":"AAAA-MM-JJ", "candidates":[...] }`.
L'IA du nouveau pipeline émet les inédits dans `<detected-new>` ; la couche déterministe
crée les entrées candidate (le `context`/`seen_in` dérivés de la section où l'entité apparaît).
Arbitrage humain via `/entities` et `/themes` → `applyEntityDecision`/`applyThemeDecision`
(inchangé).

### R10. Slugs (algorithmes exacts)

`slugify` (`web/lib/wiki-parser.ts:31`) : `.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')`.
`headingSlug` (`web/lib/wiki-mutate.ts:56`, **exporté**) : `.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/\s/g,'-')` (garde accents, ne réduit pas les tirets).

### R11. Confiance graduée entités/thèmes (`docs/entities.md §4` — à respecter)

Le traitement d'une entité dépend de sa **provenance** :
1. **Entité + type déclarés** (bloc `links:` du sidecar `.meta.md`) → **créer et lier
   directement**, même nouvelle (on fait confiance au choix humain — **jamais** de
   candidate). Dédoublonnage : nom = entité existante du **même** type → s'y relier ;
   nom = entité existante d'un **autre** type → créer sous un **slug distinct
   déterministe** suffixé du type (ex. `databricks-tool`).
2. **Nom sans type** (ancien `entities:` plat) ou **détecté dans le contenu** : écriture
   reconnue (match `label`/`aliases` d'une entité existante) → **lien auto** ; inconnue →
   **candidate** (ne pas créer). C'est le rôle du bloc `<detected-new>` de l'IA.
3. **Rien déclaré** → ne relier que les entités **déjà connues** ; toute nouvelle → candidate.

**Granularité** (`docs/entities.md §3`) : `entities:` en **frontmatter** = ressource
entière ; `` `entities: [..]` `` sous un heading = **cette section** seulement. Décidée
par `entities_granularity` du sidecar (map `entity_type → resource|chunk`), sinon `auto`
(l'IA choisit `chunk` si l'entité ne touche qu'1-2 sections, `resource` si transverse).
Effet graphe : edge `mentions` **avec** `sections:[...]` au niveau chunk, **sans** `sections`
au niveau ressource.

**Répartition IA / déterministe** : l'IA honore les entités **déclarées** (sidecar) dans
ses annotations, au niveau de granularité voulu, ET détecte les inédites (→ `<detected-new>`).
La couche déterministe **crée les pages** des entités déclarées-nouvelles (avec leur
`entity_type` et la règle de slug suffixé), relie les connues (ajout d'un bloc de mention),
et écrit les candidates pour les détectées-non-déclarées. **Le même schéma s'applique aux
thèmes** (`themes:` autoritaire → création directe si nouveau ; détecté inédit → candidate),
sans dimension `entity_type`.

---

## Décisions

1. **Appel Messages API unique (approche B) plutôt qu'agent SDK restreint (A).**
   Retenu B. Raison : coût **borné par un seul échange** (indépendant du fait que le
   caching passe la gateway) ; ~1 tour vs 65 ; réutilise le chemin `x-api-key`
   **déjà prouvé** par le chat ; supprime l'auth Bearer fragile et le binaire natif
   `claude-agent-sdk` (simplifie l'empaquetage Electron futur) ; caching explicite
   **qu'on mesure** ; plus besoin du garde-fou `canUseTool` (l'IA n'écrit plus).
   *Écarté A* : conserve le prompt système Claude Code géant, la boucle multi-tours,
   le caching non vérifié, et le quirk Bearer.

2. **Modèle : Sonnet par défaut** (choix d'Arthur). Raison : règle projet « fidélité
   > brièveté » — la paraphrase intégrale (chiffres/citations) est fidélité-critique.
   Coût estimé ~15–30 ¢/ressource (~25× moins que 6,64 $), pas tout à fait « quelques
   centimes ». *Écarté Haiku* (~5 ¢, atteindrait « quelques centimes » mais risque de
   fidélité sur contenu dense) et *mesurer-les-deux* (report).

3. **Vrai run mesuré pendant l'implémentation** (choix d'Arthur). Raison : prouver le
   coût réel et **confirmer que le prompt caching passe la gateway** (`cache_read>0`).
   Nécessite la clé gateway dans l'env local. *Écarté* : validation déterministe seule
   (Arthur veut la preuve « ça marche », pas une affirmation).

4. **Sortie texte délimitée** (`.md` + bloc `<detected-new>`) plutôt que
   `output_config.format`. Raison : sorties structurées non garanties sur Sonnet 4.5 /
   à travers LiteLLM ; le parsing délimité est robuste et sans dépendance gateway.

5. **Takeaway = première phrase de la section** (déterministe). Raison : zéro coût IA
   supplémentaire, vues restant riches. *Écarté* : takeaways générés par l'IA (coût de
   sortie en plus) et titre-seul (moins riche).

6. **Nouveau module `web/lib/wiki-project.ts`** ré-implémentant les briques privées.
   *Écarté* : modifier `wiki-mutate.ts` (contrainte « figé ») ou ré-exporter ses privés
   (touche quand même au fichier figé).

7. **Un appel API par ressource** (boucle) plutôt qu'un appel batch. Raison :
   attribution de coût par ressource + prompt système **byte-identique** entre
   ressources (→ cache hits) ; les vues sont relues fraîches entre chaque projection.

8. **L'IA relie aux slugs connus + déclarés ; détecte le reste.** Elle relie les
   entités/thèmes **connus** (registres injectés) et **déclarés** (sidecar) ; les inédits
   **non déclarés** vont en `<detected-new>` → candidates. La couche déterministe crée
   directement les **déclarés-nouveaux** (confiance humaine, cf. §R11 et `docs/entities.md §4`)
   et écrit les candidates pour les détectés-inconnus. Raison : satisfait
   `unknown-theme`/`unknown-entity` du verify, respecte la confiance graduée, et préserve
   l'arbitrage humain.

9. **Le coût est affiché à l'utilisateur en fin d'ingestion** (exigence d'Arthur), comme
   **estimation en USD** = `usage` × tarifs publics Sonnet (§R8) — sauf si la gateway renvoie
   son propre coût (en-tête réponse), auquel cas on l'affiche. Raison : la Messages API ne
   fournit **pas** de champ coût tout prêt (contrairement à `total_cost_usd` de l'agent SDK) ;
   la facturation réelle via LiteLLM peut différer des tarifs publics → afficher honnêtement
   « estimation », et préférer le chiffre gateway s'il existe. Pas de conversion EUR (aucun
   taux fiable).

---

## Hors périmètre

- Toute modification de `web/lib/wiki-mutate.ts` (moteur figé/testé).
- La coquille Electron (Phase 6), l'affichage/Windows/certificats.
- Le **retrait de la dépendance `@anthropic-ai/claude-agent-sdk`** du `package.json`
  (à faire une fois l'ingestion migrée et vérifiée — non bloquant, à noter).
- Les **takeaways « riches »** générés par l'IA (on dérive la 1ʳᵉ phrase).
- Le rétro-linking des candidates (déjà couvert par `applyEntityDecision`/`applyThemeDecision`).
- Le modèle **Haiku** (reporté ; Sonnet retenu).

---

## Todo

- [x] **Créer `web/lib/wiki-project.ts`** : type `ProjectViews` (miroir de `DeleteViews`),
      `projectResource(input): FileOp[]`, briques ré-implémentées (blocs thème/entité +
      lignes méta, `upsertNode` + upserts des 7 edges, insertion ordonnée, `addManifestKey`,
      **création de page entité/thème déclaré-nouveau** (§R11, règle de slug suffixé),
      takeaway = 1ʳᵉ phrase), en réutilisant les helpers **exportés** de `wiki-mutate.ts`.
      *Vérif* : `npx tsc --noEmit` (dans `web/`) sans erreur ; import des helpers résout.
- [x] **Créer `web/lib/__tests__/wiki-project.test.ts`** (gabarit : test `deleteResource`
      dans `web/lib/__tests__/wiki-mutate.test.ts:373`) : unitaires (bloc thème ajouté +
      recompté, page auteur créée, node `resource:` + 7 edges présents, clé manifeste
      ajoutée, compteurs index incrémentés) ; **round-trip** `deleteResource(projectResource(état_vide)) ≈ état_vide`
      et `projectResource(deleteResource(état_plein)) ≈ état_plein` ; idempotence d'un
      double `projectResource`. *Vérif* : `npm --prefix web run test` vert.
- [x] **Réécrire `prompts/ingest-prompt.md`** en prompt **système court** (schéma
      frontmatter §R1, enum `source_type`, heuristique `origin`, format annotations/nav,
      règle liens-connus-seulement + `<detected-new>`, mandat de fidélité) ; corriger
      `run:"gha"` → `run:"local"`. *Vérif* : longueur nettement réduite vs actuel ;
      relecture manuelle qu'il ne fait plus référence à la lecture de `CLAUDE.md`/`docs/`.
- [x] **Réécrire le cœur de `web/lib/ingest-local.ts`** : boucle `anthropic.messages.create`
      (client de `claude.ts`, `cache_control` sur le système), parse `.md` + `<detected-new>`,
      logging `usage` complet + coût calculé (§R8), `projectResource` → `applyFileOps`,
      confiance graduée entités/thèmes (§R11 : création directe des déclarés-nouveaux,
      candidates pour les détectés-inconnus). Supprimer `query()`, `canUseTool`/`WRITE_TOOLS`,
      `fakeHome`/`CLAUDE_CONFIG_DIR`/`ANTHROPIC_AUTH_TOKEN`, `INJECTED_DOCS`. Conserver
      verrou/état/`detectPending`/`runWikiVerify`. *Vérif* : `npx tsc --noEmit` OK ;
      relecture que le chemin auth = x-api-key.
- [x] **Nettoyer `web/components/upload/IngestStatus.tsx`** (textes « commit /raw → Action »,
      « rattrapage chaque nuit », lignes ~15 et ~85-89). *Vérif* : grep de ces chaînes
      renvoie vide.
- [x] **Afficher le coût en fin d'ingestion** : étendre `IngestState` (`costUsd` total +
      `perFile`), le renvoyer via `GET /api/ingest-status`, l'afficher dans `IngestStatus.tsx`
      à l'état terminé (format cents pour les petits montants ; mention « estimation USD »,
      ou coût gateway si fourni). *Vérif* : avec une ingestion fixture (usage simulé), le coût
      affiché correspond au calcul §R8 ; au vrai run, le coût apparaît bien dans l'UI.
- [x] **Test d'intégration de la chaîne (sans appel IA)** : rendre l'appel modèle
      **injectable** (`generateResource`), puis tester la tuyauterie complète sur une
      **sortie d'IA en conserve** (fixture : une `resource.md` écrite à la main + un
      sidecar avec entités/thèmes déclarés + un bloc `<detected-new>`) → parsing +
      confiance graduée (§R11) + candidates + `projectResource` + `applyFileOps`, puis
      `wiki:verify` vert. *Vérif* : `npm --prefix web run test` couvre ce scénario ; les
      **3 branches de §R11 sont assertées** (connu → bloc de mention ajouté ;
      déclaré-nouveau → page créée + slug suffixé si collision ; détecté-inconnu →
      entrée candidate, aucune page).
- [x] **Suite déterministe complète verte** : `npm --prefix web run test` +
      `npm --prefix web run wiki:verify` (0 erreur) après projection d'une ressource de
      test dans un wiki fixture. *Vérif* : exit 0 des deux commandes.
- [ ] **Vrai run mesuré (Sonnet)** : déposer une vraie ressource via la plateforme (clé
      gateway dans l'env local), relever coût réel + `usage` (in/out/cache) depuis
      `ingest.log`, **confirmer `cache_read_input_tokens > 0` au 2ᵉ appel**, comparer aux
      6,64 $. *Vérif* : coût affiché < ~0,50 $ ; `wiki:verify` vert sur le wiki réel ;
      la page ressource + les vues sont cohérentes à l'œil dans l'UI.

---

## Bilan

### Ce qui a été fait
- **`web/lib/wiki-project.ts`** (neuf) : `projectResource(input): FileOp[]`, inverse exact
  de `deleteResource`, reconstruit toutes les vues + graphe + manifeste depuis la seule
  page ressource, zéro LLM. Briques privées de `wiki-mutate.ts` ré-implémentées (blocs
  thème/entité/origin, upserts des 7 relations du graphe, insertion ordonnée,
  `addManifestKey`, takeaway = 1ʳᵉ phrase, création de pages neuves). **`wiki-mutate.ts`
  n'a PAS été touché.**
- **`web/lib/__tests__/wiki-project.test.ts`** (neuf) : unitaires + **round-trip**
  (`deleteResource(projectResource(vide))` ramène graphe + manifeste à l'identique) +
  **idempotence** (double projection ne double aucun compteur).
- **`prompts/ingest-prompt.md`** : réécrit en prompt système court (98 lignes vs 193) ;
  plus aucune référence aux docs/CLAUDE.md ni à l'application de candidates ; `run:"gha"`
  supprimé (géré par le code en `"local"`).
- **`web/lib/ingest-local.ts`** : cœur réécrit — un `anthropic.messages.create` par
  ressource (client x-api-key de `claude.ts`, `cache_control` sur le système),
  extraction PDF **locale** (unpdf, gratuit), parsing `<resource>`/`<detected-new>`,
  logging `usage` + coût (§R8), confiance graduée (§R11, 3 branches), `projectResource`
  → `applyFileOps`. Supprimés : `query()` agent, `canUseTool`/`WRITE_TOOLS`,
  `fakeHome`/`CLAUDE_CONFIG_DIR`/`ANTHROPIC_AUTH_TOKEN` (Bearer), `INJECTED_DOCS`.
  Conservés : verrou, état, `detectPending`, `runWikiVerify`.
- **`web/lib/__tests__/ingest-local.test.ts`** : + tests purs (estimateCost §R8,
  parseGeneration, resolveDeclarations dont slug suffixé) + **test d'intégration** de la
  chaîne complète sur sortie IA « en conserve » → 3 branches §R11 assertées →
  `wiki:verify` **VERT** (0 erreur). DATA_ROOT redirigé vers un dossier temp (jamais le
  wiki réel).
- **UI** : `IngestStatus.tsx` nettoyé (textes « commit /raw → Action », « rattrapage
  chaque nuit » retirés) + affichage du coût en fin d'ingestion ; `IngestState` étendu
  (`costUsd` + `perFile`) ; `GET /api/ingest-status` renvoie `costUsd` + `fileCostUsd`.

### Preuves exécutées
- **98 tests verts** (`npm --prefix web run test`), **`tsc --noEmit` OK**, **`next build` OK**
  (unpdf bundle sans souci), **`wiki:verify` du wiki réel toujours vert**.
- **Vrai run mesuré** (vraie gateway, sur une COPIE temp du wiki — wiki réel intact) :
  1 rapport PDF réel ingéré → **coût $0,117** (in=6082, out=6597) contre **$6,64** →
  **~57× moins cher**, dans la cible « quelques dizaines de centimes ». `wiki:verify` sur
  la copie (wiki réel + ressource réelle projetée) : **✓ aucun problème**.

### Écarts au plan (et pourquoi)
- **PDF → extraction locale du texte (unpdf)** au lieu du « contenu brut inline ».
  Décision d'Arthur : il ne veut que le texte, au coût minimal ; le PDF natif Anthropic
  ferait payer les images de pages (2–4× l'input) sans bénéfice voulu. Dépendance `unpdf`
  ajoutée. `.pptx`/`.docx` restent hors périmètre propre (erreur claire loggée).
- **Appel non-streamé** (le plan suggérait « streamer si sortie longue »). Non-streaming
  simplifie l'accès à `usage` + en-têtes ; `max_tokens: 16000` couvre une ressource
  entière. Aucun impact fonctionnel.
- **Prompt caching : NE passe PAS cette route de gateway.** Au 1ᵉ appel,
  `cache_creation_input_tokens = 0` → la gateway (`vercel/anthropic-claude-sonnet-4.5`
  via LiteLLM) n'honore pas `cache_control`. Impact **marginal** : la sortie domine le
  coût (6597 tok × $15/1M = 84 % du total) ; le cache n'économiserait que ~0,6 ¢/appel
  sur le préfixe système. `cache_read>0` au 2ᵉ appel **non confirmé** (voir ci-dessous).
- **Budget gateway épuisé (429)** pendant le run : plafond équipe $10 atteint → la 2ᵉ
  ressource a échoué (erreur gérée proprement : loggée, run terminé avec la 1ʳᵉ). Le code
  est robuste à l'échec par-fichier.

### Reste à faire (non bloquant)
- **Contrôle visuel dans l'UI** (nécessite Arthur) : déposer une source via la plateforme,
  vérifier à l'œil la fiche + les vues + le coût affiché.
- **Confirmer/activer le prompt caching** : quand le budget gateway est rerempli, tester
  une route de modèle native Anthropic sur la gateway pour voir si `cache_control` passe
  (gain marginal, purement optionnel).
- **Retirer `@anthropic-ai/claude-agent-sdk`** de `package.json` (plus aucun import —
  vérifié) : cleanup sûr, laissé hors périmètre par la spec.

---

**Fichier créé** : `tasks/specs/2026-07-21-ingestion-locale-peu-couteuse.md`

**Commande pour la session d'implémentation** :
`/implement @tasks/specs/2026-07-21-ingestion-locale-peu-couteuse.md`
