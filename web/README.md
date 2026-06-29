# Second Brain — Front-end Next.js

Front-end du *second brain* AI Coding : chat IA branché sur le wiki, navigation par
thème / auteur / date / type, et dépôt de nouvelles sources.

Le wiki est lu **directement sur le système de fichiers local** (`../wiki`) et les uploads sont
écrits dans `../raw`. Pas de Google Drive. Le proxy LLM est **LiteLLM** (compatible API Anthropic).

## Prérequis

- Node.js 18+
- Une clé LiteLLM + l'URL du proxy
- (Optionnel) un projet Supabase pour persister l'historique du chat

## Installation

```bash
cd web
npm install
cp .env.local.example .env.local   # puis renseigner les valeurs
npm run dev                          # http://localhost:3000
```

## Variables d'environnement (`.env.local`)

| Variable | Rôle |
|----------|------|
| `ANTHROPIC_API_KEY` | Clé LiteLLM |
| `ANTHROPIC_BASE_URL` | URL du proxy LiteLLM (passée en `baseURL` au SDK Anthropic) |
| `ANTHROPIC_MODEL` | Nom du modèle exposé par le proxy (défaut `claude-sonnet-4-6`) |
| `NEXT_PUBLIC_SUPABASE_URL` | (optionnel) URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (optionnel) clé anon Supabase |
| `WIKI_ROOT` / `RAW_ROOT` | (optionnel) chemins absolus si l'app n'est pas dans `/web` |

Sans Supabase, le chat fonctionne mais ne **persiste pas** l'historique (mode dégradé).

## Schéma Supabase (optionnel)

À exécuter dans l'éditeur SQL Supabase :

```sql
create table conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Nouvelle discussion',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb default '[]',
  created_at timestamptz default now()
);
```

## Architecture

- `lib/wiki-fs.ts` — accès disque au wiki (`../wiki`) et au dossier `../raw` (avec garde anti
  path-traversal).
- `lib/wiki-parser.ts` — parse le frontmatter YAML (`gray-matter`) → `Source` ; titre = 1er `# H1`.
  Expose `listAllSources`, `listTopics`, `listAuthors`, `listDates`.
- `lib/chat-context.ts` — `getRelevantWikiFiles` (détection auteur/type/thème + fallback index) et
  `parseResponse` (extrait le bloc `SOURCES: [...]` et le retire du texte).
- `lib/claude.ts` — client Anthropic pointé sur le proxy LiteLLM via `baseURL`.
- `lib/supabase.ts` — persistance optionnelle, à dégradation gracieuse.

### Routes API

| Route | Rôle |
|-------|------|
| `POST /api/chat` | wiki pertinent → Claude (LiteLLM) → texte + sources → Supabase |
| `GET /api/sources` | liste filtrable (type / auteur / date / `needs_review`) + compteurs |
| `GET/POST /api/wiki` | liste des thèmes / création d'une ébauche de thème |
| `GET /api/explore` | auteurs + dates avec compteurs |
| `POST /api/upload` | écrit dans `../raw` (+ sidecar `.meta.md` pour PDF/PPTX, frontmatter pour `.md`) |
| `GET/POST /api/conversations`, `GET /api/conversations/[id]` | historique (Supabase) |

## Notes

- La **dictée vocale** (Web Speech API) nécessite HTTPS ou `localhost`.
- L'app **écrit dans le dépôt versionné** (`../raw`, et `../wiki/by-topic` pour les ébauches de
  thème). En production, l'enrichissement du wiki reste le rôle de l'agent mainteneur (`/process-raw`).
- Source locale = OK en dev. Un déploiement géré (Vercel) sans accès disque nécessiterait une autre
  source (Git API / Drive) — hors périmètre actuel.
