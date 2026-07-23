# Second Brain — AI Coding

Un **second brain** sur l'**AI Coding** (développement assisté par IA), entretenu
automatiquement par une IA embarquée. **Application de bureau locale (Electron)** :
chaque personne installe l'app et dispose de sa propre instance et de son propre wiki,
entièrement **en local** sur sa machine.

L'idée : chacun dépose ses trouvailles brutes (articles, notes, liens, réflexions) dans
une inbox, et l'app les digère en un wiki structuré et toujours à jour. **Personne
n'organise le savoir à la main.**

## Architecture en 3 couches

```
raw/     ← Couche 1 : sources brutes IMMUABLES (fichier de contenu + sidecar .meta.md)
wiki/    ← Couche 2 : resources/ (CANONIQUE — 1 fiche intégrale par source)
         ← Couche 3 : vues dérivées (themes/, authors/, entities/, by-date/, origin/,
                       types.md, index.md, graph.json) — jamais de contenu original
```

`raw/` (immuable) → `wiki/resources/` (contenu intégral, canonique) → tout le reste
(vues dérivées reconstruites depuis les ressources). Le contenu n'est jamais dupliqué :
`themes/`, `authors/`, `entities/`… ne font que **pointer** vers les sections de
`resources/`.

## Structure du projet

```
.
├── raw/          # Couche 1 : sources immuables (+ sidecar .meta.md déposé à l'upload)
├── wiki/         # Couches 2 & 3 : wiki structuré (seule zone d'écriture de l'ingestion)
│   ├── resources/  # CANONIQUE : 1 fiche complète par source, annotée par section
│   ├── themes/     # vue dérivée : liens vers les sections, par thème (+ _candidates.json)
│   ├── authors/    # vue dérivée : table des ressources par auteur
│   ├── entities/   # registre des liens (outils, clients…) + _candidates.json
│   ├── by-date/    # vue dérivée : index temporel (YYYY / YYYY-MM)
│   ├── origin/     # vue dérivée : interne.md / externe.md
│   ├── graph.json  # export machine-readable (nodes + edges)
│   └── index.md · types.md · _ingested.json · log.md
├── web/          # Plateforme Next.js (chat, navigation, upload, ingestion locale)
├── electron/     # Coquille de bureau (amorçage, serveur embarqué, fenêtre)
├── docs/         # Spécifications détaillées (lues à la demande)
├── prompts/      # Prompt système d'ingestion
├── tasks/        # todo.md + lessons.md + specs/
└── CLAUDE.md     # Carte du projet + règles cardinales
```

## Le workflow, de bout en bout

### 1. Déposer une source
Depuis l'app (écran **Upload**) : glissez un fichier (`.md`/`.txt`/`.pdf`/`.pptx`/`.docx`)
ou collez du texte, et renseignez ce que vous savez — titre, type, auteur, date, URL,
**thèmes** et **entités typées** (outil, client…) à relier, avec leur granularité
(ressource entière ou sections précises). L'app écrit le fichier **sur votre disque
local** dans `raw/`, accompagné d'un sidecar `.meta.md` (vos métadonnées, qui **font
autorité**). `raw/` reste ensuite immuable. (Dépôt à la main possible : copiez le fichier
dans `raw/`.)

### 2. L'ingestion « IA + déterministe » (automatique)
En fin d'upload, l'ingestion se déclenche **en arrière-plan** (ou à la demande) :

- **Un seul appel IA** transforme la source en **fiche ressource** intégrale et fidèle
  (`wiki/resources/<slug>.md`), découpée en sections et annotée (quel passage parle de
  quel thème / quelle entité). Les PDF sont lus **en local** (aucun binaire envoyé au modèle).
- Un **moteur déterministe** reconstruit ensuite tout le reste — thèmes, auteurs, entités,
  dates, origine, index et le **graphe** — sans autre appel IA. Les nouveautés repérées
  mais non déclarées deviennent des **candidates** à arbitrer (jamais créées en douce).

Coût : **~0,12 $/ressource** (contre ~6,64 $ avant refonte). L'écran d'upload affiche
l'avancement (« en attente → en cours → ingéré ») et le coût. Détail :
[`docs/ingestion.md`](docs/ingestion.md).

### 3. Explorer et interroger le wiki
L'app Next.js (`web/`) offre plusieurs écrans :

