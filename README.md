# Second Brain — AI Coding

Un **second brain collaboratif** sur l'**AI Coding** (développement assisté par IA), entretenu automatiquement par un agent Claude Code.

L'idée : chacun dépose ses trouvailles brutes (articles, notes, liens, réflexions) dans une inbox, et un agent se charge de les digérer en un wiki structuré et toujours à jour. **Personne n'organise le savoir à la main.**

## Structure du projet

```
.
├── raw/                    # Couche 1 : sources immuables (texte + frontmatter, ou PDF + sidecar .meta.md)
│   └── README.md
├── wiki/                   # Couche 2 & 3 : wiki structuré, maintenu par l'agent
│   ├── resources/          # Couche 2 — CANONIQUE : 1 fiche complète par source brute
│   ├── themes/             # Couche 3 — vue dérivée : liens vers chunks par thème
│   ├── authors/            # Couche 3 — vue dérivée : table des ressources par auteur
│   ├── entities/           # Couche 3 — registre des liens (outils, clients…) + _candidates.md
│   ├── by-date/            # Couche 3 — vue dérivée : index temporel (YYYY/YYYY-MM)
│   ├── graph.json          # Export machine-readable (nodes + edges)
│   ├── index.md            # Catalogue général (thèmes, auteurs, ressources)
│   ├── types.md            # Index par type de source
│   ├── origin.md           # Index par origine (interne/externe)
│   ├── _ingested.json      # Manifeste : quels fichiers /raw ont déjà été ingérés
│   └── log.md              # Journal des runs
├── web/                    # Interface web Next.js (chat, navigation, upload)
│   ├── app/                # App Router (pages + API routes)
│   ├── components/         # Composants React
│   └── lib/                # Logique métier (wiki parser, LLM client, GitHub, Supabase…)
├── docs/                   # Spécifications détaillées (lues à la demande par l'agent)
├── tasks/                  # todo.md (plan courant) + lessons.md
├── CLAUDE.md               # Carte du projet + règles cardinales (renvoie vers docs/)
└── README.md               # Ce fichier
```

**Architecture en 3 couches :** `raw/` (immuable) → `wiki/resources/` (contenu intégral, canonique) → tout le reste (vues dérivées générées depuis les ressources). Le contenu n'est jamais dupliqué : `themes/` et `authors/` ne font que pointer vers les sections de `resources/`.

## Workflow

1. **Vous déposez** un fichier brut dans [`/raw`](raw/README.md) — depuis l'interface web (qui le committe pour vous), ou directement en git. Aucun tri ni renommage manuel. `/raw` est **immuable** : on n'y modifie jamais rien ensuite.
2. **L'agent traite** les nouveaux fichiers (ceux absents de [`wiki/_ingested.json`](wiki/_ingested.json)) :
   - il extrait les **métadonnées** (le sidecar `.meta.md` saisi à l'upload prime, sinon inférence) et le contenu ;
   - il crée une **fiche ressource complète** dans [`wiki/resources/`](wiki/resources/) avec le contenu intégral annoté par chunk (`topics:` et `entities:` sur chaque section) ;
   - il met à jour les **vues dérivées** : [`themes/`](wiki/themes/), [`authors/`](wiki/authors/), [`entities/`](wiki/entities/), [`by-date/`](wiki/by-date/), `types.md`, `origin.md` ;
   - il met à jour [`graph.json`](wiki/graph.json) (nodes + edges, dont les entités) ;
   - il enregistre le fichier comme traité dans `wiki/_ingested.json` (il **ne modifie jamais** `/raw`) ;
   - il tient l'[index](wiki/index.md) et le [journal](wiki/log.md) à jour.
3. **Automatisation** : la GitHub Action [`ingest.yml`](.github/workflows/ingest.yml) se déclenche **à chaque commit dans `raw/**`** (donc à chaque upload), plus un **cron nocturne** (23h) qui rattrape les dépôts manuels et les runs échoués. Elle lance un agent Claude Code qui n'écrit que dans `wiki/`, puis commit et push.

Le comportement de l'agent est défini dans [CLAUDE.md](CLAUDE.md) (carte) et [`docs/`](docs/) (spécifications). Git est la **seule source de vérité du wiki** — Supabase ne stocke que l'historique du chat.

## Thèmes de départ

- **Agentic Coding** — agents autonomes, boucles agentiques, orchestration.
- **FinOps IA** — coûts des modèles, optimisation des tokens, ROI.
- **Outils et Marché** — éditeurs, CLIs, acteurs du marché.
- **Transformation Organisationnelle** — adoption, montée en compétence, conduite du changement.
- **Sécurité et Risques** — risques du code généré, fuites de données, conformité.
- **Context Engineering** — gestion du contexte LLM, prompts systèmes, mémoire, RAG.

## Interface web

L'application Next.js dans `web/` offre quatre vues :

| Vue | Route | Description |
|-----|-------|-------------|
| Chat | `/chat` | Conversations avec le wiki via LLM ; sources citées en temps réel |
| Wiki | `/wiki` | Grille des thèmes ; détail d'un thème + sources associées |
| Sources | `/sources` | Liste filtrée (type, auteur, date, `needs_review`) + vue complète |
| Explorer | `/explore` | Navigation par auteur et par date avec compteurs |

Un bouton d'upload permet de déposer un fichier directement depuis l'interface : la plateforme **committe le fichier dans `/raw`** (via l'API GitHub) avec un sidecar `.meta.md` (titre, type, auteur, date, url, entités). Ce commit déclenche l'ingestion. La modale affiche l'avancement (« en attente → en cours → ingéré »).

La plateforme lit le wiki **directement depuis les fichiers markdown** (aucune base intermédiaire). Les PDF sont servis par un proxy (`/api/raw/...`) depuis git.

**Variables d'environnement** (`web/.env.local`, voir [`.env.local.example`](web/.env.local.example)) :

```env
ANTHROPIC_API_KEY=          # chat (clé LiteLLM ou Anthropic)
ANTHROPIC_BASE_URL=         # proxy LiteLLM (optionnel)
NEXT_PUBLIC_SUPABASE_URL=   # historique du chat (conversations/messages)
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GITHUB_TOKEN=               # PAT fine-grained (Contents R/W) — upload + proxy PDF
GITHUB_REPO=owner/repo
SITE_PASSWORD=              # protection d'accès (vide en local = ouvert)
SITE_SECRET=                # clé de signature du cookie
```

```bash
cd web && npm install && npm run dev   # http://localhost:3000
```

## Mise en route

### Contribuer

Déposez une source depuis l'interface web (bouton d'upload), ou committez un fichier dans `/raw` en git. L'agent fait le reste au prochain passage de l'Action.

### Automatisation (GitHub Actions)

Secrets à configurer (Settings → Secrets and variables → Actions) :

- `ANTHROPIC_API_KEY` — clé pour l'agent d'ingestion.
- `ANTHROPIC_BASE_URL` *(optionnel)* — si l'agent passe par un proxy LiteLLM.

L'Action [`ingest.yml`](.github/workflows/ingest.yml) tourne à chaque commit dans `raw/**`, au cron de 23h, et à la demande (onglet **Actions** → *Run workflow*).

### Déploiement (Vercel)

- **Root Directory** : `web`. Activer **« Include files outside root directory »** (nécessaire pour lire `../wiki`).
- Renseigner les variables d'environnement ci-dessus dans le projet Vercel.
- Chaque commit du wiki (par l'agent) redéploie automatiquement → contenu frais.

Détails d'architecture : [`docs/platform.md`](docs/platform.md).
