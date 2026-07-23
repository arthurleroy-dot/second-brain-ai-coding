---
slug: ai-revolution-software-development
title: "The AI revolution in software development"
author: "McKinsey"
date: "2026-04"
source_type: report-pdf
origin: externe
topics: [agentic-coding, transformation-organisationnelle, context-engineering, finops-ia, outils-et-marche]
url: "https://www.mckinsey.com"
source_file: "the-ai-revolution-in-software-development_final.pdf"
---

> Par [[../authors/mckinsey|McKinsey]] · [[../by-date/2026/2026-04/2026-04|2026-04]] · Thèmes : [[../themes/agentic-coding|Agentic Coding]] · [[../themes/transformation-organisationnelle|Transformation Organisationnelle]] · [[../themes/context-engineering|Context Engineering]] · [[../themes/finops-ia|FinOps IA]] · [[../themes/outils-et-marche|Outils & Marché]]

## Citation d'ouverture et scène d'ouverture
`topics: [agentic-coding, transformation-organisationnelle]`

Article McKinsey (Tech & AI Practice, avril 2026), signé par Charlotte Relyea (senior partner, bureau de New York) et Martin Harrysson (senior partner, bureau de la Bay Area). Extrait, publié avec l'autorisation de l'éditeur Wiley, du livre *Rewired: How Leading Companies Win with Technology and AI* par Eric Lamarre, Kate Smaje et Rob Levin, avec Alex Singla et Alexander Sukharevsky.

Sous-titre : « If gen AI has a killer application, it's software development—one of the most profound shifts in the history of programming. »

« Any sufficiently advanced technology is indistinguishable from magic. » — Arthur C. Clarke

**Scène d'ouverture (banque à Londres) :** Il est 8 h du matin, et le troisième étage d'une banque à Londres s'anime alors que l'équipe de jour — trois ingénieurs — entre dans le bureau. Les équipes d'agents IA — près d'une **centaine** d'entre eux — viennent de terminer leur poste, ayant passé la nuit à affiner un nouveau système de paiement transfrontalier (cross-border payment system), à tester les chemins d'échec (failure paths), et à livrer des mises à jour à un rythme qu'aucune équipe humaine ne pourrait égaler.

Les humains déposent leurs sacs et commencent le rituel quotidien : une revue de sprint qui a désormais lieu **chaque matin**, et non plus toutes les deux semaines. Les attend un flux soigneusement organisé de pull requests générées par l'IA, de preuves de tests (test evidence), et de signalements de risques (risk flags) — **plus de progrès en 12 heures qu'une équipe traditionnelle n'en réaliserait en un mois**.

Le travail des ingénieurs n'est plus tant de coder que de piloter (steer), d'appliquer leur jugement, et d'ajuster les priorités pour les agents IA qui travaillent pour eux. L'attention des ingénieurs porte bien davantage sur la structuration des tâches des agents en workflows précisément définis, sur le fait de garantir que leurs activités soient prévisibles et de haute qualité (par exemple, prédéfinir la séquence des activités des agents), et sur la structuration de templates pour la production agentique (agentic output).

« Ça ressemble à de la science-fiction ? Ce n'en est pas. Une « agent factory » (usine à agents) pour une grande banque G-SIB¹ a réussi à faire cela, y compris la nouvelle cadence quotidienne de sprint avec des humains. Les résultats sont stupéfiants : **10 fois la vitesse à la moitié du coût**. C'est une révolution ! »

