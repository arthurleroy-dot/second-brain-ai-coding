# Journal des runs — Wiki AI Coding

Historique chronologique des traitements. Chaque entrée commence par `## [YYYY-MM-DD]`.

## [2026-06-25]

**Premier run** — traitement initial de tous les fichiers de `/raw`.

### Fichiers traités (7)
- `2026 Agentic Coding Trends Report.pdf` — Anthropic, 2026
- `rewiring-software-delivery-for-the-agentic-era.pdf` — McKinsey Technology, mai 2026
- `unlocking-the-value-of-ai-in-software-development.pdf` — McKinsey (TMT & QuantumBlack), nov. 2025
- `the-ai-revolution-in-software-development_final.pdf` — McKinsey (extrait *Rewired*), avr. 2026
- `2026 Software Industry Outlook | Deloitte Insights.pdf` — Deloitte Center for TMT, 12 fév. 2026
- `state-of-ai-2026.pdf` — Deloitte AI Institute (State of AI in the Enterprise), janv. 2026
- `new-accenture-research-finds-that-companies-with-ai-led-processes-outperform-peers.pdf` — Accenture, 10 oct. 2024 (PDF image → rendu en images puis lu)

> Note technique : les fichiers de `/raw` sont des PDF. Texte extrait via PyMuPDF ; le PDF Accenture (sans couche texte) a été rendu en images pour lecture.

### Pages créées (6)
- `agentic-coding.md` — **créée**
- `finops-ia.md` — **créée**
- `outils-et-marche.md` — **créée**
- `transformation-organisationnelle.md` — **créée**
- `securite-et-risques.md` — **créée**
- `context-engineering.md` — **créée** (nouveau sous-thème stable : specs, knowledge graphs, tâches agent-ready)

### Autres mises à jour
- `index.md` — mis à jour avec les 6 pages et leurs descriptions.
- Cross-références `[[...]]` ajoutées entre toutes les pages.

### Marquage « processed »
- Les sources étant des PDF binaires, `processed: true` ne peut pas être inséré en tête du fichier lui-même. Convention adoptée : un **fichier marqueur sidecar** `<nom>.pdf.processed` (contenant `processed: true`) est créé à côté de chaque PDF traité. Les runs futurs doivent ignorer tout PDF possédant son marqueur `.processed`.
- 7 marqueurs créés (un par PDF). Convention désormais documentée dans `CLAUDE.md` (workflow, étapes 1 et 5).

## [2026-06-25] — Enrichissement en profondeur

**Run d'enrichissement** (même jour) — les 6 pages, jugées trop succinctes (bullet points), ont été réécrites en **prose détaillée** à partir d'une relecture intégrale des sources, sans aucune suppression d'information (enrichissement uniquement).

### Pages enrichies (6)
- `agentic-coding.md` — **enrichie** (~4 700 mots) : 8 trends Anthropic détaillés, niveaux L1→L4, usine d'agents, toutes les études de cas chiffrées.
- `finops-ia.md` — **enrichie** (~2 500 mots) : token comme unité de coût, économie du dev, marges/pricing, mesure d'outcome.
- `outils-et-marche.md` — **enrichie** (~3 000 mots) : évolution des outils, Cursor en détail, M&A datée, prévisions de marché.
- `transformation-organisationnelle.md` — **enrichie** (~3 600 mots) : orchestrateur, sprint 24 h, redimensionnement, 2 bascules + 3 leviers, IBM, Accenture.
- `securite-et-risques.md` — **enrichie** (~2 100 mots) : dual-use, campagne IA-orchestrée, gouvernance des agents, risques chiffrés.
- `context-engineering.md` — **enrichie** (~2 100 mots) : spec-driven, tâches agent-ready, knowledge graphs, handoffs M2M.

### Méthode
- Chaque page traitée par un agent dédié relisant le texte intégral des sources concernées (extraction PyMuPDF / rendu image pour Accenture).
- Chaque concept développé en paragraphe avec chiffres exacts, entreprises nommées et citations attribuées ; sous-sections `###` ajoutées.
- Cross-références `[[...]]` densifiées (les 6 cibles existent toutes, aucune page orpheline).
- `index.md` : descriptions toujours valides (même ensemble de pages), inchangé.