| Écran | Route | Ce qu'on y fait |
|-------|-------|-----------------|
| **Chat** | `/chat` | Poser des questions ; une IA **navigue elle-même** le wiki et répond en **citant ses sources en direct** (streaming, bouton Stop, filtres type/auteur/date/origine). Historique de conversations **local**. |
| **Wiki** | `/wiki` | Grille des thèmes → détail d'un thème et des sections qui le couvrent. |
| **Sources** | `/sources` | Liste filtrable (type, auteur, date, origine) → **fiche complète** (contenu intégral, PDF visualisable, suppression). |
| **Explorer** | `/explore` | Navigation par **auteur** et par **date**, avec compteurs. |
| **Entities** | `/entities` | Registre des entités (outils, clients…) + **arbitrage des candidates** (fusionner / créer / rejeter) + suppression. |
| **Themes** | `/themes` | Thèmes du wiki + **arbitrage des thèmes candidats**. |
| **Graph** | `/graph` | Le **graphe** de connaissances (ressources, thèmes, entités, auteurs, dates et leurs relations). |
| **Réglages** | `/reglages` | Configurer l'**accès IA** (clé, adresse, modèle) : Anthropic en direct ou une passerelle compatible ; test d'accès sans enregistrer. |

### 4. Corriger / supprimer
Les **arbitrages** de candidates et la **suppression** d'une ressource (ou d'une entité)
sont **100 % déterministes** (zéro IA) et appliqués immédiatement sur le disque local.
Supprimer une ressource retire, dans le même lot : sa fiche, toutes ses références dans
les vues dérivées, ses nœuds/arêtes du graphe, l'entrée manifeste **et** son fichier brut
dans `raw/` (sinon il serait ré-ingéré).

> **Qui fait de l'IA, qui n'en fait pas.** L'IA n'intervient qu'à deux endroits : la
> **rédaction** d'une fiche à l'ingestion (1 appel), et le **chat** (qui *lit* le wiki,
> n'écrit jamais). Tout le reste — vues dérivées, graphe, arbitrages, suppression — est
> du code déterministe.

## Thèmes de départ

- **Agentic Coding** — agents autonomes, boucles agentiques, orchestration.
- **FinOps IA** — coûts des modèles, optimisation des tokens, ROI.
- **Outils et Marché** — éditeurs, CLIs, acteurs du marché.
- **Transformation Organisationnelle** — adoption, montée en compétence, conduite du changement.
- **Sécurité et Risques** — risques du code généré, fuites de données, conformité.
- **Context Engineering** — gestion du contexte LLM, prompts systèmes, mémoire, RAG.

## Application de bureau (Electron)

L'app est distribuée en application de bureau **local-first** : chaque utilisateur installe
sa propre instance et dispose de son wiki en local (sous `DATA_ROOT`, le dossier de données
utilisateur). Au 1er lancement, un **seed** amorce le wiki de départ (copié seulement s'il
est absent — vos données ne sont jamais écrasées par une mise à jour du code).

- **Build** : `npm run dist` (electron-builder) → `.dmg` (macOS) et `.exe` (Windows).
- **Accès IA** : saisi dans l'écran **Réglages**, stocké **en clair** dans
  `<DATA_ROOT>/.data/ai-settings.json` (app mono-utilisateur en local).
- **Mises à jour** : téléchargement manuel du binaire (**pas d'auto-updater en v1**).
  GitHub ne sert qu'à distribuer les binaires — plus aucun commit de contenu, plus de
  serveur, plus de Supabase / Vercel / GitHub Action.

Détails d'architecture : [`docs/platform.md`](docs/platform.md).

## Démarrer en dev

```bash
cd web && npm install && npm run dev   # http://localhost:3000
```

Aucune clé n'est requise pour **lire** le wiki ; renseignez l'accès IA dans **Réglages**
(ou `web/.env.local`, voir [`.env.local.example`](web/.env.local.example)) pour activer le
chat et l'ingestion. Pour lancer l'app de bureau complète : `npm run app` (build + Electron)
à la racine.

## Pour aller plus loin

| Sujet | Doc |
|-------|-----|
| Pipeline d'ingestion | [`docs/ingestion.md`](docs/ingestion.md) |
| Formats du wiki (ressources, vues, graphe) | [`docs/wiki-spec.md`](docs/wiki-spec.md) |
| Entités, thèmes, candidates, suppression | [`docs/entities.md`](docs/entities.md) |
| Architecture de la plateforme | [`docs/platform.md`](docs/platform.md) |
| Règles de travail sur le code | [`docs/code-workflow.md`](docs/code-workflow.md) |
