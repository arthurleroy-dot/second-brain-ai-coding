# Second Brain — AI Coding

Un **second brain** sur l'**AI Coding** (développement assisté par IA), entretenu
automatiquement par un agent IA embarqué. **Application de bureau locale (Electron)** :
chaque personne installe l'app et dispose de sa propre instance et de son propre
wiki, entièrement **en local** sur sa machine.

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
│   ├── entities/           # Couche 3 — registre des liens (outils, clients…) + _candidates.json
│   ├── by-date/            # Couche 3 — vue dérivée : index temporel (YYYY/YYYY-MM)
│   ├── graph.json          # Export machine-readable (nodes + edges)
│   ├── index.md            # Catalogue général (thèmes, auteurs, ressources)
│   ├── types.md            # Index par type de source
│   ├── origin/             # Vue dérivée : une page par origine (interne.md, externe.md)
│   ├── _ingested.json      # Manifeste : quels fichiers /raw ont déjà été ingérés
│   └── log.md              # Journal des runs
├── web/                    # Interface web Next.js (chat, navigation, upload)
│   ├── app/                # App Router (pages + API routes)
│   ├── components/         # Composants React
│   └── lib/                # Logique métier (wiki parser, écriture locale, ingestion locale, chat…)
├── docs/                   # Spécifications détaillées (lues à la demande par l'agent)
├── tasks/                  # todo.md (plan courant) + lessons.md
├── CLAUDE.md               # Carte du projet + règles cardinales (renvoie vers docs/)
└── README.md               # Ce fichier
```

**Architecture en 3 couches :** `raw/` (immuable) → `wiki/resources/` (contenu intégral, canonique) → tout le reste (vues dérivées générées depuis les ressources). Le contenu n'est jamais dupliqué : `themes/` et `authors/` ne font que pointer vers les sections de `resources/`.

## Workflow

1. **Vous déposez** un fichier brut dans [`/raw`](raw/README.md) — depuis l'interface de l'app (qui l'écrit sur votre disque local), ou en copiant le fichier à la main. Aucun tri ni renommage manuel. `/raw` est **immuable** : on n'y modifie jamais rien ensuite.
2. **L'agent traite** les nouveaux fichiers (ceux absents de [`wiki/_ingested.json`](wiki/_ingested.json)) :
   - il extrait les **métadonnées** (le sidecar `.meta.md` saisi à l'upload prime, sinon inférence) et le contenu ;
   - il crée une **fiche ressource complète** dans [`wiki/resources/`](wiki/resources/) avec le contenu intégral annoté par chunk (`topics:` et `entities:` sur chaque section) ;
   - il met à jour les **vues dérivées** : [`themes/`](wiki/themes/), [`authors/`](wiki/authors/), [`entities/`](wiki/entities/), [`by-date/`](wiki/by-date/), `types.md`, [`origin/`](wiki/origin/) ;
   - il met à jour [`graph.json`](wiki/graph.json) (nodes + edges, dont les entités) ;
   - il enregistre le fichier comme traité dans `wiki/_ingested.json` (il **ne modifie jamais** `/raw`) ;
   - il tient l'[index](wiki/index.md) et le [journal](wiki/log.md) à jour.
3. **Automatisation** : l'ingestion est **locale et embarquée** (`web/lib/ingest-local.ts`, agent via `@anthropic-ai/claude-agent-sdk`). Elle se déclenche **automatiquement en fin d'upload** (en arrière-plan) et peut être **relancée à la main** (`POST /api/ingest`). Un verrou sérialise les runs ; un garde-fou déterministe restreint l'écriture de l'agent au seul dossier `wiki/`. Un fichier déposé à la main dans `raw/` est rattrapé au prochain déclenchement (détection idempotente via `wiki/_ingested.json`).

Le comportement de l'agent est défini dans [CLAUDE.md](CLAUDE.md) (carte) et [`docs/`](docs/) (spécifications), **injectés dans le prompt d'ingestion**. Le markdown local est la **seule source de vérité du wiki** ; l'historique du chat est stocké en fichiers JSON locaux.

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

Un bouton d'upload permet de déposer un fichier directement depuis l'interface : la plateforme **écrit le fichier dans `/raw`** sur le disque local avec un sidecar `.meta.md` (titre, type, auteur, date, url, entités). L'écriture déclenche l'ingestion en arrière-plan. La vue d'upload affiche l'avancement (« en attente → en cours → ingéré »).

La plateforme lit **et écrit** le wiki **directement sur le disque local** (aucune base intermédiaire, aucune API distante). Les PDF sont servis par un proxy (`/api/raw/...`) depuis le disque local.

**Variables d'environnement** (`web/.env.local`, voir [`.env.local.example`](web/.env.local.example)). Aucune n'est obligatoire pour démarrer et lire le wiki ; dans l'app Electron, elles viennent de l'écran de réglages (clé chiffrée) :

```env
# Accès IA (chat + ingestion) via la gateway LiteLLM de l'entreprise
ANTHROPIC_API_KEY=          # clé de la gateway (partagée) — vide = chat/ingestion off
ANTHROPIC_BASE_URL=https://llm-gateway.m33.tech
ANTHROPIC_MODEL=claude-sonnet-4-6

# Emplacement des données (optionnel — défaut dev : racine du dépôt)
# DATA_ROOT=/chemin/absolu/vers/les/donnees
# WIKI_ROOT=/chemin/absolu/vers/wiki
# RAW_ROOT=/chemin/absolu/vers/raw
```

```bash
cd web && npm install && npm run dev   # http://localhost:3000
```

## Mise en route

### Contribuer

Déposez une source depuis l'interface (bouton d'upload), ou copiez un fichier dans `/raw` à la main. L'agent d'ingestion local fait le reste (automatiquement après un upload, ou via la relance manuelle).

### Application de bureau (Electron)

L'app est distribuée en application de bureau : chaque utilisateur installe sa propre instance et dispose de son wiki en local (sous `DATA_ROOT`, le dossier de données utilisateur). GitHub ne sert plus qu'à **distribuer les mises à jour** de l'app (auto-updater Electron) — plus aucun commit de contenu, plus de déploiement serveur.

Détails d'architecture : [`docs/platform.md`](docs/platform.md).
