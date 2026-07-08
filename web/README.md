# Second Brain — Front-end Next.js

Front-end du *second brain* AI Coding : chat IA branché sur le wiki, navigation par
thème / auteur / date / type / entité, et dépôt de nouvelles sources.

Le wiki est lu **directement depuis les fichiers markdown** (`../wiki`, aucune base
intermédiaire). Les uploads sont **committés dans `../raw` via l'API GitHub** (le
filesystem de prod est read-only). Le proxy LLM est **LiteLLM** (compatible API
Anthropic). Voir [`../docs/platform.md`](../docs/platform.md) pour l'architecture.

## Prérequis

- Node.js 18+
- Une clé LiteLLM (ou Anthropic) + l'URL du proxy
- Un PAT GitHub fine-grained (Contents R/W) pour l'upload et le proxy des binaires
- (Optionnel) un projet Supabase pour persister l'historique du chat

## Installation

```bash
cd web
npm install
cp .env.local.example .env.local   # puis renseigner les valeurs
npm run dev                          # http://localhost:3000
```

## Variables d'environnement (`.env.local`)

Voir [`.env.local.example`](.env.local.example). En résumé : LLM
(`ANTHROPIC_*`), Supabase (chat uniquement), GitHub (`GITHUB_TOKEN`, `GITHUB_REPO`),
protection d'accès (`SITE_PASSWORD`, `SITE_SECRET`), et overrides optionnels
`WIKI_ROOT` / `RAW_ROOT`.

Sans Supabase, le chat fonctionne mais ne **persiste pas** l'historique (mode dégradé).
Sans `SITE_PASSWORD`, l'accès n'est pas protégé (pratique en local).

## Schéma Supabase

`supabase/schema.sql` (conversations + messages uniquement). Pour une base qui
contenait encore les anciennes tables wiki, exécuter d'abord
`supabase/migrations/2026-07-drop-wiki-tables.sql`.

## Architecture

- `lib/wiki-fs.ts` — accès disque au wiki (`../wiki`) et à `../raw` (garde anti path-traversal).
- `lib/wiki-parser.ts` — parse `resources/*.md` (frontmatter + chunks `topics:`/`entities:`) → `Source` ;
  expose `listAllSources`, `getResource`, `getSourceDetail`, `listTopics`, `listAuthors`,
  `listTypes`, `listDates`, `listEntities`.
- `lib/wiki-md.ts` — transforme les wikilinks Obsidian en liens plateforme, strip des annotations.
- `lib/wiki-query.ts` — façade de lecture (mêmes signatures) + helpers chat.
- `lib/chat-context.ts` — `getRelevantContext` : sélection du contexte depuis le markdown
  (filtres + détection auteurs/thèmes/entités, budget de caractères).
- `lib/github.ts` — API GitHub : commit atomique des uploads dans `raw/`, proxy des binaires,
  lecture du manifeste d'ingestion.
- `lib/claude.ts` — client Anthropic pointé sur le proxy LiteLLM.
- `lib/supabase.ts` — persistance du chat (conversations/messages), à dégradation gracieuse.
- `lib/auth.ts` + `middleware.ts` — protection par mot de passe partagé (cookie signé HMAC).

### Routes API

| Route | Rôle |
|-------|------|
| `POST /api/chat` | contexte wiki (markdown) → Claude → texte + sources → Supabase |
| `GET /api/sources` | liste filtrable (type / auteur / date / `needs_review`) + compteurs |
| `GET /api/wiki` | liste des thèmes (lus depuis `themes/`) |
| `GET /api/explore` | auteurs / dates / types avec compteurs |
| `POST /api/upload` | committe le fichier + sidecar `.meta.md` dans `raw/` (API GitHub) |
| `GET /api/ingest-status` | statut d'ingestion d'un fichier (manifeste / run actif) |
| `GET /api/raw/[...file]` | proxy des binaires de `raw/` (fs en dev, GitHub en prod) |
| `POST /api/auth` | vérifie le mot de passe partagé, pose le cookie de session |
| `GET/POST /api/conversations`, `GET /api/conversations/[id]` | historique (Supabase) |

## Notes

- La **dictée vocale** (Web Speech API) nécessite HTTPS ou `localhost`.
- L'app **n'écrit jamais dans le wiki** : elle committe dans `raw/`, et l'agent d'ingestion
  (GitHub Action) produit le wiki. Git est la seule source de vérité du contenu.
- Déploiement Vercel : Root Directory `web`, option « Include files outside root » activée
  (pour lire `../wiki`). Voir [`../docs/platform.md`](../docs/platform.md).
