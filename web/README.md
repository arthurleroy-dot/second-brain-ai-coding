# Second Brain — Front-end Next.js

Front-end du *second brain* AI Coding : chat IA branché sur le wiki, navigation par
thème / auteur / date / type / entité, dépôt de nouvelles sources et ingestion locale.
Empaqueté en **application de bureau Electron** (modèle local-first).

Le wiki est lu **et écrit directement sur le disque local** (sous `DATA_ROOT`,
aucune base intermédiaire, aucune API distante). L'accès au modèle se fait via l'API
Anthropic (**Anthropic en direct** ou une **passerelle compatible**, ex. gateway
LiteLLM), configuré dans l'écran **Réglages** (`/reglages`). Voir
[`../docs/platform.md`](../docs/platform.md) pour l'architecture.

## Prérequis

- Node.js 18+
- (Optionnel) une clé de la gateway LiteLLM + son URL pour activer le chat et
  l'ingestion. Sans clé, l'app démarre et lit le wiki ; seuls chat et ingestion
  sont désactivés.

## Installation

```bash
cd web
npm install
cp .env.local.example .env.local   # puis renseigner les valeurs (optionnelles)
npm run dev                          # http://localhost:3000
```

## Variables d'environnement (`.env.local`)

Voir [`.env.local.example`](.env.local.example). **Aucune n'est obligatoire** pour
démarrer et lire le wiki. Dans l'app, l'accès IA vient de l'écran **Réglages** (store
`<DATA_ROOT>/.data/ai-settings.json`, **clé en clair**, relu à chaud) ; le `.env.local`
n'est qu'un **secours de dev** (le store prime).

- `ANTHROPIC_API_KEY` — clé IA (chat + ingestion). Vide = chat et ingestion désactivés
  (le reste fonctionne).
- `ANTHROPIC_BASE_URL` — cible : vide = Anthropic direct ; sinon une passerelle compatible
  (ex. `https://llm-gateway.m33.tech`).
- `ANTHROPIC_MODEL` — modèle (défaut `claude-sonnet-4-5`).
- `DATA_ROOT` / `WIKI_ROOT` / `RAW_ROOT` — emplacement des données (optionnel ;
  défaut dev : racine du dépôt, un cran au-dessus de `/web` ; en Electron : `userData`).
- `REFERENCE_DOCS_ROOT` — racine des assets de référence (le **prompt d'ingestion** ;
  défaut : racine du dépôt).

## Architecture

- `lib/wiki-fs.ts` — accès disque au wiki et à `raw/` sous `DATA_ROOT`
  (`WIKI_ROOT`/`RAW_ROOT`, garde anti path-traversal). **Écriture locale atomique**
  via `applyFileOps(ops)` (temp + `rename` ; garde-fou : chemins sous `wiki/` ou
  `raw/` uniquement) ; lecture `readRepoFile`/`readRepoBinary` ; `resolveAvailableRawName`.
- `lib/wiki-parser.ts` — parse `resources/*.md` (frontmatter + chunks `topics:`/`entities:`) → `Source` ;
  expose `listAllSources`, `getResource`, `getSourceDetail`, `listTopics`, `listAuthors`,
  `listTypes`, `listDates`, `listEntities`.
- `lib/wiki-md.ts` — transforme les wikilinks Obsidian en liens plateforme, strip des annotations.
- `lib/wiki-query.ts` — façade de lecture + helpers chat.
- `lib/chat-agent.ts` — boucle agentique du chat (`runWikiAgent` : outils
  `read_wiki_page` / `list_wiki_folder`, `buildSystemPrompt`).
- `lib/chat-filters.ts` — validation des sources citées contre les filtres du panneau.
- `lib/ingest-local.ts` — **ingestion locale « IA + déterministe »** : un seul
  `messages.create` par ressource (via `lib/claude.ts`) qui produit la page canonique +
  un bloc `<detected-new>` ; `detectPending`, verrou anti-double-run, extraction PDF
  locale (`unpdf`), coût par run, filet `wiki:verify`, `runIngestion`. **N'écrit rien** :
  délègue toute l'écriture à `lib/wiki-project.ts`.
