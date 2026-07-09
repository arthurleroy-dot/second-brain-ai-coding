# TODO

Plan de travail courant. Coche les items au fur et à mesure ; ajoute une section
« Review » en fin de chantier (résumé de ce qui a été fait + vérifications).

Voir les règles dans [../docs/code-workflow.md](../docs/code-workflow.md).

## En cours : plateforme git-first + ingestion automatisée

- [x] Phase 0 — Committer la migration wiki (structure 3 couches figée)
- [x] Phase 1 — Restructuration doc agent (CLAUDE.md court + docs/ + tasks/)
- [x] Phase 2 — Manifeste `_ingested.json` + GitHub Action d'ingestion
- [x] Phase 3 — Système d'entités (registre, candidates, rétro-annotation)
- [x] Phase 4 — La plateforme lit le markdown (wiki-parser/query fs, PDF proxy)
- [x] Phase 5 — Upload → commit GitHub (github.ts, route upload, IngestStatus)
- [x] Phase 6 — Chat sur le markdown (chat-context fs)
- [x] Phase 7 — Nettoyage Supabase (drop tables wiki)
- [x] Phase 8 — Déploiement Vercel + protection mot de passe

## Feature : liens typés + suggestions à l'upload (2026-07-08)

Objectif : à l'upload, la personne choisit le **type** de lien (outil, client, …)
et pas seulement le nom, avec suggestions des entités/types déjà connus. Le
formulaire s'auto-étend : il lit les `entity_type` existants du registre. Si non
spécifié, l'agent détecte (modèle de confiance gradué).

- [x] `GET /api/entities` : registre groupé par type (réutilise `listEntities`)
- [x] `lib/ui.ts` : `entityTypeLabel(type)` (tool→Outils, client→Clients, fallback)
- [x] `UploadModal` + `LinkPicker` : sections par type existant + input à suggestions
      (datalist + chips cliquables) + « nouveau type de lien » ; envoie `links` (JSON map)
- [x] `api/upload` : parse `links` (slugifie/dédoublonne), bloc `links:` typé dans le sidecar
- [x] `docs/entities.md` + `docs/ingestion.md` + prompt d'ingestion : format `links:`
      typé + confiance graduée (type explicite → créé direct ; sinon → candidate)
- [x] Build + vérif dev + commit

Format sidecar cible :
```yaml
links:
  tool: [n8n, claude-code]
  client: [acme-corp]
entities_granularity: auto
```
(Le frontmatter des `resources/` reste `entities: [slug]` — le type vit dans le
registre `wiki/entities/<slug>.md`. Rétro-compat : l'agent accepte aussi l'ancien
`entities: [...]` plat.)

### Review feature

Implémenté et vérifié (build vert). À l'upload, les liens sont désormais **typés
et suggérés** : le formulaire lit `/api/entities`, affiche un groupe par
`entity_type` existant (ex. « Outils ») avec autocomplétion + chips cliquables des
entités connues, et permet de créer un nouveau type de lien (ex. « client ») à la
volée → le système s'auto-étend. Le sidecar porte un bloc `links:` typé
(slugifié, dédoublonné), et l'agent applique une confiance graduée (type explicite
→ création directe ; nom seul/détecté → alias connu lié, inconnu → candidate).

Vérifié : `/api/entities` renvoie `tool`→4 entités ; `parseLinks` slugifie/
dédoublonne ; le sidecar `links:` est parsé correctement par gray-matter ; aucune
trace de l'ancien champ texte. Non vérifiable en local : le rendu interactif du
formulaire (client) et le comportement réel de l'agent (nécessite un run d'Action).

## Review

Les 8 phases sont implémentées et committées en local (10 commits, de `5e4514e`
à `0464fab`). Build `npm run build` vert à chaque phase.

**Vérifié en dev :** 13 sources lues depuis le markdown ; compteurs thèmes/types/
auteurs corrects ; proxy PDF (noms simples et complexes) ; iframe dans les fiches ;
wikilinks convertis ; chat — « Deloitte + agents » remonte le rapport Deloitte,
« Claude Code » remonte les 6 ressources liées à l'entité, filtres respectés ;
auth — redirection /login, mauvais/bon mot de passe, cookie valide/falsifié.

