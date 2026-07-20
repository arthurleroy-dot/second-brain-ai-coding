# Workflow d'ingestion

Comment une source déposée dans `/raw` devient une ressource du wiki + ses vues
dérivées. Suppose la connaissance de [wiki-spec.md](wiki-spec.md) (formats) et
[entities.md](entities.md) (liens).

**Invariant absolu :** l'agent d'ingestion n'écrit **que sous `wiki/`**. Il ne
touche jamais `/raw` ni `web/`. Cet invariant est garanti **déterministiquement**
par le garde-fou `canUseTool` du moteur local (`web/lib/ingest-local.ts`) : toute
écriture hors `wiki/` est refusée. Il empêche aussi que l'agent modifie ses propres
sources d'entrée (`raw/` reste immuable).

---

## 1. Détection des fichiers à traiter

La source de vérité du « déjà traité » est le manifeste `wiki/_ingested.json` :

```json
{
  "version": 1,
  "files": {
    "state-of-ai-2026.pdf": {
      "slug": "state-of-ai-2026-untapped-edge",
      "ingested_at": "2026-07-08",
      "run": "local"
    }
  }
}
```

La **clé** est le nom du fichier de **contenu** (`state-of-ai-2026.pdf`), jamais
le sidecar `.meta.md`.

Un fichier `/raw` est **à traiter** s'il remplit toutes ces conditions :
- extension de contenu : `.md`, `.txt`, `.pdf`, `.pptx`, `.docx` ;
- n'est pas `README.md` ni un `*.meta.md` (sidecar de métadonnées) ;
- sa clé est absente de `wiki/_ingested.json`.

Cette logique est implémentée en TypeScript par `detectPending()`
(`web/lib/ingest-local.ts`) : contenu de `raw/` moins `README.md`, moins les
sidecars `*.meta.md`, moins les clés déjà présentes dans le manifeste. Elle vaut
pour tout déclencheur (fin d'upload ou relance manuelle). Si aucun fichier n'est à
traiter → ne rien faire (coût nul). Un fichier déposé **directement par git** dans
`raw/` (sans passer par la plateforme) est rattrapé au prochain déclenchement
(détection idempotente).

---

## 2. Sidecar de métadonnées `<source>.meta.md`

Tout fichier déposé via la plateforme est accompagné d'un sidecar
`raw/<source>.meta.md`, écrit sur le disque local à côté du fichier de contenu par
la route d'upload (même lot `applyFileOps`). Le fichier de contenu reste
**byte-identique** (raw immuable) ; le sidecar porte ce que l'humain a saisi :

```yaml
---
title: "Titre saisi (peut être vide)"
type: article                 # source_type choisi dans la modale
author: "Auteur / Organisation"
date: "2026-07"
url: "https://..."
deposited_by: "Prénom"
links:                        # liens TYPÉS déclarés (optionnel) — voir entities.md
  tool: [n8n, claude-code]
  client: [acme-corp]
entities_granularity:         # granularité PAR type (map) — un type absent ⇒ auto
  tool: chunk
themes: [agentic-coding, finops-ia]   # thèmes déclarés (optionnel) — liste plate
themes_granularity: auto      # auto | resource | chunk (indice pour l'agent)
---
```

(Ancien format encore accepté : `entities: [n8n]` — liste plate sans type.)

Les `themes:` déclarés sont **autoritaires** (comme `links:`) : l'agent crée/relie
directement le thème, même nouveau. `themes_granularity` est un **indice grossier**
(la ressource n'est pas encore découpée à l'upload) — l'agent choisit les sections
exactes. Voir [entities.md](entities.md) pour le mécanisme candidate (thèmes inclus).

**Précédence « l'humain gagne si rempli » :** une métadonnée saisie dans le
sidecar est autoritaire ; l'agent ne comble que les champs vides par inférence.
L'`url` n'est **jamais** devinée depuis le contenu — elle vient uniquement du
sidecar. Un dépôt manuel par git peut ne pas avoir de sidecar : dans ce cas
l'agent infère tout (et applique l'heuristique origin de wiki-spec.md §5).

---

## 3. Étapes par fichier à traiter

