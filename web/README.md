# Second Brain — Front-end Next.js

Front-end du *second brain* AI Coding : chat IA branché sur le wiki, navigation par
thème / auteur / date / type / entité, dépôt de nouvelles sources et ingestion locale.
Empaqueté en **application de bureau Electron** (modèle local-first).

Le wiki est lu **et écrit directement sur le disque local** (sous `DATA_ROOT`,
aucune base intermédiaire, aucune API distante). L'accès au modèle passe par la
**gateway LiteLLM de l'entreprise** (compatible API Anthropic). Voir
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
démarrer et lire le wiki. Dans l'app Electron, ces valeurs sont fournies par l'écran
de réglages (clé chiffrée via `safeStorage`) et injectées à l'exécution ; le fichier
ne sert qu'au dev.

- `ANTHROPIC_API_KEY` — clé de la gateway LiteLLM (chat + ingestion). Vide = chat
  et ingestion désactivés (le reste fonctionne).
- `ANTHROPIC_BASE_URL` — URL de la gateway (ex. `https://llm-gateway.m33.tech`).
- `ANTHROPIC_MODEL` — modèle routé par la gateway (défaut `claude-sonnet-4-6`).
- `DATA_ROOT` / `WIKI_ROOT` / `RAW_ROOT` — emplacement des données (optionnel ;
  défaut dev : racine du dépôt, un cran au-dessus de `/web`).
- `REFERENCE_DOCS_ROOT` — racine des assets injectés à l'ingestion (prompt + `docs/` ;
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
- `lib/ingest-local.ts` — **ingestion locale** : agent embarqué (`@anthropic-ai/claude-agent-sdk`),
  `detectPending`, verrou anti-double-run, garde-fou d'écriture `wiki/` (`canUseTool`),
  état `ingest-state.json`, filet `wiki:verify`, `runIngestion`.
- `lib/wiki-mutate.ts` — moteur déterministe de mutation (décisions candidates +
  suppression) : fonctions pures renvoyant des `FileOp`, appliquées par `applyFileOps`.
- `lib/claude.ts` — client Anthropic (`@anthropic-ai/sdk`) pointé sur la gateway LiteLLM (chat).
- `lib/conversations-store.ts` — historique de chat **local** : un fichier JSON par
  conversation sous `<DATA_ROOT>/.data/conversations/<id>.json`.

### Routes API

| Route | Rôle |
|-------|------|
| `POST /api/chat` | agent wiki (navigation markdown) → Claude → texte + sources → historique local |
| `GET /api/sources`, `GET /api/sources/[id]` | liste filtrable (type / auteur / date / `needs_review`) + détail |
| `DELETE /api/sources/[slug]` | suppression déterministe (wiki-mutate → écriture locale) |
| `GET /api/wiki`, `GET /api/themes` | liste des thèmes (lus depuis `themes/`) |
| `GET /api/explore` | auteurs / dates / types avec compteurs |
| `GET /api/graph` | graphe (`graph.json`) |
| `GET /api/entities`, `GET /api/candidates`, `POST /api/candidates/resolve` | entités + arbitrage des candidates |
| `GET /api/theme-candidates`, `POST /api/theme-candidates/resolve` | thèmes candidats + arbitrage |
| `POST /api/upload` | écrit le fichier + sidecar `.meta.md` dans `raw/` (disque local) puis déclenche l'ingestion |
| `POST /api/ingest` | relance manuelle de l'ingestion locale |
| `GET /api/ingest-status` | statut d'ingestion d'un fichier (manifeste / état local) |
| `GET /api/raw/[...file]` | proxy des binaires de `raw/` (lecture disque local) |
| `GET/POST /api/conversations`, `GET /api/conversations/[id]` | historique de chat (fichiers JSON locaux) |

## Notes

- La **dictée vocale** (Web Speech API) nécessite HTTPS ou `localhost`.
- Toutes les écritures (upload, décisions candidates, suppression, ingestion) se font
  **sur le disque local** ; le markdown local est la seule source de vérité du contenu.
  L'agent d'ingestion (`lib/ingest-local.ts`) n'écrit que sous `wiki/` (garde-fou
  déterministe) ; les uploads écrivent sous `raw/`.
- **Pas d'authentification** : accès direct à l'app (le login par mot de passe partagé
  a été retiré). Voir [`../docs/platform.md`](../docs/platform.md).