**Non vérifiable en local (dépend de secrets/déploiement fournis par l'humain) :**
run réel de l'Action d'ingestion (nécessite `ANTHROPIC_API_KEY` + push) ; commit
d'upload réel (nécessite `GITHUB_TOKEN`) ; exécution du SQL de migration Supabase ;
compatibilité CLI Claude Code ↔ proxy LiteLLM.

**Reste à faire côté humain :** pousser les commits sur `main` ; poser les secrets
GitHub Actions + variables Vercel ; créer le PAT GitHub ; exécuter le SQL de
migration ; trancher les 3 entités candidates (Cursor, GitHub Copilot, Windsurf).

**Leçon clé :** ne pas mettre de deny bloquants dans le `.claude/settings.json`
partagé (voir [lessons.md](lessons.md)) — le garde-fou de l'Action vit dans
`.github/ingest-settings.json` chargé via `--settings`.

## Chantier : gestion des entités + ingestion fiable (2026-07-09)

Stratégie décidée avec l'utilisateur : **un socle web construit une fois + deux
moteurs d'ingestion interchangeables qu'on compare** (LLM d'abord, TypeScript
déterministe ensuite sur une branche). Critère réel = *zéro lien raté / entité
oubliée*, pas le déterminisme pour lui-même. **Contrat de sortie unique** que les
deux moteurs devront produire : `wiki/entities/_candidates.json` (structuré),
frontmatter `entities:` + chunks, `graph.json`, manifeste. Un **vérificateur
déterministe** (à venir) mesurera les liens ratés et départagera les moteurs.

### Étape 1 — Page de gestion des candidats (FAIT)

- [x] Contrat `wiki/entities/_candidates.json` (seed : Cursor, GitHub Copilot,
      Windsurf, migrés du `_candidates.md`) + types `Candidate` dans `types/index.ts`.
- [x] Parsers `listCandidates()` + `getEntity()` (`wiki-parser.ts`) ; wikilinks
      `entities/` → `/entities/<slug>` (`wiki-md.ts`).
- [x] `GET /api/candidates` (+ `pending`) ; badge « N en attente » dans `TopBar`.
- [x] Page `/entities` (`EntitiesView` : section « en attente » = `CandidateCard`,
      section « registre » = liste d'entités) + détail `/entities/[slug]` + nav
      `Sidebar`/`TopBar`.
- [x] Voir + agir : `dispatchIngest()` (`github.ts`), `POST /api/candidates/resolve`
      (écrit la décision dans `_candidates.json` via commit GitHub puis relance
      l'ingestion), boutons Fusionner / Créer(+type) / Rejeter dans `CandidateCard`.
- [x] Build vert ; vérifié en dev : API renvoie 3 candidates + 4 entités,
      `/entities` 200, `/entities/claude-code` rend label + type, slug inconnu → 404.

Règle actée (demande utilisateur) : le système ne **propose jamais** un nouveau
`entity_type` — une candidate est une nouvelle entité rattachée à un type déjà
connu ; un nouveau type ne naît que d'une action humaine (formulaire d'upload, ou
« Créer + nouveau type » sur la page). `suggested_types` ⊆ types du registre.

### Étape 2 — Moteur LLM fiable + vérificateur (FAIT)

- [x] Vérificateur autonome `web/scripts/wiki-verify.ts` (tsx, sans alias `@/`) :
      missed-link / unknown-entity / duplicate-entity / candidate-collision /
      invented-type / graph-missing-node|edge / manifest-missing. Défaut = rapport
      + exit 0 ; `--strict` = exit 1 si un problème ; `--json` = comptage.
      Script `npm --prefix web run wiki:verify`.
- [x] Super-prompt `.github/prompts/ingest-prompt.md` : écrit le contrat
      `_candidates.json`, **mandat de complétude** (relier toute mention connue),
      anti-doublon, type fermé (jamais de nouveau `entity_type`), applique+purge
      les décisions humaines.
- [x] `_candidates.md` supprimé ; `_candidates.json` = source unique. Docs
      alignées (entities.md §4/§6, ingestion.md §3/§4, wiki-spec.md, README).
- [x] Action `ingest.yml` : `npm --prefix web ci` (tsx) + step `wiki:verify` non
      bloquant après l'agent.
- [x] Vérifié : verify propre sur le corpus ; cas piégé (mention non reliée) bien
      signalé (missed-link claude-code + n8n) ; build web vert.

### Étape 3 — Moteur TypeScript déterministe (À FAIRE, branche `feat/ts-resolver`)
Le resolver du plan `~/.claude/plans/je-voudrais-cr-er-un-iterative-mitten.md`.
On compare les deux moteurs sur les 13 ressources, on garde le meilleur.
