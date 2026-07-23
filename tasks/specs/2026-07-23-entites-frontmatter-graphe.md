# Entités : remontée frontmatter + section index + nœuds de graphe labellisés

## Contexte

Deux bugs visibles autour des **entités** (outils/clients récurrents : n8n, Claude
Code, Supabase, Databricks) dans la plateforme locale du wiki (`web/`).

- **A — le chat ne retrouve pas une entité.** Dans le chat de la plateforme,
  « Qu'est-ce qui a été dit sur n8n ? » répond « aucune mention », alors que
  `wiki/entities/n8n.md` existe et que des ressources la citent en prose (ex.
  `wiki/resources/point-equipe-plateforme-etat-de-notre-pratique-du-coding-assiste-par-ia.md`
  : « Nos automatisations internes tournent sur n8n »). L'agent de chat
  (`web/lib/chat-agent.ts`, `runWikiAgent`) ne dispose que de deux outils
  génériques (`read_wiki_page`, `list_wiki_folder`) et sa consigne l'oblige à
  **partir toujours de `index.md`** ([chat-agent.ts:366](web/lib/chat-agent.ts#L366)).
  Or `wiki/index.md` **n'a aucune section Entités** → le terme « n8n » est invisible
  depuis sa porte d'entrée ; l'agent ouvre des ressources au jugé et conclut « aucune
  mention ».
- **B — nœuds d'entités sans nom dans le graphe.** `wiki/graph.json` contient
  `{"id":"entity:n8n","type":"entity"}` **sans `label` ni `entity_type`** (idem
  `entity:supabase`, `entity:databricks`), alors que `entity:claude-code` a bien
  `"label":"Claude Code"`. La vue graphe (`web/components/graph/GraphView.tsx`)
  n'affiche donc pas leur nom.

**Cause racine commune (vérifiée dans le code), l'asymétrie entités ↔ thèmes.** Les
thèmes disposent d'un rollup déterministe qui remonte les annotations de section dans
le frontmatter (`rollupSectionTopics`, [ingest-local.ts:721](web/lib/ingest-local.ts#L721)) ;
les entités **n'ont aucun équivalent**. La note `point-equipe-…` porte ainsi
`entities: []` dans son frontmatter alors que son corps annote
`` `entities: [claude-code, n8n, supabase, databricks]` `` en section. Conséquences :
(a) aucune section Entités constructible dans `index.md` ; (b) le graphe n'obtient le
`label`/`entity_type` d'une entité **que si elle est déclarée-nouvelle pendant
l'ingestion courante** ([wiki-project.ts:571-573](web/lib/wiki-project.ts#L571-L573)),
jamais depuis le registre pour une entité **déjà validée** (le cas normal d'une
mention). `claude-code` est labellisé par hasard : il est entré dans le graphe lors
d'une ingestion antérieure où il était, lui, déclaré-nouveau.

**Demande d'origine de l'utilisateur.** (1) Rendre les entités **symétriques des
thèmes** avec un code déterministe qui les remonte au frontmatter et enrichit
`index.md`, pour que le chat les retrouve **sans nouvel outil**. (2) Garantir que la
mention d'une entité déjà validée se relie **au nœud validé existant** — jamais un
nouveau nœud, jamais un nœud nu — et que **ça ne se reproduise plus**.

## Plan

> Ce plan est le miroir strict de patrons **déjà éprouvés** dans le code : le rollup
> des thèmes (`rollupSectionTopics`), le backfill des thèmes (`wiki-backfill-topics.ts`),
> la section Thèmes de `index.md` (`updateIndex`). Rien d'inventé.

### Prérequis (Étape 0, hors périmètre de cette implémentation)

Le chantier **thèmes** (`rollupSectionTopics` / `rebuildNav` /
`wiki-backfill-topics.ts`) est **non commité dans le working tree** au moment où cette
spec est écrite. Ce chantier entités en est le miroir et touche les mêmes fichiers
(`ingest-local.ts`, `wiki-project.ts`, `index.md`).

**Avant de démarrer l'implémentation entités :** finir/commiter le chantier thèmes
(`npm --prefix web test` vert), puis partir d'une base propre. Ne pas refaire ni
modifier le travail thèmes. Si `rollupSectionTopics`, `rebuildNav`, `loadProjectViews`,
`humanize`, `fmArray`, `patchInlineArray`, `wiki-backfill-topics.ts` ne sont pas encore
présents/commités, l'implémentation entités est bloquée tant que ce prérequis n'est pas
levé.

### 1. `rollupSectionEntities()` — remontée frontmatter (miroir de `rollupSectionTopics`)

`web/lib/ingest-local.ts` — ajouter juste sous `rollupSectionTopics`
([:721](web/lib/ingest-local.ts#L721)), fonction identique sur `meta.entities` +
`patchInlineArray(nf, 'entities', e)`. Forme attendue :

```ts
/** Miroir entités de rollupSectionTopics : remonte l'union des entités de section
 *  dans le frontmatter `entities:`. Idempotent (union ⊆ frontmatter → no-op). */
export function rollupSectionEntities(markdown: string): string {
  const meta = parseResourceMeta(markdown, '');   // meta.entities = union(frontmatter, chunk)
  const { fm, rest } = splitFrontmatter(markdown);
  let nf = fm;
  for (const e of meta.entities) nf = patchInlineArray(nf, 'entities', e); // crée la clé si absente
  return withFrontmatter(nf, rest);
}
```

La brancher dans `ingestOne` **juste après** l'appel `rollupSectionTopics` (~L814) :
`markdown = rollupSectionEntities(markdown);` (avant le `parseResourceMeta` qui suit,
pour que `meta` en aval voie le frontmatter complété). `patchInlineArray`,
`splitFrontmatter`, `withFrontmatter`, `parseResourceMeta` sont déjà utilisés/importés
dans ce fichier (`forceDeclaredLinks` L708-709).

### 2. Labels/types d'entités dans la projection (correctif B, à la source)

- `web/lib/wiki-project.ts` `ProjectViews` ([:56-80](web/lib/wiki-project.ts#L56)) :
  ajouter `entityLabels: Record<string,string>` et `entityTypes: Record<string,string>`
  (miroir de `themeLabels` L60).
- `web/lib/ingest-local.ts` `loadProjectViews` ([:801-815](web/lib/ingest-local.ts#L801-L815))
  : dans la boucle entités déjà présente (`for (const e of meta.entities)`), remplir
  `entityLabels[e]` / `entityTypes[e]` — dans l'ordre de priorité :
  1. `newEntities[e]` si défini (entité déclarée-nouvelle → `.label` / `.entity_type`),
  2. sinon `reg.entities.find(x => x.slug === e)` (registre : `EntityEntry` expose
     `label` et `entity_type`, cf. [wiki-parser.ts:296-301](web/lib/wiki-parser.ts#L296-L301)),
  3. sinon repli `humanize(e)` / `'concept'`.

  C'est exactement le patron des thèmes L818-823 (`themeLabels[t] = known ? known.label
  : … ?? humanize(t)`). Les nouveaux maps doivent aussi être renvoyés dans l'objet
  `views` construit par `loadProjectViews`.
- `web/lib/wiki-project.ts` émission des nœuds d'entités
  ([:569-576](web/lib/wiki-project.ts#L569-L576)) : remplacer la branche
  `decl ? {…label…} : {nœud nu}` par un upsert **toujours labellisé** :

  ```ts
  for (const e of meta.entities) {
    const resourceLevel = feEntities.includes(e);
    upsertNode(g, {
      id: `entity:${e}`, type: 'entity',
      entity_type: v.entityTypes[e], label: v.entityLabels[e],
    });
    const secs = resourceLevel ? null : sections.filter((s) => s.entities.includes(e)).map((s) => s.anchor);
    upsertEdge(g, rid, `entity:${e}`, 'mentions', secs);
  }
  ```

  Miroir de la ligne thèmes L566. **Un nœud d'entité naît désormais toujours avec son
  nom**, qu'elle soit déclarée-nouvelle OU déjà au registre.

  > **Sémantique à garantir (invariant graphe).** Une mention d'une entité **déjà
  > validée** doit se relier à **l'unique nœud existant** de cette entité, jamais créer
  > un second nœud. C'est déjà structurellement vrai : l'`id` `entity:<slug>` est unique
  > et `upsertNode` n'insère que s'il est absent (aucun doublon possible), l'arête
  > `mentions` pointant toujours vers ce nœud unique. Le défaut corrigé ici n'est donc
  > PAS un doublon mais un nœud unique **écrit sans nom à sa première entrée** dans le
  > graphe ; §2 le fait naître nommé, §3 répare celui déjà présent.

### 3. `upsertNode` capable de compléter (auto-réparation)

`web/lib/wiki-project.ts` [:304-306](web/lib/wiki-project.ts#L304) : aujourd'hui
insert-only (`if (!g.nodes.some(n => n.id === node.id)) g.nodes.push(node)`). Le rendre
« upsert » réel : si le nœud existe, **compléter uniquement les champs absents**
(`existing[k] === undefined`), **sans jamais écraser** une valeur présente. Forme :

```ts
function upsertNode(g: Graph, node: GraphNode): void {
  const existing = g.nodes.find((n) => n.id === node.id);
  if (!existing) { g.nodes.push(node); return; }
  for (const [k, val] of Object.entries(node)) {
    if (val !== undefined && (existing as any)[k] === undefined) (existing as any)[k] = val;
  }
}
```

Rend la re-projection **auto-réparatrice** : un nœud nu déjà écrit récupère son label
lors d'un re-passage (indispensable au backfill §5 — l'insert-only ne les toucherait
jamais). Idempotence préservée (ne remplit que l'absent). Comportement cohérent avec les
thèmes, dont le label est aussi figé à la première insertion.

### 4. Section « ## Entités » dans `index.md` (miroir du bloc Thèmes)

`web/lib/wiki-project.ts` `updateIndex` ([:663-672](web/lib/wiki-project.ts#L663-L672))
: ajouter un bloc entités calqué sur Thèmes, itérant sur **`feEntities`** (frontmatter,
déjà calculé dans `projectResource`, cf. usage L570 `feEntities.includes(e)`) avec
`v.entityLabels`. Passer `feEntities` en paramètre à `updateIndex` (comme `feTopics`
L599/L626). Compteur `entity_count` (miroir `theme_count`, via `bumpScalarInt`).

- **Auto-amorçage** : `index.md` n'a pas encore de heading `## Entités`. Un
  `insertBulletUnderHeading(body, /^## Entités \(/m, …)` serait silencieusement sans
  effet. Prévoir un helper « insérer la section `## Entités (0)` si absente », placé
  **juste après la section `## Thèmes`** (modèle `addTypeSubsection`
  [:691](web/lib/wiki-project.ts#L691) qui crée une sous-section si le heading manque),
  puis insérer/incrémenter le bullet `- [[entities/<slug>|<label>]] — N ressource(s)`.
- Symétrie suppression : `web/lib/wiki-mutate.ts`, chemin `deleteResource` (décréments
  d'index, ~L900-930) — retirer/décrémenter le bullet d'entité comme pour les thèmes
  (l'insertion d'un thème candidat dans l'index se trouve ~L700-735 comme référence de
  patron d'écriture sur `index.md`).

### 5. Backfill `wiki-backfill-entities.ts` (miroir de `wiki-backfill-topics.ts`)

`web/scripts/wiki-backfill-entities.ts` — **copie structurelle** de
[web/scripts/wiki-backfill-topics.ts](web/scripts/wiki-backfill-topics.ts) :

- Pour chaque `wiki/resources/*.md` dont `meta.entities ⊄ feEntities` (garde
  d'idempotence : rien à faire si l'union est déjà dans le frontmatter) : appliquer
  `rollupSectionEntities` (pas besoin de `rebuildNav` : la nav ne contient pas les
  entités, seulement auteur/date/thèmes), puis re-projeter via `projectResource`
  (émet des nœuds labellisés **et** répare les nœuds nus via §3), via `loadProjectViews`
  + `applyFileOps` — exactement comme le backfill thèmes (L124-134).
- `reconcileIndex` miroir : la re-projection d'une ressource **déjà indexée**
  court-circuite `updateIndex` (`if (v.index.includes(resources/${slug}|)) return v.index`,
  L633), donc les bullets `## Entités` ne bougent pas ; relire le `resource_count`
  autoritaire de chaque page entité affectée et réécrire son bullet (créé si absent,
  section `## Entités` créée si absente — cf. helper §4).
- **Filet anti-nu** : en fin de script, balayer `graph.json` et remplir depuis le
  registre (`loadRegistries().entities`) le `label`/`entity_type` de tout nœud
  `entity:*` encore sans `label` (garantit zéro nœud nu, même pour un nœud dont la
  ressource source ne serait pas re-projetée). Écriture via `applyFileOps` (scopé
  `wiki/`).
- `--dry-run` identique. Brancher un script npm `"wiki:backfill-entities"` dans
  `web/package.json` (miroir de l'entrée du backfill thèmes).

### 6. Garde-fou vérificateur (prouve « ça n'arrive plus »)

`web/scripts/wiki-verify.ts` (bloc graphe [:376-473](web/scripts/wiki-verify.ts#L376))
: ajouter une catégorie **`graph-unlabeled-node`** (severity `error`) — tout nœud
`entity:<slug>` (par symétrie : `theme:`/`author:`/`type:`/`origin:`) doit avoir un
`label` non vide. Boucler sur `graph.nodes`, vérifier `String(n.label ?? '').trim() !== ''`
pour les nœuds dont l'`id` a l'un de ces préfixes. Documenter la catégorie dans l'en-tête
de fichier (liste ~L12-23). Transforme le bug B en échec de CI si récidive.

### 7. Chat : un pointeur, pas un outil

`web/lib/chat-agent.ts` `buildSystemPrompt` ([:365-380](web/lib/chat-agent.ts#L365)) :
ajouter une ligne à la STRUCTURE/MÉTHODE signalant la **section Entités de `index.md`**
comme point d'entrée pour toute question portant sur un outil/produit/organisation
(ex. « la section `## Entités` de `index.md` recense les entités ; pour une question sur
un outil/produit précis, va d'abord y repérer sa page `entities/<slug>.md`, qui liste ses
ressources »). **Aucun nouvel outil** : la section index + les pages `entities/<slug>.md`
(qui listent déjà leurs ressources sous `## Mentions`) suffisent au parcours index →
entité → ressources.

### 8. Tests (miroir des tests thèmes)

`web/lib/__tests__/` : unité `rollupSectionEntities` (union frontmatter∪chunk,
idempotence) ; `wiki-project` — (a) nœud d'une entité **déjà au registre** naît
labellisé, (b) `upsertNode` complète un nœud nu existant **sans écraser** un champ
présent ; section `## Entités` dans `index.md` (création de la section + incrément du
compteur) ; backfill entités (frontmatter remonté + nœud réparé) ; nouveau check
`graph-unlabeled-node` du vérificateur (nœud nu → erreur ; nœud labellisé → OK).

## Décisions

- **D1 — Voie déterministe (rollup + index) plutôt qu'un outil de recherche sur le
  chat.** Alternatives écartées : (1) exposer au chat un outil de recherche plein-texte
  (grep sur `wiki/resources/*.md`) ; (2) exposer un outil « entité » lisant
  `entities/<slug>.md` + suivant les arêtes `mentions` du graphe. **Choix :** corriger la
  cause racine (asymétrie entités/thèmes) en remontant les entités au frontmatter et en
  ajoutant une section Entités à `index.md`. **Raison :** traite le fond, profite à
  TOUTES les vues (index, graphe, tooling futur) et pas seulement au chat ; symétrique
  d'un patron existant et testé ; ne dépend pas de la qualité du frontmatter (qu'on
  répare justement) ; aucun nouvel outil à maintenir côté chat. Le chat retrouve n8n
  depuis sa porte d'entrée habituelle.

- **D2 — Commiter le chantier thèmes AVANT d'implémenter les entités.** Alternative
  écartée : fondre les entités dans le chantier thèmes en cours. **Choix :** finir/commiter
  thèmes, puis implémenter le miroir entités sur base propre. **Raison :** le travail
  thèmes est un WIP non commité dans le working tree ; séparer évite la collision sur
  `ingest-local.ts` / `wiki-project.ts` / `index.md` et garde chaque chantier vérifiable
  isolément.

- **D3 — Correctif B à la source + anti-récidive + backfill, comme section dédiée.**
  Exigence explicite de l'utilisateur : une mention d'une entité déjà validée doit se
  relier au **nœud validé existant unique**, jamais un nouveau nœud, jamais un nœud nu, et
  « ça ne doit plus arriver ». **Mécanisme retenu :** §2 (naissance labellisée depuis le
  registre) + §3 (`upsertNode` complète les nœuds nus existants) + §5 (backfill des 3
  nœuds nus actuels) + §6 (garde-fou vérificateur). **Précision actée :** il n'y a jamais
  de doublon de nœud (id unique, `upsertNode` insert-only) — le défaut est un nœud unique
  écrit sans nom, pas un nœud dupliqué.

- **D4 — `upsertNode` en complétion « champ absent seulement ».** Alternative écartée :
  écraser systématiquement le label depuis le registre à chaque projection. **Choix :** ne
  remplir que les champs `undefined`. **Raison :** préserve l'idempotence et le
  comportement des thèmes (label figé à la première insertion) ; suffit à réparer les
  nœuds nus sans risque de régression sur les nœuds déjà corrects.

- **D5 — Filet anti-nu dans le backfill (balayage du graphe depuis le registre).**
  **Raison :** garantir zéro nœud `entity:*` sans label même dans un cas de bord où la
  ressource source ne serait pas re-projetée ; ceinture + bretelles par rapport à la
  seule re-projection.

- **D6 — Chat : simple pointeur dans le prompt système, pas d'outil.** **Raison :** une
  fois la section Entités dans `index.md` et les pages entités listant leurs ressources,
  le parcours de navigation existant suffit ; les outils du chat restent en lecture seule
  et inchangés.

- **D7 — Longueur de `index.md` : non-sujet.** Les entités sont un ensemble borné (4
  aujourd'hui), du même ordre que les Auteurs (11) / Thèmes (8) déjà listés. Pas de
  pagination prématurée.

## Hors périmètre

- Le chantier **thèmes** (spec dédiée `tasks/specs/2026-07-23-remontee-themes-frontmatter.md`,
  à commiter en Étape 0) — ne pas le refaire ni le modifier.
- Tout **outil de recherche plein-texte / grep** exposé au chat, et toute modification des
  deux outils existants (`read_wiki_page`, `list_wiki_folder`) ou de leur nature
  lecture-seule.
- Réécriture des labels de graphe pour un **renommage** d'entité (le slug est immuable ;
  le label figé à la première insertion est un comportement cohérent avec les thèmes,
  hors sujet ici).
- Réorganisation de `raw/`, renommage de slugs, migration d'archi (Electron/gateway/local-first).

## Todo

> Prérequis bloquant : chantier thèmes commité et `npm --prefix web test` vert (Étape 0).

- [x] **1. `rollupSectionEntities()` + branchement `ingestOne`.**
      Fichier : `web/lib/ingest-local.ts`. Ajouter la fonction sous `rollupSectionTopics`
      et l'appeler après elle dans `ingestOne` (~L814).
      *Vérif :* nouveau test unité — sur un markdown à frontmatter `entities: []` + section
      `` `entities: [n8n]` ``, la sortie a `entities: [n8n]` au frontmatter ; ré-appliquer
      = no-op (idempotence). `npm --prefix web test` cible vert.

- [x] **2. `entityLabels`/`entityTypes` dans `ProjectViews` + `loadProjectViews` + émission
      des nœuds.**
      Fichiers : `web/lib/wiki-project.ts` (interface `ProjectViews`, boucle nœuds
      L569-576), `web/lib/ingest-local.ts` (`loadProjectViews` L801-815). Dériver le
      label/type depuis `newEntities[e]` → registre `reg.entities` → `humanize`/`'concept'`.
      *Vérif :* test `wiki-project` — projeter une ressource mentionnant une entité **déjà
      au registre** (non déclarée) produit un nœud `entity:<slug>` avec `label` et
      `entity_type` corrects (non nu). Typecheck OK (`npm --prefix web run build` ou `tsc`).

- [x] **3. `upsertNode` en complétion.**
      Fichier : `web/lib/wiki-project.ts` L304-306.
      *Vérif :* test — insérer d'abord un nœud nu `{id:'entity:x',type:'entity'}`, puis
      upsert `{id:'entity:x',type:'entity',label:'X',entity_type:'tool'}` → le nœud unique
      porte maintenant `label:'X'` ; un upsert ultérieur avec un `label` différent
      **n'écrase pas** le `label` déjà présent. Pas de doublon de nœud.

- [x] **4. Section `## Entités` dans `index.md` (création + incrément) + symétrie
      suppression.**
      Fichiers : `web/lib/wiki-project.ts` (`updateIndex`, helper create-if-missing),
      `web/lib/wiki-mutate.ts` (`deleteResource`).
      *Vérif :* test — projeter une ressource crée/complète `## Entités (N)` avec un bullet
      `- [[entities/<slug>|<label>]] — 1 ressource` ; supprimer la ressource décrémente/retire
      le bullet. `npm --prefix web test` vert.

- [x] **5. `wiki-backfill-entities.ts` + script npm + filet anti-nu.** (Réparation CIBLÉE
      retenue sur décision d'Arthur : remontée frontmatter + index + filet anti-nu, SANS
      re-projection — pour préserver les résumés IA soignés des pages thèmes/entités.)
      Fichiers : `web/scripts/wiki-backfill-entities.ts`, `web/package.json`.
      *Vérif :* `npm --prefix web run wiki:backfill-entities -- --dry-run` liste au moins
      `point-equipe-…` ; sans `--dry-run`, après exécution :
      `grep -A1 'entity:n8n' wiki/graph.json` montre un `label` (idem supabase, databricks) ;
      le frontmatter `entities:` de `point-equipe-…` n'est plus vide ; `index.md` a une
      section `## Entités` listant n8n. Ré-exécuter = no-op (idempotence).

- [x] **6. Check `graph-unlabeled-node` dans `wiki-verify.ts`.**
      Fichier : `web/scripts/wiki-verify.ts`.
      *Vérif :* avant backfill (ou sur un graphe de test avec un nœud nu), le check lève une
      erreur `graph-unlabeled-node` ; après backfill,
      `npm --prefix web run wiki:verify -- --json` → `errors === 0`. Mettre à jour l'en-tête
      de doc du fichier.

- [x] **7. Pointeur Entités dans le prompt système du chat.**
      Fichier : `web/lib/chat-agent.ts` (`buildSystemPrompt`).
      *Vérif :* end-to-end dans l'app (`/run`) — « Qu'est-ce qui a été dit sur n8n ? »
      remonte la note `point-equipe-…` et/ou `entities/n8n.md`, avec une ligne `SOURCES:`
      non vide (au moins la note). Démontrer la sortie observée.

- [x] **8. Non-régression finale.**
      *Vérif :* `npm --prefix web test` intégralement vert ;
      `npm --prefix web run wiki:verify -- --json` → `errors === 0` ; vue graphe de l'app
      affichant n8n / supabase / databricks nommés (capture ou description du comportement
      observé). Ré-ingérer une source citant une entité déjà validée → le nœud correspondant
      est labellisé (pas de nouveau nœud, pas de nœud nu).

## Bilan

**Statut : terminé, vérifié.** `npm --prefix web test` → **145/145 vert** ; `wiki:verify`
sur le vrai wiki → **errors: 0** (1 `warn` pré-existant : « ChatGPT » cité en prose dans
`top-engineers-…` mais non annoté — hors périmètre). Démo chat e2e sur le vrai wiki :
« Qu'est-ce qui a été dit sur n8n ? » → l'agent lit `index.md` → `entities/n8n.md` →
`resources/point-equipe-…`, répond correctement, `SOURCES:` non vide (avant : « aucune
mention »). Graphe : `entity:n8n/supabase/databricks` désormais labellisés (`GraphView`
rend `node.label`).

### Fait (conforme à la spec)
- **§1** `rollupSectionEntities()` + branchement `ingestOne` (miroir `rollupSectionTopics`).
- **§2** `entityLabels`/`entityTypes` dans `ProjectViews` + `loadProjectViews` ; nœuds
  d'entités **toujours labellisés** (registre → repli), plus de branche « nœud nu ».
- **§3** `upsertNode` en **complétion** (remplit l'absent, n'écrase jamais) → auto-réparateur.
- **§4** Section `## Entités` dans `index.md` (helper partagé `ensureEntitiesSection`,
  compteur `entity_count`) + symétrie décrément dans `deleteResource`.
- **§6** Check `graph-unlabeled-node` dans `wiki-verify.ts` (démontré : 3 erreurs avant
  backfill, 0 après). **§7** Pointeur Entités dans le prompt du chat (aucun nouvel outil).
- **§8** Tests miroir des thèmes (rollup entités, nœud labellisé depuis registre, upsert
  complétion + non-écrasement, section index + delete, check vérificateur).

### Écarts au plan (décidés avec Arthur, en séance)
1. **Niveau de mention préservé (correctif au-delà de la spec).** Le §2 de la spec, en
   dérivant `resourceLevel` de la présence au frontmatter, **aplatissait** toute entité
   remontée en « Ressource entière » (perte des ancres de section sur les fiches d'entités
   et le graphe). Correctif d'une ligne, validé par Arthur : `resourceLevel = aucune
   section ne cible l'entité` (exactement comme les thèmes). Résultat : entités au
   frontmatter **ET** ancres de section conservées ; le chat va index → entité → ressource →
   **sections précises**. Tests 292/327 mis à jour + test « resource-level » ajouté.
2. **Backfill CIBLÉ au lieu de re-projection complète (§5).** La re-projection prévue par la
   spec régénérait aussi les pages **thèmes/origine** des 6 fiches, **écrasant les résumés
   IA soignés** de l'ingestion initiale (et corrigeant au passage des ancres cassées type
   `#the-fix`). Sur décision d'Arthur (réparation minimale) : le backfill ne fait plus que
   (a) remonter les entités au frontmatter, (b) reconstruire la section index depuis le
   registre, (c) filet anti-nu sur le graphe — **sans re-projeter**. Blast radius réel : **8
   fichiers** (6 frontmatters + `graph.json` + `index.md`), résumés soignés **intacts**.
   Appliqué au vrai wiki, idempotent, `verify` vert.

### Notes / dette laissée sciemment
- **Ancres de section cassées** dans certaines pages thèmes (vieux blocs LLM, ex. `#the-fix`
  qui ne pointe vers aucune section) : **pré-existant, hors périmètre**. Une re-projection
  déterministe les corrigerait, au prix des résumés soignés — non retenu ici.
- **Warning `missed-link` ChatGPT** (prose de `top-engineers-…`) : contenu, non structurel.
- **Format visuel de la section `## Entités`** (pas de ligne vide sous le heading) : c'est le
  format machine natif (comme toute section créée par le moteur) ; valide, sans impact chat.

---

Fichier créé : `tasks/specs/2026-07-23-entites-frontmatter-graphe.md`

Commande à taper dans une **nouvelle session** (après commit du chantier thèmes) :

```
/implement @tasks/specs/2026-07-23-entites-frontmatter-graphe.md
```
