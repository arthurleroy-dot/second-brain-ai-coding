# Journal des runs — Wiki AI Coding

Historique chronologique des traitements. Chaque entrée commence par `## [YYYY-MM-DD]`.

## [MIGRATION INITIALE] — 2026-06-29

**Refonte de l'organisation du wiki** vers une arborescence multi-axes (`by-type/`, `by-author/`, `by-date/`, `by-topic/`) avec un standard de métadonnées sur toutes les sources. Aucune information existante supprimée (enrichissement / réorganisation uniquement).

### Nouvelle arborescence
- `by-type/` — **maison physique** des ressources : 1 fichier complet par source. Dossiers créés : `articles/`, `meeting-notes/`, `interviews/`, `presentations/`, `transcripts/`, `personal-notes/`, `unknown/` (chacun avec son `index.md`).
- `by-author/` — index de **pointeurs** uniquement (10 auteurs + `unknown/`).
- `by-date/` — index de **pointeurs** uniquement, par année puis par mois (+ `unknown/`).
- `by-topic/` — les 6 pages thématiques existantes y ont été **déplacées** (contenu et noms conservés pour ne pas casser les `[[wikilinks]]` existants).

### Ressources créées (13 fichiers dans `by-type/articles/`)
Une fiche par source déposée dans `/raw` (7 PDF + 6 articles `.md`) :
- Anthropic — `2026-agentic-coding-trends-report` (2026)
- Deloitte — `2026-software-industry-outlook-deloitte-insights` (2026-02-12) · `state-of-ai-2026` (2026-01)
- McKinsey — `rewiring-software-delivery-for-the-agentic-era` (2026-05) · `the-ai-revolution-in-software-development-final` (2026-04) · `unlocking-the-value-of-ai-in-software-development` (2025-11)
- Accenture — `new-accenture-research-finds-that-companies-with-ai-led-processes-outperform-peers` (2024-10-10)
- ECI Research — `ai-finops-in-2026-why-runtime-cost-governance-cant-wait` (2026)
- First Line Software — `ai-software-development-what-changes-from-2026-to-2035` (2026-04)
- Rick Pollick — `finops-for-ai-why-llm-cost-is-an-engineering-problem-not-a-finance-one` (2026)
- CNBC — `microsoft-and-google-are-late-to-ai-coding` (2026-06)
- Fortune — `top-engineers-at-anthropic-openai-ai-writes-100-percent-of-code` (2026-01)
- LeanOps Tech — `traditional-finops-breaks-on-ai-workloads` (2026)

### Métadonnées des sources `/raw`
- 6 fichiers `.md` : frontmatter YAML complet ajouté (`type`, `author`, `date`, `url`, `deposited_by`, `topics`, `needs_review`, `processed`). `processed: true` conservé.
- 7 PDF : création d'un sidecar `<nom>.pdf.meta.md` (métadonnées + notes extraites). Les anciens marqueurs `<nom>.pdf.processed` sont **conservés** comme trace ; les deux coexistent.

### Index recréés / synchronisés
- `wiki/index.md` — recréé avec les 4 axes de navigation.
- `by-type/*/index.md`, `by-author/*/index.md`, `by-date/**/index.md` — générés.

### Décisions de migration (documentées)
- **Granularité** : 1 fiche = 1 source déposée dans `/raw`. Les citations externes contenues dans ces sources (Gartner, Menlo Ventures, Stanford HAI, FinOps Foundation, Veracode…) restent des citations dans les fiches/pages thématiques et ne deviennent pas des fiches autonomes.
- **Type** : les 13 sources sont des `article` (rapports, billets, articles de presse) → toutes dans `by-type/articles/`. Les autres dossiers de type sont créés mais vides.
- **Noms des pages thématiques** : conservés à l'identique (`finops-ia.md`, `outils-et-marche.md`, etc.) plutôt que renommés, afin de préserver les `[[wikilinks]]` déjà présents dans les pages.
- **Dates partielles** : une source dont seule l'année est connue est classée sous `by-date/<année>/unknown/` et marquée `needs_review: true` (4 sources concernées). `by-date/unknown/` est réservé aux sources sans aucune date.

### Marquage « processed »
- Tous les fichiers `/raw` restent `processed: true` (aucun retraitement). La migration recrée la nouvelle arborescence sans changer ce statut.

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

## [ENRICHISSEMENT CONTENU COMPLET - 2026-06-29]

Mise à jour du template de fiche dans `CLAUDE.md` (nouvelle section « Format d'un fichier de ressource individuel » : ajout des sections **Contenu complet**, **Citations et formulations notables**, **Données et chiffres clés**). Retraitement de **toutes** les fiches de `wiki/by-type/articles/` pour y intégrer une retranscription quasi intégrale de chaque source. Frontmatter et section « Liens connexes » conservés à l'identique dans chaque fiche ; aucun `index.md` ni page `by-topic/` modifié.

### Fiches enrichies (13)
- `microsoft-and-google-are-late-to-ai-coding.md` — CNBC, juin 2026 (~1 250 mots)
- `top-engineers-at-anthropic-openai-ai-writes-100-percent-of-code.md` — Fortune, janvier 2026 (~1 100 mots)
- `ai-finops-in-2026-why-runtime-cost-governance-cant-wait.md` — ECI Research, 2026 (~1 100 mots)
- `rewiring-software-delivery-for-the-agentic-era.md` — McKinsey, mai 2026 (~1 900 mots)
- `new-accenture-research-finds-that-companies-with-ai-led-processes-outperform-peers.md` — Accenture, oct. 2024 (~750 mots)
- `the-ai-revolution-in-software-development-final.md` — McKinsey, avril 2026 (~2 300 mots)
- `finops-for-ai-why-llm-cost-is-an-engineering-problem-not-a-finance-one.md` — Rick Pollick, 2026 (~1 700 mots)
- `ai-software-development-what-changes-from-2026-to-2035.md` — First Line Software, avril 2026 (~3 500 mots)
- `2026-software-industry-outlook-deloitte-insights.md` — Deloitte, févr. 2026 (~2 600 mots)
- `traditional-finops-breaks-on-ai-workloads.md` — LeanOps Tech, 2026 (~2 600 mots)
- `unlocking-the-value-of-ai-in-software-development.md` — McKinsey, nov. 2025 (~2 400 mots)
- `2026-agentic-coding-trends-report.md` — Anthropic, 2026 (~3 600 mots, 18 pages PDF)
- `state-of-ai-2026.md` — Deloitte, janvier 2026 (~3 800 mots, 40 pages PDF)

### Méthode
- 13 agents dédiés (un par fiche) lancés en parallèle, sans conflit (fichiers distincts). Sources PDF lues par tranches de pages jusqu'à couverture complète ; sources `.md` lues intégralement.
- Règle d'or respectée : aucune information existante supprimée, enrichissement uniquement. Frontmatter (slug, type, author, date, url, deposited_by, topics, source_file, needs_review) inchangé partout.