¹ Global Systemically Important Bank (banque d'importance systémique mondiale).

**Encadré : Business questions this chapter will help you answer**
- Réfléchissez-vous aux implications stratégiques d'une productivité de développement logiciel multipliée par 20 ?
- Est-il important que votre entreprise soit à l'avant-garde de cette révolution, ou est-il acceptable d'être un suiveur (follower) ?
- Comment savez-vous réellement si votre organisation gravit la courbe de productivité du développement logiciel ?

## Introduction : un changement de paradigme
`topics: [agentic-coding, outils-et-marche]`

Si l'IA générative a une « killer application », c'est le développement logiciel. Et ses capacités ont crû de manière exponentielle au cours des trois dernières années.

En substance, les agents IA exécutent des tâches et des workflows de plus en plus complexes (comme créer une provenance de preuves [evidence provenance], exécuter des contrôles légaux et cyber, tester des contrefactuels [counterfactuals], et à la fois suggérer et prendre des décisions). Le rôle des humains est de déclarer une intention de haut niveau et des limites (high-level intent and boundaries), d'évaluer les résultats, et de réagir aux décisions et suggestions agentiques. Ce changement conduit à des équipes plus petites, des coûts unitaires bien plus faibles pour le développement logiciel, et des temps de cycle idée-à-impact bien plus rapides.

### Exhibit — Les quatre niveaux de support développeur

**Titre :** « A paradigm shift in software development is underway. » — Potentiel de productivité brut, par niveau de support développeur (Raw productivity potential, by level of developer support).

| Niveau | Description | Multiple |
|---|---|---|
| Status quo | Proficient practitioner | **1×** |
| Capturable today | Practitioner using (gen AI) tools | **1,2×** |
| The current frontier | Practitioner using agentic AI workflows | **2×** |
| The next frontier | Practitioners supervising a digital agent factory | **20×** |

Source : McKinsey & Company.

**Level 1 : Developing without gen AI.** Le développeur logiciel écrit tout le code seul. La qualité est solide, mais la vitesse est limitée par la rapidité à laquelle une seule personne peut travailler.

**Level 2 : Speeding up individual tasks.** Le développeur écrit quelques lignes, et l'IA suggère les dix suivantes, comme si vous aviez un pair programmeur ultra-rapide assis à côté de vous.

**Level 3 : Automating entire steps in the workflow.** Un développeur décrit une nouvelle fonctionnalité à l'agent IA en langage clair (plain English). L'IA génère automatiquement la première version du code, les tests et la documentation.

**Level 4 : Delivering entire applications.** Une petite équipe guide un système coordonné d'agents IA capable de livrer une application entière de bout en bout — du design au code, aux tests, à l'intégration — ne remontant que les décisions qui requièrent véritablement le jugement humain. **Le résultat est un levier de 20 fois** : quelques praticiens livrant ce qui nécessitait autrefois un grand département.

La plupart des entreprises sont au Level 2 de cette progression. Le Level 3 est de plus en plus adopté. Le Level 4 est en grande partie expérimental au moment de la rédaction de ce livre, bien que des développements prometteurs émergent déjà.

## Best practices for adopting AI in software development
`topics: [agentic-coding, transformation-organisationnelle]`

McKinsey a analysé **près de 300 entreprises cotées en bourse** pour comprendre comment l'IA remodèle le développement logiciel. On a constaté qu'un petit groupe de top performers — environ le **quintile supérieur** — réalise des améliorations de **16 à 30 %** en productivité, time to market et expérience client, ainsi que des gains de **31 à 45 %** en qualité logicielle.

L'insight clé : le simple fait de donner aux développeurs des outils d'IA ne fait pas vraiment bouger l'aiguille. Les entreprises qui débloquent une réelle valeur sont celles qui **réarchitecturent (rearchitect) la manière dont elles construisent le logiciel** et qui intègrent profondément l'IA dans l'ensemble du cycle de vie du développement — pas seulement pour le codage.

Elles déploient de multiples cas d'usage de développement IA couvrant l'idéation, les exigences (requirements), le design, le codage, les tests, le déploiement et les opérations, permettant une accélération continue et des bénéfices cumulatifs (compounding benefits).

Ces organisations rendent aussi leur modèle de développement **AI-native**, faisant évoluer les rôles, les pratiques et les workflows de sorte que les humains agissent en orchestrateurs d'agents IA. Les développeurs passent de l'écriture de chaque ligne de code à la supervision de la génération, la validation de l'architecture et la gestion de la qualité.

Citation pleine page : « Approach AI in software the same way you would for any strategic transformation—set direction, invest in skills, measure outcomes, and align incentives. »

### Les trois enablers critiques

1. **Investissent dans une montée en compétences sérieuse** (serious upskilling), en utilisant des ateliers pratiques (hands-on workshops), de vraies simulations de sprint, et du coaching plutôt qu'une formation passive.

2. **Institutionnalisent le suivi des outcomes** — fréquence de release, taux de défauts, expérience client — pas seulement de simples métriques d'adoption.

3. **Renforcent le changement par des incitations alignées et la gestion de la performance.** En fait, environ **80 % des top performers lient les objectifs d'IA générative aux évaluations des product managers et des développeurs**.

Ces enablers créent de la responsabilisation (accountability), accélèrent l'apprentissage et aident les équipes à internaliser de nouvelles façons de travailler. Sans eux, les organisations retombent dans leurs anciennes habitudes, et le potentiel de l'IA se dissipe.

## A factory of AI agents: How does that work?
`topics: [agentic-coding, context-engineering]`

Les agents IA permettent de faire fonctionner le développement logiciel comme une **usine numérique à deux postes** (two-shift digital factory). Les humains assurent le poste de jour, fixant la direction et faisant respecter la qualité. Les agents IA assurent le poste de nuit, effectuant le gros du travail d'exécution — coder, tester, réviser, documenter — à l'intérieur d'un workflow contrôlé et bien conçu.

Pour commencer, l'organisation doit préparer l'environnement dans lequel les agents opéreront. Les agents ont besoin d'exigences structurées (structured requirements), de user stories claires, et de critères d'acceptation non ambigus — ils ne peuvent pas inférer l'intention métier (business intent). Ils ont aussi besoin d'un contexte riche sur le système : connaissance du domaine, diagrammes d'architecture, contrats d'API (API contracts), modèles de données, frontières de services (service boundaries), et attentes non fonctionnelles.

**Encadré : IBM's end-to-end software development transformation :** Lorsqu'IBM s'est lancé dans sa mission de refondre son processus de développement logiciel, le déploiement initial d'un nouveau modèle de développement logiciel propulsé par l'IA fut difficile. Environ **200 personnes** étaient onboardées toutes les deux semaines ; cependant, l'adoption était inégale (patchy), et l'usage de l'outillage ainsi que les nouveaux comportements ne s'ancraient pas. Beaucoup essayaient les outils d'IA, mais quand ceux-ci ne se comportaient pas comme prévu au départ, les gens revenaient à leurs méthodes précédentes.

Ce « full-court press » incluait l'affectation de **coaches** à chaque équipe sur le cours d'au moins **deux sprints**, la tenue d'heures de bureau « bring your code in » pour résoudre des problèmes spécifiques, et la mise en place et l'animation d'une communauté Slack dynamique. Au cours d'environ **six mois**, IBM a fait passer **plus de 8 000 développeurs** par ce programme. Durant cette période, la productivité individuelle a augmenté de manière significative.

### Le fonctionnement de l'usine : poste de jour et poste de nuit

**Poste de jour** — L'équipe humaine décide de ce qui compte et convertit cette intention en tâches prêtes pour les agents (agent-ready tasks). Elle affine les user stories, traduit les fonctionnalités en spécifications, découpe le travail en tâches bien cadrées (well-scoped tasks), et définit ce à quoi ressemble le « good ». Elle fournit une direction architecturale. En bref, les humains passent de la frappe de code à la **direction, la décomposition et le contrôle qualité** du travail.

**Poste de nuit** — Une flotte coordonnée d'agents effectue des workflows multi-étapes : les **coding agents** implémentent les changements ou refactorisent les modules ; les **test agents** génèrent et exécutent de nouvelles suites de tests ; les **QA agents** identifient les régressions ; les **security agents** scannent les vulnérabilités ou les secrets divulgués (leaked secrets) ; les **performance agents** benchmarkent les chemins critiques ; et les **documentation agents** réécrivent et mettent à jour les références d'API.

Un **agent orchestrateur** gère les handoffs : si les tests échouent, il renvoie le travail vers un **fix agent** ; si la performance se dégrade, il invoque un agent de vérification de performance ; si une politique est violée, il arrête le workflow. Au matin, l'usine a produit un ensemble de **pull requests prêtes pour la revue** (ready-for-review), chacune contenant du code, des tests, des logs, des résultats d'analyse, et une justification en langage naturel (natural-language rationale).

Le lendemain, l'équipe humaine reprend le poste de jour en examinant la production de la nuit. Elle examine les résumés, approuve ou affine les demandes de mise à jour du code, évalue l'adéquation architecturale (architectural fit), et donne à l'IA une nouvelle direction. Elle ajuste les priorités en fonction de ce que les agents ont accompli pendant la nuit, resserre les garde-fous là où c'est nécessaire, et marque davantage de parties de la base de code comme « safe to automate » à mesure que la confiance grandit.

Citation pleine page : « The new rhythm of work in an agent factory: Daytime is for judgment, design, and direction; nighttime is for execution, iteration, and improvement. »

### Cas de succès émergents
Les cas de succès sont encore rares et espacés au moment de la rédaction, mais des percées émergent. Une grande **entreprise de services financiers**, par exemple, a mis en place exactement cette agent factory pour développer un système de paiement greenfield et améliore la productivité de **40 à 70 %**. **LATAM Airlines** a aussi expérimenté une version de ceci et délivre des augmentations de productivité de **50 %** (avec des équipes plus petites).

## Ce qu'il faut pour faire tourner une AI agent factory
`topics: [agentic-coding, context-engineering, finops-ia]`

**Don't skip on the foundations** : Chaque implémentation réussie d'agents IA s'est appuyée sur de solides fondations. LATAM met deux en avant en particulier : une **plateforme d'ingénierie robuste** qui donne aux agents les outils et environnements dont ils ont besoin, et un **operating model orienté produit** où des équipes cross-fonctionnelles comprennent déjà le développement logiciel moderne.

**Invest in knowledge graphs** : Les graphes de connaissance sont essentiels car ils unifient toutes les entrées d'information — dépôts de code, documents et plus — en un réseau structuré unique qui montre comment concepts, faits et actifs sont connectés.

**Learn to break work into agent-ready tasks** : Les humains doivent développer la compétence de décomposer des fonctionnalités plus grandes en petites tâches bien cadrées avec des inputs, outputs et critères d'acceptation clairs. C'est ce qui permet aux workflows multi-agents de tourner en toute sécurité. « Without discrete, agent-ready work items, agents either stall or drift. »

**Master spec-driven development and context engineering** : Les équipes doivent devenir très bonnes pour définir des spécifications claires — ce que le système doit faire, comment il doit se comporter, et comment il sera testé. Tout aussi important : donner aux agents le bon contexte — diagrammes d'architecture, modèles de données, APIs, contraintes et règles métier. **« Good AI output comes from good context, not clever wording. »**

**Strengthen human judgment and review skills** : Les humains deviennent les **editors-in-chief** (rédacteurs en chef) de l'usine. Ils doivent réviser les mises à jour proposées, attraper la dérive architecturale (architectural drift), évaluer si le travail de l'agent correspond à l'intention, et décider quand resserrer les garde-fous ou ajuster les tests. Cette combinaison de jugement produit, compréhension architecturale et revue qualité reste entièrement humaine.

Citation pleine page : « You can't "chat your way" to production-grade software. You need to master how to provide good instructions to AI agents. »

**Revisit performance expectations** : LATAM a constaté que l'un des plus grands défis de l'adoption de l'IA agentique était de **redéployer les personnes vers des tâches supplémentaires** à mesure que les agents libéraient du temps. Certaines entreprises réduisent la taille des équipes ; d'autres relèvent la barre de ce qui devrait être livré en un trimestre.

**Monitor token consumption closely** : Dans un monde où les équipes peuvent lancer des agents, qui créent ensuite des prompts additionnels ou engendrent des sous-agents (spawn subagents), la consommation de tokens peut croître de manière exponentielle et conduire à des **dépassements de coûts significatifs** (significant cost overruns). Pour contrer ce problème, construire une gestion des **financial operations (FinOps)** pour suivre et diriger l'activité des agents.

Faire tourner une AI agent factory ne consiste pas à remplacer des humains par de l'automatisation — il s'agit de créer les conditions où humains et agents IA peuvent travailler ensemble à haute vitesse et avec qualité.

## Implications stratégiques : passer de 2× à 20×
`topics: [transformation-organisationnelle, outils-et-marche]`

Que se passerait-il si le progrès de la productivité du développement logiciel passait de la frontière actuelle d'une amélioration de 2 fois à la nouvelle frontière d'une amélioration de 20 fois ?

**En voici quelques scénarios à considérer :**

- **A 20-times lift in software development productivity turns established companies into continuous, real-time business improvers.** Les parcours clients évoluent chaque semaine, pas chaque année, éliminant l'inertie qui a défini les grands acteurs établis.

- **Modernization stops being a massive program and becomes business as usual.** Les paysages legacy peuvent être retravaillés en vol (reworked in flight), supprimant la plus grande contrainte unique sur les transformations tech et IA.

- **Innovation becomes limited by imagination, not capacity.** De nouveaux produits, services numériques, moteurs de tarification, algorithmes et outils opérationnels peuvent être prototypés et testés en quelques jours ou semaines.

- **Companies with this 20-times capability begin to accelerate away from slower peers.** Des releases plus rapides, des coûts plus bas, de meilleures expériences et des contrôles plus serrés créent un avantage compétitif structurel qui se compose avec le temps.

- **Operating leverage rises sharply as AI-driven productivity lowers the marginal cost of change.** Les entreprises peuvent livrer plus de fonctionnalités, moderniser plus de systèmes et automatiser plus de workflows sans ajouter d'effectifs.

**Encadré : Questions that matter** — Trois questions pour votre C-suite :
- Q1 : Avons-nous besoin de mener cette révolution 20× ou pouvons-nous simplement suivre nos pairs ?
- Q2 : Comment suivrons-nous la manière dont l'IA dans le développement logiciel améliore la productivité et la qualité de nos produits/plateformes ?
- Q3 : **Comment notre stratégie changerait-elle si le coût du développement approchait de zéro ?**

---

*Charlotte Relyea est senior partner au bureau de New York de McKinsey, et Martin Harrysson est senior partner au bureau de la Bay Area. Extrait avec l'autorisation de l'éditeur, Wiley, de Rewired: How Leading Companies Win with Technology and AI par Eric Lamarre, Kate Smaje et Rob Levin, avec Alex Singla et Alexander Sukharevsky. Copyright © 2026 by McKinsey & Company. All rights reserved.*
