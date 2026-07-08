---
slug: rewiring-software-delivery-agentic-era
title: "Rewiring software delivery for the agentic era"
author: "McKinsey"
date: "2026-05"
source_type: report-pdf
origin: externe
topics: [agentic-coding, transformation-organisationnelle, context-engineering]
url: "https://www.mckinsey.com"
source_file: "rewiring-software-delivery-for-the-agentic-era.pdf.meta.md"
needs_review: false
---

> Par [[../authors/mckinsey|McKinsey]] · [[../by-date/2026/2026-05/2026-05|2026-05]] · Thèmes : [[../themes/agentic-coding|Agentic Coding]] · [[../themes/transformation-organisationnelle|Transformation Organisationnelle]] · [[../themes/context-engineering|Context Engineering]]

## Introduction et scène d'ouverture
`topics: [agentic-coding, transformation-organisationnelle]`

Article McKinsey Technology (mai 2026) signé Jared Moon, Rory Walsh et Vito Di Leo, avec Adam Thelwall. Sous-titre : « The way agentic AI is being used in software development is a harbinger for broader changes in the delivery model. »

Scène d'ouverture : « At 9:00 a.m., a product owner logs in to review overnight progress on a solution her team is working on. She sees that a feature has moved from structured requirements to tested code. Edge cases are flagged. She notes that architecture dependencies have been validated. A concise summary outlines trade-offs and open decisions. »

À 9 h 00, une product owner se connecte pour passer en revue les progrès réalisés pendant la nuit sur une solution sur laquelle son équipe travaille. Elle constate qu'une fonctionnalité est passée d'exigences structurées à du code testé. Les cas limites (edge cases) sont signalés. Les dépendances d'architecture ont été validées. Un résumé concis présente les arbitrages (trade-offs) et les décisions ouvertes.

« No one worked late. AI agents did. » (Personne n'a travaillé tard. Ce sont les agents IA qui l'ont fait.)

« By midmorning, the team is reviewing outputs, refining guardrails, and reprioritizing the backlog. By evening, the next structured inputs are queued up for the AI agents to work on over another overnight cycle. »

« This 24-hour work model is no longer theoretical. Leading organizations are already redesigning delivery around near-continuous execution. While the software delivery model is evolving quickly, multiple companies are already seeing it deliver **threefold to fivefold improvements in productivity**, with a **60 percent reduction in team size**. Organizations are finding these gains not by just deploying AI agents but by **rewiring the operating model** so humans and agents can collaborate 24 hours a day. »

Citation mise en exergue : « While the software delivery model is evolving quickly, multiple companies are already seeing it deliver threefold to fivefold improvements in productivity. »

## Section 1 — The 24-hour sprint: Design for continuous throughput
`topics: [agentic-coding, transformation-organisationnelle]`

Les meilleures entreprises évoluent vers un modèle de sprint quotidien qui mêle jugement humain et exécution nocturne par les agents — une réduction significative par rapport au cycle typique de deux semaines (« two-week-sprint cycle times »). Pendant la journée, les humains se concentrent sur la revue des outputs, la résolution des ambiguïtés, le renforcement des garde-fous architecturaux et l'alignement des parties prenantes. De plus en plus, leur rôle consiste moins à produire des artefacts qu'à **superviser et améliorer le système qui les produit**.

La nuit, les agents exécutent du travail structuré à grande échelle. Leurs tâches incluent : enrichir les exigences, valider l'architecture, générer et tester le code, et packager les outputs pour revue.

Ce modèle ne fonctionne que si quelques fondations pratiques sont en place :
1. **Vision métier claire** : l'entreprise doit avoir une vision claire de ce qui doit être construit afin de pouvoir évaluer les exigences générées par les agents quant à leur qualité et leur alignement avec cette vision.
2. **Environnement technologique standard et cohérent** : l'environnement technique doit être standard et cohérent (par exemple en utilisant des frameworks communs et des architectures modulaires) pour que les solutions puissent passer à l'échelle.
3. **Structure standard des exigences au code** : le chemin des exigences au code doit suivre une structure standard pour que les agents puissent interpréter de manière fiable les entrées et produire des sorties prévisibles à travers différents projets.
4. **Parties prenantes engagées de bout en bout** : les mêmes parties prenantes clés doivent rester engagées tout au long de la chaîne de valeur pour éviter le désalignement et le retravail constant. « Without this level of consistency and clarity, agent output will be fragmented and difficult to trust. »

*Main takeaway :* « Continuous 24-hour delivery is achievable but only with architectural discipline and standardized workflows so agents can operate reliably at scale. »

**Encadré — « The AI-enabled operating model is based on daily sprints. »** Frise chronologique illustrative s'étalant de 9:00 am → 5:00 pm → Midnight → 9:00 am, montrant l'alternance entre travail diurne (humains) et nocturne (agents).

**Night shift: 16 hours (led by a factory of agents)**
- **Requirements** : Create the business requirements for the features requested by the humans.
- **Architecture** : Check if the architecture is in place for the features ; Set up the structure to build the features ; Create the design for how to implement the features.
- **Build and test** : Build and test a first version of the features ; Write a report for the humans, with outcomes of the tests and recommendations.

