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
│   ├── by-date/            # Couche 3 — vue dérivée : index temporel (YYYY/YYYY-MM)
│   ├── graph.json          # Export machine-readable (nodes + edges)
│   ├── index.md            # Catalogue général (thèmes, auteurs, ressources)
│   ├── types.md            # Index par type de source
│   ├── origin.md           # Index par origine (interne/externe)
│   └── log.md              # Journal des runs
├── web/                    # Interface web Next.js (chat, navigation, upload)
│   ├── app/                # App Router (pages + API routes)
│   ├── components/         # Composants React
│   └── lib/                # Logique métier (wiki parser, LLM client, Supabase…)
├── CLAUDE.md               # Instructions de l'agent mainteneur
└── README.md               # Ce fichier
```

**Architecture en 3 couches :** `raw/` (immuable) → `wiki/resources/` (contenu intégral, canonique) → tout le reste (vues dérivées générées depuis les ressources). Le contenu n'est jamais dupliqué : `themes/` et `authors/` ne font que pointer vers les sections de `resources/`.

## Workflow

1. **Vous déposez** un fichier brut dans [`/raw`](raw/README.md) — note, article, lien annoté, transcription… Aucun tri ni renommage manuel. Idéalement, renseignez l'**URL** et la **date** de la source.
2. **L'agent traite** les nouveaux fichiers (texte sans `processed: true`, ou binaire sans sidecar `.meta.md` traité) :
   - il extrait les **métadonnées** (type, auteur, date, url, topics) et les concepts clés ;
   - il crée une **fiche ressource complète** dans [`wiki/resources/`](wiki/resources/) avec le contenu intégral annoté par chunk (`topics:` sur chaque section) ;
   - il met à jour les **vues dérivées** : [`themes/`](wiki/themes/), [`authors/`](wiki/authors/), [`by-date/`](wiki/by-date/), `types.md`, `origin.md` ;
   - il met à jour [`graph.json`](wiki/graph.json) (nodes + edges) ;
   - il n'efface jamais de contenu existant, il **enrichit uniquement** ;
   - il marque chaque fichier traité (`processed: true` dans le frontmatter ou le sidecar) ;
   - il tient l'[index](wiki/index.md) et le [journal](wiki/log.md) à jour.
3. **Automatisation** : la GitHub Action [`update-wiki.yml`](.github/workflows/update-wiki.yml) tourne **tous les soirs à 23h** (et peut être lancée à la main). Elle installe Claude Code, lui demande de traiter `/raw`, puis commit et push les mises à jour du wiki.

Le comportement précis de l'agent est défini dans [CLAUDE.md](CLAUDE.md).

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

Un bouton d'upload permet de déposer un fichier directement depuis l'interface (écrit dans `/raw` ; traitement déclenché à la demande ou lors du prochain run nocturne).

**Variables d'environnement** (`web/.env.local`) :

```env
ANTHROPIC_API_KEY=sk-ant-...          # obligatoire
ANTHROPIC_BASE_URL=https://...        # optionnel — proxy LiteLLM
NEXT_PUBLIC_SUPABASE_URL=https://...  # optionnel — historique des chats
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # optionnel
```

```bash
cd web && npm install && npm run dev   # http://localhost:3000
```

## Mise en route

### Contribuer

Déposez un fichier dans `/raw` (idéalement avec l'URL et la date de la source), committez, et laissez l'agent faire le reste lors de son prochain passage.

### Configuration de l'automatisation

La GitHub Action nécessite un secret de dépôt :

- `ANTHROPIC_API_KEY` — votre clé API Anthropic (Settings → Secrets and variables → Actions).

Vous pouvez aussi déclencher le traitement manuellement depuis l'onglet **Actions** (workflow « update-wiki », bouton *Run workflow*).