## [2026-06-25] — Traitement des nouvelles sources texte (6 articles)

**Run d'enrichissement** — traitement de 6 nouveaux fichiers `.md` déposés dans `/raw` (articles de presse et de blog sur le FinOps IA, le marché des outils de coding, l'emploi et la sécurité). Les 7 PDF du premier run sont ignorés (marqueurs `.processed` présents) ; `README.md` est la doc de l'inbox, non traitée.

### Fichiers traités (6)
- `FinOps for AI: Why LLM Cost Is an Engineering Problem, Not a Finance One.md` — Rick Pollick, 2026
- `Traditional FinOps Breaks On AI Workloads.md` — LeanOps Tech, 2026
- `AI FinOps in 2026: Why Runtime Cost Governance Can't Wait.md` — ECI Research / Revenium (Jason Cumberland), 2026
- `Microsoft and Google are late to AI coding, but 'absolutely critical' they compete for growth.md` — CNBC, juin 2026
- `Top engineers at Anthropic, OpenAI say AI now writes 100% of their code…md` — Fortune, janvier 2026
- `AI Software Development: What Changes from 2026 to 2035.md` — First Line Software, avril 2026 (source transversale, distribuée sur les 5 pages)

### Pages enrichies (5)
- `finops-ia.md` — **enrichie** : paradoxe de Jevons, coût comme problème d'ingénierie, coût unitaire (cost per resolved task), boucle attribute/budget/gate/optimize, 7 pratiques FinOps cloud qui cassent sur l'IA + pratique parallèle à bâtir (6 composants, 6 métriques, roadmap 30 j), gouvernance runtime (Revenium), mort du per-seat / ESR / cost per execution.
- `outils-et-marche.md` — **enrichie** : course Microsoft/Google vs Anthropic/OpenAI (Antigravity 2.0, Gemini 3.5 Flash, Build), faible vendor lock-in (MongoDB, Snowflake), chiffres financements/valorisations 2026 (Anthropic 965 Md$ + IPO, Cursor 4 M$→2 Md$/SpaceX 60 Md$), mort du per-seat SaaS et « SaaSocalypse », timeline de marché 2026-2035.
- `agentic-coding.md` — **enrichie** : « 100 % du code écrit par l'IA » dans les labs (Cherny, Amodei, Roon ; nuance 70-90 % company-wide), adoption mesurée (46 %/61 % Java, Pichai 25 %, Nadella 20-30 %) et vibe coding (Karpathy, 2 fév. 2025).
- `transformation-organisationnelle.md` — **enrichie** : recrutement de généralistes (Anthropic), stratification du métier de dev (-40 % junior, prime IA 56 %, 75 % orchestrateurs fin 2026), reckoning du consulting/IT services (Big Four, EPAM, body-shopping, électrification).
- `securite-et-risques.md` — **enrichie** : code IA 2,74× plus vulnérable (Veracode), 45 % d'échecs OWASP, +322 % escalade de privilèges, 25 % des fuites tracées aux agents IA d'ici 2028 (Gartner), vibe coding comme risque, hallucination gouvernée par l'architecture, gouvernance des données by design.

### Autres mises à jour
- `index.md` — descriptions des 5 pages enrichies pour refléter les nouveaux concepts (même ensemble de pages ; `context-engineering` inchangée).
- Cross-références `[[...]]` ajoutées/densifiées entre toutes les pages concernées.

### Marquage « processed »
- Les 6 fichiers étant des `.md` (texte), la mention `processed: true` a été ajoutée en tête de chacun dans `/raw`. Les runs futurs doivent les ignorer.

### Méthode
- 5 agents dédiés (un par page cible) ont enrichi en parallèle, sans conflit (fichiers distincts) ; `index.md` et `log.md` synchronisés ensuite par l'agent principal.
- Règle d'or respectée : aucune information existante supprimée, enrichissement uniquement.