**Day shift: 8 hours (humans supported by agents)**
- **Sprint review/demo** : Review agent output to identify gaps vs expectations and acceptance criteria.
- **Spec-and-code working session** : Live pair review of critical code paths and AI traceability ; Cross-functional sync (eg, legal/compliance inputs, design feedback).
- **Offline system optimization** : Refactor weak code flagged in morning session and fix outputs ; Refine guardrails and quality standards for context, skills, prompts, and workflows ; rerun the factory ; Design improvements for next sprint.
- **Sprint planning** : Refine inputs and instructions for the agentic factory (if needed) ; Align with stakeholders on priorities for the upcoming night shift.

Source de l'encadré : McKinsey & Company.

## Section 2 — Extend automation to eliminate human handoffs
`topics: [agentic-coding, context-engineering]`

L'automatisation traditionnelle d'intégration continue et de livraison continue (CI/CD) se concentre largement sur les tests et le déploiement. D'après l'expérience de McKinsey, ceux-ci peuvent représenter jusqu'à **30 % de la dépense technologique totale**. La majorité de l'effort, concentrée des exigences jusqu'au codage, reste manuelle et intensive en interprétation. « This is where friction accumulates and value plateaus. »

Dans la plupart des organisations, les exigences, standards, spécifications architecturales et user stories vivent dans des documents et outils déconnectés. Chaque transition introduit de l'ambiguïté. Les humains traduisent à répétition l'intention d'un artefact à un autre.

Le modèle agentique supprime cette friction en structurant les artefacts pour des handoffs machine-à-machine. Les descriptions fonctionnelles, exigences non fonctionnelles, diagrammes de séquence et dépôts (repositories) sont codifiés dans des **formats standardisés et lisibles par la machine** (« machine-readable formats »). Le pipeline peut alors s'exécuter de bout en bout en quelques heures, les humains n'intervenant qu'à des **portes de revue définies** (« defined review gates ») plutôt que comme intermédiaires.

*Main takeaway :* « Scaling AI requires applying engineering practices to the development system itself, making the process repeatable and automating handoffs. »

**Encadré — « Rewire the product development life cycle to eliminate human handoffs. »** — Automated pipeline with agentic squads across requirements, design, build, and deployment.

**Requirements** (entrées existantes : Project brief, Business requirements, Functional descriptions, External interface specs) :
- Create process flow → High-level process flow
- Enrich process flow → Enriched business requirements
- Generate detailed requirements → Refined business requirements

**Design** (entrées existantes : Future-state architecture, Technical guardrails/standards, Nonfunctional requirements, Code repositories, Rules catalog) :
- Create high-level design (security/ops/exception) → Summarized standards and design
- Create low-level design → Technical user stories
- Validate design against process flow/target architecture → Sequenced diagrams and specifications

**Code/test** (entrées existantes : Development guidelines, YAML rules framework) :
- Develop validation microservices → Business validation services pull request (code)
- Develop transformation microservices → Message transformation services pull request (code)
- Unit testing squad → Test report

**Deploy** : → Traditional continuous integration/continuous delivery automation (deploy and operate)

Note de bas de figure : « Humans are responsible for reviews at the end. »

Encadré latéral : « Requirements, design, and coding take **70%** of tech spend; deployment takes **30%**. » (Source : « Software development cost: Complete 2026 budget guide, » Boundex AI, Apr 2, 2026 ; McKinsey analysis.)

## Section 3 — Create a knowledge infrastructure to unlock agent autonomy
`topics: [context-engineering, agentic-coding]`

Pour produire des résultats précis, les « agent factories » ont besoin de contexte et de mémoire organisationnels. Les meilleures entreprises construisent des **graphes de connaissance** (« knowledge graphs ») qui fonctionnent comme une couche de mémoire IA à travers le SDLC pour chaque domaine. Ces graphes connectent les éléments qui aident les agents à comprendre : feedback client, décisions d'architecture, documents de design, tickets, activité GitHub, rapports d'incident et règles de conformité résumées. Le résultat est un **système lié sémantiquement** (« semantically linked system »), c'est-à-dire une manière pour les agents de comprendre ce que les données signifient afin de mieux accomplir leurs tâches.

L'impact est transformateur. Des questions qui exigeaient autrefois des semaines d'entretiens avec de multiples experts métier (SMEs) peuvent désormais être répondues en quelques minutes par un agent « bibliothécaire » (« librarian ») puisant dans une mémoire institutionnelle structurée. Chaque décision devient traçable. « Implicit tribal knowledge becomes explicit and explainable, reducing ramp-up time for new team members and strengthening governance. »

Important : cela ne doit pas commencer par un effort d'ontologie grandiose et top-down. Le graphe doit évoluer organiquement autour des domaines prioritaires et des programmes en cours. À mesure qu'il passe à l'échelle, « knowledge becomes production infrastructure, rather than static documentation, and a durable source of competitive advantage. »