- `lib/wiki-project.ts` — **moteur déterministe de projection** (l'inverse de la
  suppression) : à partir de la seule page ressource produite par l'IA, reconstruit
  toutes les vues dérivées + les 7 relations du graphe + le manifeste. Fonctions pures → `FileOp`.
- `lib/wiki-mutate.ts` — moteur déterministe de mutation (décisions candidates +
  suppression de ressource/entité) : fonctions pures renvoyant des `FileOp`, appliquées
  par `applyFileOps`.
- `lib/claude.ts` — client Anthropic (`@anthropic-ai/sdk`, auth `x-api-key`) partagé par
  le chat **et** l'ingestion ; cible reconstruite à chaud depuis `lib/ai-settings.ts`.
- `lib/ai-settings.ts` — store de réglages IA `<DATA_ROOT>/.data/ai-settings.json`
  (`{ apiKey, baseUrl, model }`, **clé en clair**) ; le store prime sur l'env, relu à chaud
  à chaque appel ; `getSafeAiSettings` ne renvoie jamais la clé.
- `lib/conversations-store.ts` — historique de chat **local** : un fichier JSON par
  conversation sous `<DATA_ROOT>/.data/conversations/<id>.json`.
- **État client** (singletons module-level, survivent à la navigation SPA) :
  `lib/chat-stream-store.ts` (streaming du chat + effet machine à écrire),
  `lib/ingest-view-store.ts` (progression d'ingestion, polling `ingest-status`),
  `lib/sources-nav-store.ts`, `lib/active-conversation.ts`, `lib/use-persistent-state.ts`,
  `lib/use-scroll-restoration.ts`. `lib/upload-drafts.ts` + `lib/ui.ts` = helpers purs.

### Routes API

| Route | Rôle |
|-------|------|
| `POST /api/chat` | agent wiki (navigation markdown) → Claude → texte + sources → historique local |
| `GET /api/sources`, `GET /api/sources/[id]` | liste filtrable (type / auteur / date / origine) + détail |
| `DELETE /api/sources/[slug]` | suppression déterministe d'une ressource (wiki-mutate → écriture locale) |
| `DELETE /api/entities/[slug]` | suppression déterministe d'une entité (geste explicite, jamais en cascade) |
| `GET /api/wiki`, `GET /api/themes` | liste des thèmes (lus depuis `themes/`) |
| `GET /api/explore` | auteurs / dates / types avec compteurs |
| `GET /api/graph` | graphe (`graph.json`) |
| `GET /api/entities`, `GET /api/candidates`, `POST /api/candidates/resolve` | entités + arbitrage des candidates |
| `GET /api/theme-candidates`, `POST /api/theme-candidates/resolve` | thèmes candidats + arbitrage |
| `POST /api/upload` | écrit le fichier + sidecar `.meta.md` dans `raw/` (disque local) puis déclenche l'ingestion |
| `POST /api/ingest` | relance manuelle de l'ingestion locale |
| `GET /api/ingest-status` | statut d'ingestion d'un fichier (manifeste / état local) |
| `GET/POST /api/settings`, `POST /api/settings/test` | réglages IA (clé jamais renvoyée ; test d'accès sans enregistrer) |
| `GET /api/raw/[...file]` | proxy des binaires de `raw/` (lecture disque local) |
| `GET/POST /api/conversations`, `GET /api/conversations/[id]` | historique de chat (fichiers JSON locaux) |

## Notes

- La **dictée vocale** (Web Speech API) nécessite HTTPS ou `localhost`.
- Toutes les écritures (upload, décisions candidates, suppression, ingestion) se font
  **sur le disque local** ; le markdown local est la seule source de vérité du contenu.
  L'ingestion écrit sous `wiki/` via le moteur déterministe (`lib/wiki-project.ts`) —
  l'IA ne produit que la page ressource ; les uploads écrivent sous `raw/`. Toute
  écriture passe par `applyFileOps` (chemins sous `wiki/`/`raw/` uniquement).
- **Pas d'authentification** : accès direct à l'app (le login par mot de passe partagé
  a été retiré). Voir [`../docs/platform.md`](../docs/platform.md).
