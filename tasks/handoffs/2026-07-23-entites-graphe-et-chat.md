# Entités invisibles dans le graphe + introuvables dans le chat

## Ta mission

Corriger deux bugs liés aux **entités** (outils/clients récurrents : n8n, Claude Code,
Supabase, Databricks…) dans la plateforme locale du wiki (`web/`) :
- **A.** Le chat ne trouve pas une entité pourtant présente (« Qu'est-ce qui a été dit
  sur n8n ? » → « aucune mention » alors que `wiki/entities/n8n.md` existe et que des
  ressources mentionnent n8n).
- **B.** Des nœuds d'entités s'affichent **sans nom** dans la vue graphe.

Investigue à partir des racines déjà identifiées ci-dessous (elles sont confirmées dans
le code), conçois le correctif en **plan mode** (workflow habituel : plan → `/spec` →
`/implement` en session neuve), puis prouve que ça marche.

## Contexte projet (rappel bref)

Wiki de veille AI coding, **application de bureau local-first** (Electron). `raw/` =
sources brutes immuables ; `wiki/resources/*.md` = ressources canoniques ; tout le reste
sous `wiki/` (themes/, authors/, **entities/**, by-date/, index.md, **graph.json**) est
une **vue dérivée** reconstruite déterministiquement. `CLAUDE.md` + `docs/` se chargent
automatiquement dans ta session — **lis en priorité** [docs/entities.md](docs/entities.md)
(système d'entités, graphe §5, vérificateur §6) et [docs/platform.md](docs/platform.md)
(plateforme, chat, accès IA). Ne recopie pas ces docs, appuie-toi dessus.

## Le sujet

### Symptôme A — le chat ne remonte pas d'une entité vers ses ressources

**Reproduction :** dans le chat de la plateforme, demander « Qu'est-ce qui a été dit sur
n8n ? ». Réponse observée : « Le wiki ne contient aucune mention de n8n » — alors que
(1) `wiki/entities/n8n.md` existe (label `"n8n"`), (2) plusieurs ressources mentionnent
n8n en prose (ex. `wiki/resources/point-equipe-plateforme-etat-de-notre-pratique-du-coding-assiste-par-ia.md` :
« Nos automatisations internes tournent sur n8n »), (3) `graph.json` contient les arêtes
`mentions` `resource:… → entity:n8n`. Le chat a fait « 6 étapes de recherche » (Lecture
de index.md, Exploration de resources/, puis 4 ressources) sans jamais ouvrir la note
concernée ni `entities/n8n.md`.

**Racine A (confirmée) :** l'agent de chat (`web/lib/chat-agent.ts`, `runWikiAgent`) ne
dispose que de **2 outils génériques** (`WIKI_TOOLS`, ~L14-40) :
- `read_wiki_page {path}` — lit une page **.md** entière (frontmatter + prose), tronquée
  à 30 000 car. **Refuse tout ce qui n'est pas `.md`** → `graph.json` est illisible par le chat.
- `list_wiki_folder {path}` — liste les **noms** d'un dossier.

Il n'y a **aucun** outil de recherche plein-texte, aucun grep, aucun embedding, **aucun
outil conscient des entités ou du graphe**. Le prompt système (`buildSystemPrompt`,
~L351-406) impose de **partir de `index.md`** (« COMMENCE TOUJOURS ICI ») ; `graph.json`
n'est jamais cité comme exploitable. Or `wiki/index.md` **n'a pas de section Entités**, et
la note pertinente y figure **sans résumé** (`…|Point d'équipe plateforme…]] —` puis rien).
Donc pour « n8n », l'agent ne voit ce terme nulle part depuis sa porte d'entrée, n'a aucun
chemin « entité → ses ressources », lit 4 ressources au titre plausible, n'y trouve rien,
et conclut « aucune mention ».

**Facteur aggravant (données) :** le frontmatter de la note porte `entities: []` (vide),
alors que le corps liste `` `entities: [claude-code, n8n, supabase, databricks]` `` en
section. Un index d'entités basé sur le frontmatter raterait donc aussi cette ressource.

**Pistes de correctif (à arbitrer en plan mode avec Arthur) :**
1. Exposer au chat un **outil de recherche plein-texte** sur la prose des ressources
   (grep local sur `wiki/resources/*.md`) — le plus général.
2. Exposer un **outil « entité »** : lire `wiki/entities/<slug>.md` + suivre les arêtes
   `mentions` du graphe pour lister les ressources qui la citent (nécessite un accès au
   graphe côté chat — aujourd'hui bloqué par le refus du `.json` dans `read_wiki_page`).
3. Enrichir `wiki/index.md` d'une **section Entités** (déterministe, via le moteur de
   projection) + des **résumés** de ressources, pour que la porte d'entrée du chat mène
   aux entités.
Probablement une combinaison (1)+(3). Décision produit → passer par Arthur.

### Symptôme B — nœuds d'entités sans label dans le graphe

**Constat dans `wiki/graph.json` :**
```
{"id": "entity:claude-code", "type": "entity", "entity_type": "tool", "label": "Claude Code"}   ← OK
{"id": "entity:n8n",         "type": "entity"}   ← PAS de label, PAS de entity_type
{"id": "entity:supabase",    "type": "entity"}   ← idem
{"id": "entity:databricks",  "type": "entity"}   ← idem
```
Les 3 nœuds nus sont ceux reliés à la note `point-equipe-…` par des arêtes `mentions`.
`claude-code`, mentionné par la même note, a son label car il avait été créé (labellisé)
lors d'une ingestion **antérieure**. Pourtant `wiki/entities/n8n.md` a bien `label: "n8n"`
en frontmatter : le label existe au registre, il n'est jamais propagé au graphe.

**Racine B (confirmée) — `web/lib/wiki-project.ts`, émission des nœuds d'entités (~L569-576) :**
```ts
for (const e of meta.entities) {
  const decl = v.newEntities[e];
  if (decl) upsertNode(g, { id: `entity:${e}`, type: 'entity', entity_type: decl.entity_type, label: decl.label });
  else      upsertNode(g, { id: `entity:${e}`, type: 'entity' });   // ← nœud NU
}
```
Le `label`/`entity_type` n'est posé que si `v.newEntities[e]` est défini, c'est-à-dire
uniquement pour une entité **déclarée nouvelle pendant l'ingestion courante**. Pour une
entité **déjà au registre** (le cas normal d'une détection), `decl` est `undefined` →
nœud nu. Le label du frontmatter `entities/<slug>.md` n'est **jamais lu** ici (contraste
avec les thèmes L565-567 qui font toujours `label: v.themeLabels[t] ?? t`).

Aggravation par `upsertNode` (~L304-306) : **insert-only**, jamais de fusion —
`if (!g.nodes.some(n => n.id === node.id)) g.nodes.push(node)`. Une fois `entity:n8n`
écrit nu, aucune ré-ingestion ne le corrige (l'id existe déjà). Rendu :
`web/components/graph/GraphView.tsx` `paintNode` (~L179) fait `const label = node.label ?? ''`
→ nœud dessiné sans libellé ; tooltip (~L235) renvoie `undefined`.

**Pistes de correctif :** (i) dans la boucle L569-576, dériver `label`/`entity_type` du
**registre** (frontmatter `entities/<slug>.md`, disponible via `loadRegistries()` ou les
vues), avec repli `humanize(e)` ; (ii) rendre `upsertNode` capable de **compléter** un
label manquant sur un nœud existant ; (iii) **backfill** des nœuds nus déjà présents dans
`graph.json` (n8n, supabase, databricks) — insert-only oblige, une simple ré-ingestion ne
suffira pas ; prévoir une passe qui réécrit les labels manquants depuis le registre.

## Ce qu'on sait déjà / déjà fait

- Les deux racines ci-dessus sont **vérifiées dans le code** (pas des hypothèses).
- Les entités SONT bien détectées et reliées : `graph.json` a les 4 arêtes `mentions`
  de la note ; les pastilles d'entités s'affichent sur la fiche. Le problème est
  (A) l'absence d'outil de recherche/entité côté chat, (B) le label de nœud non propagé.
- **Un chantier voisin mais SÉPARÉ est en cours** : la correction des **thèmes** (thèmes
  annotés en section non remontés au frontmatter) est spécifiée dans
  [tasks/specs/2026-07-23-remontee-themes-frontmatter.md](tasks/specs/2026-07-23-remontee-themes-frontmatter.md).
  Elle touche `web/lib/ingest-local.ts` (helpers `rollupSectionTopics`/`rebuildNav`),
  `web/lib/wiki-parser.ts` (`parseResource` — union des topics) et `web/lib/wiki-md.ts`,
  **sans modifier `wiki-project.ts`**. Ton chantier B **modifie `wiki-project.ts`** (nœuds
  d'entités) : peu de recouvrement, mais si la spec thèmes est implémentée en parallèle,
  coordonne les éditions d'`ingest-local.ts`. **Ne refais pas le travail des thèmes.**
- Note : le même mécanisme « backfill déterministe » conçu pour les thèmes (script
  `wiki-backfill-topics.ts`) est un bon modèle pour le backfill des labels de nœuds (B-iii).

## Par où commencer

- Symptôme A : `web/app/api/chat/route.ts` (POST) ; `web/lib/chat-agent.ts` — `WIKI_TOOLS`
  (~L14-40), `executeWikiTool` (~L60-108), `buildSystemPrompt` (~L351-406) ; `web/lib/wiki-fs.ts`
  (`readWikiFile`, `listWikiDir`) ; `wiki/index.md` (absence de section Entités).
- Symptôme B : `web/lib/wiki-project.ts` (~L569-576 émission nœuds entités ; `upsertNode`
  ~L304-306) ; `web/components/graph/GraphView.tsx` (~L179 `paintNode`, ~L235 tooltip) ;
  `wiki/graph.json` (nœuds `entity:n8n|supabase|databricks` nus) ; `loadRegistries()` dans
  `web/lib/ingest-local.ts` (source des labels d'entités).
- Registre au moment du bug : entités (toutes `entity_type: tool`) = `claude-code`,
  `databricks`, `n8n`, `supabase`.

## Contraintes & conventions

- **Règles cardinales** ([CLAUDE.md](CLAUDE.md)) : `raw/` immuable ; le markdown sous
  `wiki/` = seule source de vérité ; `wiki/resources/*.md` canonique, le reste (dont
  `graph.json`) est **dérivé** ; les slugs sont immuables ; l'écriture déterministe passe
  par `applyFileOps` scopé `wiki/`/`raw/`.
- Les outils du chat sont **lecture seule** — tout nouvel outil exposé à l'agent doit le
  rester (pas d'écriture depuis le chat).
- Accès IA : gateway LiteLLM d'entreprise (clé partagée), client `getAnthropic()`
  (`web/lib/claude.ts`). Le modèle du chat vient de `getAiSettings().model` (réglable).
- Arthur n'est pas développeur : la preuve que « ça marche » doit être **démontrée**
  (sortie de commande / comportement observé), jamais seulement affirmée.
- **Vérification attendue :**
  - B : après correctif + backfill, `grep -A1 'entity:n8n' wiki/graph.json` montre un
    `label` ; la vue graphe affiche les noms n8n/supabase/databricks ; les nœuds d'entités
    de toute nouvelle ingestion naissent labellisés.
  - A : dans le chat, « Qu'est-ce qui a été dit sur n8n ? » remonte la ou les ressources
    qui la mentionnent (dont la note point-equipe) et/ou `entities/n8n.md`.
  - Non-régression : `npm --prefix web test` vert ; `npm --prefix web run wiki:verify -- --json`
    → `errors === 0`.

## Hors périmètre

- La correction des **thèmes** (spec dédiée déjà écrite, cf. plus haut) — ne pas la
  refaire ni la modifier.
- Toute réorganisation de `raw/` ou renommage de slugs.
- Migration d'archi (Electron/gateway/local-first) : inchangée.
