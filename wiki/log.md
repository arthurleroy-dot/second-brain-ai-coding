---
type: log
---

# Journal des runs

## [2026-07-10] ingest | Document témoin plateforme

**Type** : ingestion de validation (test de la chaîne d'upload)
**Run** : `gha` (GitHub Action)
**Fichier traité** : `raw/temoin-agentic-coding.md` + sidecar `.meta.md`

**Ressource créée** :
- `resources/test-plateforme-panorama-agentic-coding-2026.md`
  - Slug : `test-plateforme-panorama-agentic-coding-2026`
  - Auteur : Test plateforme (nouvel auteur)
  - Date : 2026-07-09 (date précise)
  - Type : article
  - Origin : externe
  - Topics : agentic-coding
  - Entités reliées : claude-code (niveau ressource)

**Vues dérivées mises à jour** :
- `authors/test-plateforme.md` — nouvelle page auteur créée
- `themes/agentic-coding.md` — ressource ajoutée (resource_count 7 → 8)
- `entities/claude-code.md` — mention ajoutée (ressource entière)
- `by-date/2026/2026-07/2026-07.md` — nouvelle page mois créée
- `by-date/2026/2026.md` — mois de juillet ajouté (resource_count 13 → 14)
- `types.md` — article (6 → 7 ressources)
- `origin.md` — externe (13 → 14 ressources)
- `index.md` — compteurs mis à jour (resources 13 → 14, authors 10 → 11)
- `graph.json` — 3 nouveaux nodes (resource, author, date:2026-07), 6 nouveaux edges

**Entités traitées** :
- Claude Code : mentionné explicitement → lié (entité existante)
- Anthropic : mentionné comme organisation → NON relié (existe comme auteur, pas comme entité tool/client)

**Candidates ajoutées** : aucune (pas de nouvelle entité inconnue détectée)

**needs_review** : false (origin déductible : article classique → externe)

**Notes** :
- Document témoin court (866 octets) déposé via la plateforme pour valider la chaîne d'ingestion de bout en bout (upload → GitHub Action → écriture dans wiki/)
- Granularité des entités : `resource` (contenu court et transverse)
- Pas d'URL fournie dans le sidecar (champ vide)
- Premier fichier ingéré du mois de juillet 2026 → création du répertoire et de la page `by-date/2026/2026-07/`

---

## [2026-07-03] ingest | Reconstruction complète — architecture 3 couches

**Type** : reconstruction totale (migration depuis ancienne architecture)
**Durée** : 2 sessions (contexte long)

**Phases effectuées** :
- Phase 0 : archive de l'état précédent → `wiki/_archive/pre-restructuration-2026-07-03/`
- Phase 1 : suppression ancienne structure wiki/
- Phase 2 : création 13 fiches `resources/*.md` (contenu intégral + chunk annotations)
- Phase 3 : génération vues dérivées (themes/, authors/, by-date/, types.md, origin.md, index.md)
- Phase 4 : génération `graph.json` (32 nœuds, 62 arêtes)
- Phase 5 : réécriture CLAUDE.md (architecture 3 couches)
- Phase 7 : cette entrée log

**Ressources créées (13)** :
- `resources/ai-finops-2026-runtime-cost-governance-cant-wait.md` — ECI Research · 2026 ⚠
- `resources/finops-ai-llm-cost-engineering-not-finance.md` — Rick Pollick · 2026 ⚠
- `resources/traditional-finops-breaks-ai-workloads.md` — LeanOps Tech · 2026 ⚠
- `resources/microsoft-google-late-ai-coding-compete-growth.md` — CNBC · 2026-06
- `resources/top-engineers-anthropic-openai-ai-writes-100-pct-code.md` — Fortune · 2026-01
- `resources/ai-software-development-what-changes-2026-2035.md` — First Line Software · 2026-04
- `resources/2026-agentic-coding-trends-report.md` — Anthropic · 2026 ⚠
- `resources/2026-software-industry-outlook.md` — Deloitte · 2026-02-12
- `resources/rewiring-software-delivery-agentic-era.md` — McKinsey · 2026-05
- `resources/state-of-ai-2026-untapped-edge.md` — Deloitte · 2026-01
- `resources/accenture-research-ai-led-processes-outperform-peers.md` — Accenture · 2024-10-10
- `resources/ai-revolution-software-development.md` — McKinsey · 2026-04
- `resources/unlocking-value-ai-software-development.md` — McKinsey · 2025-11

**Thèmes créés (6)** : finops-ia (8 res), agentic-coding (7), transformation-organisationnelle (8), outils-et-marche (8), securite-et-risques (5), context-engineering (3)

**Auteurs créés (10)** : ECI Research, Rick Pollick, LeanOps Tech, CNBC, Fortune, First Line Software, Anthropic, Deloitte, McKinsey, Accenture

**needs_review à résoudre** : 4 ressources ont `needs_review: true` pour date (année seulement) :
- ECI Research · "AI FinOps in 2026" — date exacte inconnue
- Rick Pollick · "FinOps for AI" — date exacte inconnue
- LeanOps Tech · "Traditional FinOps Breaks" — date exacte inconnue
- Anthropic · "Agentic Coding Trends Report 2026" — date exacte inconnue

**Tensions détectées** :
- Aucune contradiction factuelle directe détectée. Points de divergence à surveiller :
  - McKinsey (Rewiring, mai 2026) : 3-5× productivité avec 60% réduction équipe
    vs McKinsey (Unlocking, nov. 2025) : 16-30% productivité top performers
    → Les deux sont cohérents (Rewiring = projection factory mature, Unlocking = benchmark actuel).
  - Deloitte (State of AI) : 74% planifient IA agentique d'ici 2 ans, mais 21% seulement ont gouvernance mature
    vs Anthropic (Trends Report) : adoption déjà en cours dans les grands comptes
    → Tension réelle : adoption vs gouvernance, à surveiller dans les prochaines sources.

---

## [2026-07-02] — Bootstrap initial

**Type** : création from scratch  
**Fichiers traités** : 13 sources (3 articles texte complets, 3 articles texte complets FinOps, 7 PDF via meta.md)

**Fiches créées** :
- resources/ai-finops-in-2026-why-runtime-cost-governance-cant-wait.md
- resources/finops-for-ai-why-llm-cost-is-an-engineering-problem-not-a-finance-one.md
- resources/traditional-finops-breaks-on-ai-workloads.md
- resources/ai-software-development-what-changes-from-2026-to-2035.md
- resources/top-engineers-at-anthropic-openai-say-ai-now-writes-100-percent-of-their-code.md
- resources/microsoft-and-google-are-late-to-ai-coding.md
- resources/2026-agentic-coding-trends-report.md
- resources/2026-software-industry-outlook-deloitte.md
- resources/new-accenture-research-companies-with-ai-led-processes-outperform.md
- resources/rewiring-software-delivery-for-the-agentic-era.md
- resources/state-of-ai-2026-deloitte.md
- resources/the-ai-revolution-in-software-development.md
- resources/unlocking-the-value-of-ai-in-software-development.md

**Pages thématiques créées** :
- themes/finops-ia.md (9 sources)
- themes/agentic-coding.md (5 sources)
- themes/transformation-organisationnelle.md (7 sources)
- themes/outils-et-marche.md (7 sources)
- themes/securite-et-risques.md (4 sources)
- themes/context-engineering.md (3 sources)

**Pages auteurs créées** :
- authors/eci-research.md
- authors/rick-pollick.md
- authors/leanops-tech.md
- authors/first-line-software.md
- authors/fortune.md
- authors/cnbc.md
- authors/anthropic.md
- authors/deloitte.md
- authors/accenture.md
- authors/mckinsey.md

## [2026-07-03] maintenance | Résolution des 4 gaps post-reconstruction

**Type** : correction / enrichissement (pas d'ingestion de nouvelle source)

**Tâche 1 — needs_review des 4 ressources FinOps/Anthropic** :
- `origin: externe` était déjà en place pour les 4 ressources (contrairement à
  l'hypothèse initiale d'un `origin` vide) ; seul `needs_review: true → false`
  restait à appliquer.
- Décision actée avec l'humain : `needs_review` ne suit plus la précision de
  date (année seule) — uniquement l'incertitude sur `origin`. Règle mise à
  jour en CLAUDE.md §5 (déclencheur unique).
- graph.json : clé `needs_review` retirée des 4 nodes concernés ; edges
  `has_origin` déjà présents, vérifiés.
- origin.md, types.md, by-date/2026/index.md : régénérés / nettoyés des
  marqueurs `⚠` et mentions `needs_review` devenues obsolètes.

**Tâche 2 — source_type ECI Research** :
- Vérification `/raw/` : aucun `.pdf` correspondant à
  `AI FinOps in 2026: Why Runtime Cost Governance Can't Wait.md` (fichier
  texte uniquement). `source_type: article` confirmé, aucun changement.
- La checklist de vérification demandant `source_type: interview` pour cette
  ressource contredit à la fois la règle de décision de la tâche 2 et la
  définition d'`interview` (interne uniquement) — non appliquée, signalée
  comme incohérence de spec.

**Tâche 3 — nodes/edges date** :
- graph.json : 10 nodes `date` ajoutés (3 année, 7 mois), 7 edges `year_of`,
  13 edges `published_on` (1 par ressource, dates normalisées au mois pour
  les 2 ressources à précision jour).
- by-date/ : structure de dossiers déjà conforme ; contenu de chaque
  `index.md` vérifié contre `resources/*.md`, aucune incohérence trouvée.

**Tâche 4 — CLAUDE.md** :
- `touches_theme` absent du dépôt (déjà `belongs_to_theme` partout).
- Table des types d'edges ajoutée en §3 (avec `published_on`, `year_of`),
  exemple JSON étendu avec des nodes `date`.
- §5 : bloc `needs_review` (déclencheur unique = origin) écrit tel que
  dicté par l'humain, remplaçant une version à 3 déclencheurs déjà présente
  dans le fichier (éditée directement, hors de cette session) — signalé et
  résolu en faveur de l'instruction verbale la plus récente.

**Index créés** : index.md, log.md, types.md, timeline.md, origin.md, graph.json