*Main takeaway :* « Structured, connected knowledge is the foundation of agent autonomy. Treat your knowledge architecture as strategic infrastructure. »

**Encadré — « Knowledge graphs are the critical unlock to enable velocity and agent autonomy. »**
- État actuel : « Humans manage context and draw connections manually » — « Data is fragmented and disconnected. Making sense of it requires subject matter experts (SMEs) and lots of discussion. »
- État cible : « "Librarian" agent accesses knowledge on demand, handling complex multientity questions » — « Data is organized with clear relationships between data entities within each domain that agents can understand. »

**Example insight data by source** :
- **SharePoint** : Results of previous surveys (eg, drop-off drivers).
- **Observability** : Recent customer usage data and drop-off points.
- **Jira** : Features or user stories already planned for implementation.
- **GitHub** : Existing services that support onboarding or related capabilities.
- **SMEs** : Implicit SME knowledge on the journey (not formally documented).

## Section 4 — Capture value: Resize teams and redesign the portfolio
`topics: [transformation-organisationnelle, finops-ia]`

Le SDLC agentique peut matériellement augmenter la productivité car des équipes plus petites peuvent désormais faire plus de travail. Les premières mises en œuvre suggèrent que des équipes plus grandes de **8 à 12 FTEs** pourraient céder la place à des « pods » plus petits de professionnels hautement qualifiés supervisant une exécution menée par les agents. Le résultat : des délais compressés et des coûts plus bas ou une capacité accrue.

Pour capter la valeur, les organisations devraient se concentrer sur trois priorités :

1. **Reskilling (requalification des personnes)** : Tandis qu'une équipe centrale a besoin des compétences pour développer et maintenir les « factories » d'agents, les ingénieurs logiciels de toute l'organisation doivent développer du jugement, des compétences de revue de code et de supervision pour gérer les agents. Les rôles se déplacent de la coordination et des tests manuels vers la cohérence d'architecture, la modélisation de domaine et la supervision de l'IA (« architecture coherence, domain modeling, and AI supervision »).

2. **Les rôles de l'"outer loop"** : s'assurer que les rôles de la boucle externe — support et conformité dans le risque, le juridique, le test et les achats (« risk, legal, testing, and procurement ») — fassent partie de l'effort de développement agentique. Un SDLC plus rapide ne se traduit pas par des progrès plus rapides si cela ne se produit pas. Ces contrôles devraient être intégrés « **par design** » (« baked in by design »), plutôt que de devenir un gardien (« gatekeeper ») en fin de processus.

3. **Redessiner l'allocation de capacité** : repenser la façon dont la capacité est allouée pour que les gains de productivité se traduisent en nouvelle valeur. La capacité libérée est souvent réinvestie pour accélérer les feuilles de route, moderniser les plateformes ou lancer de nouveaux produits.

*Main takeaway :* « Productivity gains can be translated into structural portfolio changes. Resize teams and consciously redeploy capacity to capture full value. »

**Encadré — « Agentic software delivery requires smaller teams and less time. »** — « Time and team size reductions (illustrative) » (Current delivery model vs Agentic software development life cycle)

- **Full-time equivalents (FTEs) required** : modèle actuel ~100 FTEs → modèle agentique ~60 FTEs.
- **Duration of software development** : modèle actuel 200 person years (24 months) → modèle agentique ~100 person years (18 months).
- **Project team makeup** : modèle actuel 10 teams of 8–12 FTEs → modèle agentique 16 teams of 3–4 FTEs.
- **Team composition actuelle** (10 par équipe) : Product owner, Business analyst, Tech lead, Software engineers (plusieurs), Testers (2).
- **Team composition agentique** (3 par équipe) : Product owner, Tech lead, AI-enabled engineer.
- **~50% reduction in total effort (in person years).**
- **~60% reduction in average team size.** ¹

¹ « Based on McKinsey experience and observation across multiple companies. »

## Conclusion
`topics: [transformation-organisationnelle, agentic-coding]`

La transformation devrait commencer là où l'impact est le plus grand. Dans la plupart des organisations technologiques, un petit nombre de grands programmes représente la majorité de la dépense totale. Cibler ces initiatives — qu'il s'agisse d'efforts de modernisation de legacy, de reconstructions brownfield ou de lancements de nouveaux produits — maximise l'impact visible et accélère l'apprentissage.

À mesure que les agents prennent en charge l'exécution à grande échelle et produisent un code robuste et systématiquement sécurisé, les rôles humains se concentreront sur l'architecture, le jugement produit et le design système, faisant de la connaissance institutionnelle et de la cohérence technique des différenciateurs décisifs.

Citation mise en exergue : « Organizations that rewire their operating model will not just move faster; they will redefine how software creates value. »

---

*Auteurs : Jared Moon (senior partner, Londres), Rory Walsh (partner, Dublin), Vito Di Leo (partner, Zurich), avec Adam Thelwall (associate partner, Londres). Copyright © 2026 McKinsey & Company. All rights reserved.*