1. Lire le fichier de contenu en entier (+ son sidecar `.meta.md` s'il existe).
   Une source `.txt` (ou un texte collé via la plateforme) peut être du **texte
   brut non structuré** : elle sera normalisée en markdown propre à l'étape 4
   (titres, paragraphes, listes) sans perte d'information. Un `.md` déjà bien
   formé garde sa structure.
2. Déterminer : `title`, `source_type`, `author`, `date`, `topics`, `url`,
   `origin` (heuristique wiki-spec.md §5). Le sidecar prime sur l'inférence.
3. Détecter les entités (voir [entities.md](entities.md)) : alias connu → lien
   (mandat de complétude : TOUTE mention connue est reliée) ; écriture inconnue →
   candidate dans `entities/_candidates.json`. Déterminer la granularité
   (resource vs chunk ; `entities_granularity` déclaré = indice PAR type d'entité).
   Une entité déclarée ne part jamais en candidate. Appliquer les décisions humaines déjà posées
   (`status` ≠ `pending`) et purger.
3bis. Déterminer les thèmes (`topics:`) — même confiance graduée : `themes:` du
   sidecar → crée/relie directement (même nouveau) ; thème détecté connu → relie ;
   sujet inédit → candidate dans `themes/_candidates.json` (ne crée pas). Appliquer
   les décisions thèmes déjà posées et purger. Granularité via `themes_granularity`.
4. Créer `/wiki/resources/<slug>.md` : frontmatter + blockquote de navigation +
   contenu intégral avec chunk annotations (`topics:` et `entities:`). Si la
   source est du texte brut, **structure-la** ici en markdown lisible (fidélité
   intégrale : on met en forme, on ne raccourcit pas).
5. Pour chaque topic : mettre à jour `/wiki/themes/<topic>.md` (entrée ressource
   + liens vers les sections concernées).
6. Créer ou mettre à jour `/wiki/authors/<slug-auteur>.md` (ligne dans la table).
7. Pour chaque entité liée : mettre à jour `/wiki/entities/<slug>.md`.
8. Ajouter les entrées dans `types.md`, `origin/interne.md` + `origin/externe.md`
   (les deux pages toujours présentes), `by-date/`.
9. Mettre à jour `index.md`.
10. Ajouter nodes/edges dans `graph.json` (ne pas régénérer de zéro).
11. Ajouter l'entrée `{ "<fichier-contenu>": { slug, ingested_at, run } }` dans
    `wiki/_ingested.json`.
12. Ajouter une entrée dans `log.md`.

> **Décisions candidates & suppression.** L'application des décisions
> `merge_alias`/`create`/`reject` (étapes 3 et 3bis) et la suppression de ressources
> sont désormais faites **DÉTERMINISTIQUEMENT et in-process par la plateforme** (moteur
> `web/lib/wiki-mutate.ts`, cf. [entities.md](entities.md) §7) — dès le clic, sans
> attendre l'ingestion. L'application par cet agent reste un **fallback idempotent**
> (une décision déjà appliquée a purgé son entrée : rien à faire).

Traiter tout le lot sans demander validation à chaque fichier. Résumé final :
nombre de ressources créées, tensions détectées, `needs_review` à résoudre,
entités candidates ajoutées.

---

## 4. Automatisation (ingestion locale)

Le pipeline est piloté **in-process** par `web/lib/ingest-local.ts` : un agent IA
embarqué via `@anthropic-ai/claude-agent-sdk` (le moteur `claude` packagé en
librairie, PAS le CLI externe). `runIngestion()` :

- **Déclencheurs** : automatique en **fin d'upload** (arrière-plan, non bloquant —
  `web/app/api/upload/route.ts`) + **relance manuelle** via `POST /api/ingest`
  (bouton de l'UI). Il n'y a ni GitHub Action, ni cron : la détection idempotente
  (§1) rattrape au prochain déclenchement tout fichier déposé entre-temps (y
  compris par git direct dans `raw/`).
- **Verrou** : `acquireLock()` crée `<DATA_ROOT>/.data/ingest.lock` de façon
  atomique (`O_EXCL`). Si le verrou est déjà tenu, `runIngestion()` est un no-op →
  les déclenchements rapprochés sont **sérialisés** (jamais de double run).
- **Détection** : `detectPending()` (§1) calcule la liste des fichiers à traiter.
  Liste vide → état `done`, rien d'autre.
- **Agent** : `query({ prompt, options })` du SDK, avec `cwd = DATA_ROOT`. L'agent
  n'a accès qu'à `wiki/` + `raw/` (il ne voit ni `CLAUDE.md` ni `docs/`, qui vivent
  hors du dossier de données) — c'est pourquoi **les règles du projet sont INJECTÉES
  dans le prompt** : `buildIngestPrompt` concatène `prompts/ingest-prompt.md` +
  `CLAUDE.md` + `docs/ingestion.md` + `docs/wiki-spec.md` + `docs/entities.md`
  (lus depuis `REFERENCE_DOCS_ROOT`), puis la liste des fichiers du run. Outils
  lecture seule auto-approuvés (`Read`, `Glob`, `Grep`, `TodoWrite`) ; `Bash`,
  `WebFetch`, `WebSearch`, `Task` interdits ; `settingSources: []` (n'hérite
  d'aucun réglage utilisateur/projet).
- **Garde-fou écriture** : `canUseTool` intercepte tout outil d'écriture
  (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) et n'autorise que les chemins
  résolus **sous `wiki/`** (`allow`), refuse tout le reste (`deny`). C'est la
  ceinture déterministe qui remplace l'ancien `settings.json` dédié à l'Action.
- **Auth** : l'agent SDK s'authentifie sur la gateway LiteLLM en **Bearer**
  (`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`), dans un `HOME`/`CLAUDE_CONFIG_DIR`
  temporaire isolé (cf. [platform.md](platform.md) §6).
- **Vérification** : après l'agent, `runWikiVerify()` lance
  `npm run wiki:verify` (spawn `scripts/wiki-verify.ts`) qui recontrôle la
  cohérence liens/entités/graphe/manifeste (voir [entities.md](entities.md) §6).
  Mode **non bloquant** : la queue du rapport est stockée dans l'état
  (`logTail`), rien n'est annulé. C'est le filet du moteur LLM.
- **État** : `<DATA_ROOT>/.data/ingest-state.json`
  (`status: idle|running|done|error`, `pending`, `slug`, `error`, `logTail`) +
  journal détaillé `<DATA_ROOT>/.data/ingest.log`. Lu par `GET /api/ingest-status`
  (voir [platform.md](platform.md) §4). Un run non abouti passe en `error` ; la
  relance manuelle (ou le prochain upload) le rejoue — la détection par manifeste
  est idempotente.

Le **texte paraphrasé** peut varier d'un run à l'autre (le LLM n'est pas
déterministe sur la prose) ; tout ce qui touche le graphe est cadré par le mandat
de complétude du prompt + le vérificateur `wiki:verify`, l'idempotence du manifeste,
et le garde-fou d'écriture hors `wiki/`. Les décisions candidates et les
suppressions, elles, sont **entièrement déterministes** (moteur TypeScript
`web/lib/wiki-mutate.ts`, cf. [entities.md](entities.md) §7).
