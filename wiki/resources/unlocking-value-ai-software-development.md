---
slug: unlocking-value-ai-software-development
title: "Unlocking the value of AI in software development"
author: "McKinsey"
date: "2025-11"
source_type: report-pdf
origin: externe
topics: [outils-et-marche, transformation-organisationnelle, context-engineering, finops-ia]
url: "https://www.mckinsey.com"
source_file: "unlocking-the-value-of-ai-in-software-development.pdf.meta.md"
needs_review: false
---

> Par [[../authors/mckinsey|McKinsey]] · [[../by-date/2025/2025-11/2025-11|2025-11]] · Thèmes : [[../themes/outils-et-marche|Outils & Marché]] · [[../themes/transformation-organisationnelle|Transformation Organisationnelle]] · [[../themes/context-engineering|Context Engineering]] · [[../themes/finops-ia|FinOps IA]]

## Introduction
`topics: [agentic-coding, transformation-organisationnelle]`

Article de la Technology, Media & Telecommunications Practice de McKinsey (novembre 2025), écrit par Charlotte Relyea, Martin Harrysson et Matt Linderman, avec Jose Mario Pena, Nandita Bothra et Natasha Maniar. Représentant les vues de la TMT Practice, de McKinsey Technology et de QuantumBlack, AI by McKinsey.

Sous-titre : « Many software teams are seeing some impact from AI, but a select group is experiencing more significant gains by rethinking roles, processes, and performance enablers. »

À partir d'une enquête auprès de **près de 300 entreprises cotées en bourse** (senior leaders), l'article identifie deux changements clés (shifts) et trois conditions essentielles (enablers) que les organisations logicielles les plus performantes utilisent pour maximiser le potentiel de l'IA dans le développement logiciel.

« For all of software's technological advances and world-changing impacts over the past half century, its seismic potential has historically been limited by a shortage of skilled developers, finite coding capacity, and the complexity of coordinating large projects. » L'émergence de l'IA générative, et plus récemment de l'IA agentique (agentic AI), était et est censée surmonter ces obstacles. C'est l'une des conclusions clés d'une enquête McKinsey récente menée auprès d'un large éventail de **près de 300 entreprises cotées en bourse**.

La recherche montre que réaliser la promesse révolutionnaire de l'IA sur le développement de produits logiciels demandera bien plus que l'adoption — cela nécessitera **une refonte complète** (complete overhaul) des processus, des rôles et des modes de travail pour suivre le rythme de l'intelligence croissante des outils et des modèles.

**Encadré : About the research :** « Our survey methodology covered five core dimensions of the product operating model: structure, strategy and governance, ways of working, culture and talent, and tooling. » Les **top performers** = top quintile des répondants sur les quatre indicateurs de résultat. Les **bottom performers** = bottom quintile. Secteurs : technology, financial services, healthcare, energy, retail. Géographies : Americas, Asia, Europe. Source : McKinsey AI benchmark survey, Aug 2025 (n = 100).

## What sets AI software leaders apart
`topics: [agentic-coding, transformation-organisationnelle]`

Les leaders qui façonnent activement une adoption mature de l'IA dans le cadre du développement logiciel obtiennent des résultats matériels, avec un **écart de performance de 15 points de pourcentage** (performance gap of 15 percentage points) entre top et bottom performers.

La haute performance se caractérise par : une plus grande cohérence et qualité des artefacts, des cycles de sprint plus courts, des tailles d'équipe plus petites et de meilleurs scores de satisfaction client. Les plus performants ont vu un impact notablement important de l'IA sur quatre indicateurs clés de développement :
- team productivity, customer experience et time to market : améliorations de **16 à 30 %**
- software quality : **31 à 45 %**

Les auteurs ont identifié **deux changements clés** (two key shifts), soutenus par **trois conditions critiques** (three critical enablers), qui les distinguent systématiquement. Près des deux tiers des top performers utilisaient au moins trois de ces cinq facteurs (at least three of these five factors), contre seulement **10 %** de leurs pairs moins performants.

**Exhibit 1 : « Higher-performing software teams use a combination of process shifts and key enablers to generate more impact from AI. »**

**Process shifts :**
- ≥4 end-to-end AI use cases scaled (≥ 4 cas d'usage IA de bout en bout passés à l'échelle)
- New AI-native roles created (nouveaux rôles AI-native créés)

