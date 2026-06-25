# Second Brain — AI Coding

Un **second brain collaboratif** sur l'**AI Coding** (développement assisté par IA), entretenu automatiquement par un agent Claude Code.

L'idée : chacun dépose ses trouvailles brutes (articles, notes, liens, réflexions) dans une inbox, et un agent se charge de les digérer en un wiki structuré et toujours à jour. **Personne n'organise le savoir à la main.**

## Structure du projet

```
.
├── raw/                    # Inbox : on y dépose les fichiers bruts
│   └── README.md
├── wiki/                   # Wiki structuré, maintenu par l'agent
│   └── index.md            # Index de toutes les pages
├── CLAUDE.md               # Instructions de l'agent mainteneur
├── .github/workflows/
│   └── update-wiki.yml     # GitHub Action nocturne
└── README.md               # Ce fichier
```

## Workflow

1. **Vous déposez** un fichier brut dans [`/raw`](raw/README.md) — note, article, lien annoté, transcription… Aucun tri ni renommage manuel.
2. **L'agent traite** les nouveaux fichiers (ceux sans `processed: true`) :
   - il en extrait les concepts clés ;
   - il met à jour ou crée les pages correspondantes dans [`/wiki`](wiki/index.md) ;
   - il n'efface jamais d'information existante, il **enrichit uniquement** ;
   - il marque chaque fichier traité avec `processed: true` ;
   - il tient l'[index](wiki/index.md) à jour.
3. **Automatisation** : la GitHub Action [`update-wiki.yml`](.github/workflows/update-wiki.yml) tourne **tous les soirs à 23h** (et peut être lancée à la main). Elle installe Claude Code, lui demande de traiter `/raw`, puis commit et push les mises à jour du wiki.

Le comportement précis de l'agent est défini dans [CLAUDE.md](CLAUDE.md).

## Thèmes de départ

- **Agentic Coding** — agents autonomes, boucles agentiques, orchestration.
- **FinOps IA** — coûts des modèles, optimisation des tokens, ROI.
- **Outils et Marché** — éditeurs, CLIs, acteurs du marché.
- **Transformation Organisationnelle** — adoption, montée en compétence, conduite du changement.
- **Sécurité et Risques** — risques du code généré, fuites de données, conformité.

## Mise en route

### Contribuer

Déposez un fichier dans `/raw` (idéalement avec l'URL et la date de la source), committez, et laissez l'agent faire le reste lors de son prochain passage.

### Configuration de l'automatisation

La GitHub Action nécessite un secret de dépôt :

- `ANTHROPIC_API_KEY` — votre clé API Anthropic (Settings → Secrets and variables → Actions).

Vous pouvez aussi déclencher le traitement manuellement depuis l'onglet **Actions** (workflow « update-wiki », bouton *Run workflow*).