**Key enablers :**
- Hands on and one-on-one training offered (formation pratique et individuelle proposée)
- Outcome metrics tracked (suivi de métriques d'outcome)
- AI goals for both product manager and developer roles (objectifs IA pour les rôles de product manager ET de développeur)

Pour chaque pratique, la part décroît des top vers les bottom performers (top performers entre ~60 et ~80 %, middle performers entre ~30 et ~50 %, bottom performers proches de 0 à ~25 %).

« Simply adopting AI tools is not enough. Companies must rethink how they structure teams and build software in an AI-forward world. »

## Two key shifts to unlock AI's full potential in software development
`topics: [agentic-coding, transformation-organisationnelle]`

### Shift 1 — Prioritize end-to-end implementations of use cases across the PDLC

Les top performers adoptent une approche holistique, intégrant l'IA à travers tout le cycle de vie du développement plutôt que de se limiter à des cas d'usage isolés. Ils sont **six à sept fois plus susceptibles** que leurs pairs de passer à l'échelle **quatre cas d'usage ou plus** — de la conception (design) et du codage jusqu'aux tests, au déploiement et au suivi de l'adoption. Près des deux tiers des leaders rapportent quatre cas d'usage ou plus à l'échelle, contre seulement **10 %** des bottom performers.

**Cas Cursor :** Cursor, la start-up AI-native à croissance rapide, adopte une telle approche complète. L'équipe Cursor fonctionne effectivement comme un **laboratoire interne** (internal lab) pour les workflows d'ingénierie pilotés par l'IA, où les équipes testent des solutions sur leurs propres points de douleur et « productize » celles qui prennent de l'ampleur. Les développeurs combinent agents d'IA, support de **Bugbot** et revue humaine pour étendre la couverture des tâches logicielles avec un minimum de perturbation, tandis que les sprints équilibrent la livraison de nouvelles fonctionnalités avec les améliorations de processus. Les ingénieurs de Cursor définissent des commandes d'équipe (team commands), des prompts et des règles à différents niveaux de portée — qu'il s'agisse d'un fichier individuel ou de toute la codebase — passant d'une documentation éparse à un « **paved-path PDLC** ». L'équipe utilise la fonctionnalité **Plan Mode** de leur outil de codage phare pour planifier leurs changements avant l'implémentation.

Pendant le développement, les ingénieurs collaborent avec des agents en temps réel, y compris par la voix (through voice), pour refactoriser du code, poser des questions sur leur codebase et construire des fonctionnalités. En même temps, ils déclenchent des **agents en arrière-plan** (background agents) pour gérer d'autres tâches — exécutant parfois plusieurs agents localement en parallèle sur la même tâche. **Bugbot**, l'outil de revue de code IA de Cursor, examine le code résultant avant qu'il ne soit transmis aux autres développeurs de l'équipe pour une vérification finale.

Cette nouvelle configuration permet à Cursor d'augmenter son débit de fonctionnalités (feature throughput) avec une équipe restreinte (lean team).

### Shift 2 — Create AI-native roles within the PDLC

L'IA prend de plus en plus en charge des tâches d'ingénierie centrales telles que le refactoring, la modernisation et le testing. **Plus de 90 %** de toutes les équipes logicielles interrogées utilisent l'IA pour ces activités, économisant en moyenne **six heures par semaine**. Les outils comme **GitHub Copilot, Claude Code et l'agent Jules de Google** ont évolué de simples complétions inline vers l'exécution autonome de tâches de refactoring et de modernisation multi-fichiers et de longue durée.

Dans le cadre de cette adoption, des rôles clés prennent de nouvelles responsabilités AI-native :
- Les **product managers** passent moins de temps sur la livraison de fonctionnalités (feature delivery) et plus sur le design, le prototypage, la quality assurance (QA) et les pratiques responsables d'implémentation de l'IA.
- Les **software engineers** se concentrent davantage sur la fluence full-stack, la communication structurée des specs et la compréhension des arbitrages d'architecture et de systèmes (architectural and systems trade-offs).

À l'avenir, beaucoup d'équipes pourraient opérer comme des **orchestrateurs d'agents IA parallèles et asynchrones** (orchestrators of parallel and asynchronous AI agents), assignant des workflows et façonnant la logique de bout en bout ensemble tout en vérifiant continuellement les sorties. Les entreprises créeront de plus en plus du **logiciel sur mesure à la demande** (custom software on demand), faisant du **problem framing** et de l'**intent specification** des compétences critiques.

La structure de l'équipe Cursor reflète comment les rôles AI-native exigent des évolutions de compétences. Les frontières traditionnelles entre front end, back end et QA ont fusionné en responsabilités full-stack plus larges. Chaque release a un individu responsable dédié (**DRI** — dedicated responsible individual) qui coordonne développement, test et résolution de bugs.

Citation de **Michael Truell, CEO et cofondateur de Cursor** : « Over the next decade, AI-assisted programming will let developers specify intent through a mix of formal programming languages and natural language, freeing them to focus on designing the logic of their software. Some individual contributors may spend part of their time as engineering managers directing a 'junior' team of asynchronous agents—a new type of work that could demand an entirely new skill set. AI will likely play a role in code review and testing, and validation will accelerate by orders of magnitude. »

## Three critical enablers of success
`topics: [transformation-organisationnelle]`

Aussi essentiels soient-ils, les changements dans ces deux pratiques ne suffisent pas à eux seuls à capter la pleine valeur de l'IA dans le développement de produits logiciels.

### Enabler 1 — Upskilling: Invest in personalized, intensive training

Celles qui investissent dans des **ateliers pratiques** (hands-on workshops) et du **coaching individuel** (one-on-one coaching) sont bien plus susceptibles de voir des gains mesurables — **57 % des top performers** contre seulement **20 % des bottom performers**. Décomposer les problèmes pour communiquer clairement avec un LLM — le prompt engineering — n'est qu'un exemple de la complexité qui requiert une formation intensive pour élever le niveau.

Les organisations très performantes conçoivent une formation qui reflète le vrai travail de développement — intégrant l'IA dans les code reviews, le sprint planning et les cycles de test. Elles personnalisent aussi les parcours d'apprentissage par rôle.

Comme les outils avancent si rapidement, la formation ne peut pas être un exercice ponctuel (one-off exercise). Certaines entreprises de pointe ont établi des « **AI guilds** » ou « **centers of enablement** » internes qui curatent de nouveaux cas d'usage, partagent les bonnes pratiques et servent de mentors à la demande pour les équipes projet.

### Enabler 2 — Impact measurement: Track outcomes—not just adoption

Les organisations très performantes ne se concentrent pas uniquement sur des métriques d'adoption telles que la fréquence d'usage des outils ou les taux d'acceptation de code. Ces surperformants suivent les outcomes — surveillant les améliorations de qualité (**79 %**) et les gains de vitesse (**57 %**).

Citation de **Tariq Shaukat, CEO de Sonar** : « Too often, companies measure AI's impact by counting how much code it produces rather than what that code achieves. Lines of code or AI contribution percentages don't reveal whether the output is secure, maintainable, or even useful. The real progress comes from tracking how these tools help teams ship higher-quality, more reliable software—not just more of it. »

**Trois étapes pour construire un système de mesure robuste :**
1. **Select meaningful metrics.** Définir les outcomes qui comptent le plus (cycle times, releases de meilleure qualité, satisfaction client). Éviter les proxies faibles comme le % de code généré par l'IA.
2. **Build integrated tracking.** Connecter les données à travers les outils de planification, les code repositories et les logs d'usage de l'IA.
3. **Report insights regularly.** Partager en continu les conclusions avec les leaders produit, ingénierie et business.

### Enabler 3 — Change management: Align incentives with AI-enabled behaviors that drive impact

Les top performers intègrent l'adoption de l'IA directement dans les **évaluations de performance** (performance evaluations). Près de **huit sur dix** lient des objectifs liés à l'IA générative à la fois aux revues des product managers et des développeurs, contre seulement **10 % des bottom performers pour les développeurs et aucun pour les product managers**.

Les organisations de pointe focalisent les incitations sur les comportements qui pilotent l'impact — pas seulement l'usage. Les objectifs sont formulés autour de contributions telles que l'identification d'opportunités d'automatisation, l'amélioration de la vélocité via des tests AI-enabled, ou l'amélioration de la qualité via la revue de code assistée par modèle (model-assisted code review).

## Moving toward true AI-driven value
`topics: [agentic-coding, outils-et-marche, finops-ia]`

Au cours des dernières années, beaucoup d'entreprises ont appris par elles-mêmes que générer un véritable impact financier en intégrant l'IA dans le développement de produits logiciels exige des organisations qu'elles effectuent des **changements en profondeur** (wholesale changes) à leur operating model.

Rien que sur l'année écoulée, le benchmark d'AI coding d'Artificial Analysis² a **presque doublé — passant de 30 points à 55 points** — bien que cela reste **20 points en dessous** de l'index d'intelligence global de tous les modèles généraux. Les outils deviennent plus puissants à mesure qu'ils s'étendent à travers le PDLC : de simples outils d'autocomplétion vers des agents hybrides pilotés par le raisonnement (hybrid, reasoning-driven agents) qui peuvent planifier des tâches, appeler des outils externes, et même simuler automatiquement des tests utilisateurs via l'usage d'ordinateur in-browser (in-browser computer use).

En plus des pratiques et conditions décrites dans l'article, ces surperformants suivent généralement trois étapes englobantes :
1. **Set ambitious goals** qui unissent le leadership et énergisent l'organisation
2. **Develop a holistic blueprint** pour le futur operating model, testé et affiné pour s'adapter au contexte de l'organisation
3. **Create a detailed road map** qui redéfinit les structures d'équipe, les workflows, les métriques et les incitations pour débloquer la productivité à l'échelle

Conclusion : « Only by approaching AI in such a strategic, comprehensive way can software teams hope to harness its full potential as a force for innovation, efficiency, and value creation in software development. »

---

*² A holistic benchmark of the top large language model coding benchmarks — including LiveCodeBench, SciCode, et Terminal-Bench Hard — évaluant les modèles de fournisseurs tels qu'Anthropic, Google, OpenAI et xAI. Data provided by Artificial Analysis.*

*Charlotte Relyea est senior partner au bureau de New York de McKinsey. Martin Harrysson est senior partner au bureau de la Bay Area. Matt Linderman est partner au bureau du Connecticut. Copyright © 2025 McKinsey & Company. All rights reserved.*
