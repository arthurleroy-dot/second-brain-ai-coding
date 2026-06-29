---
slug: rewiring-software-delivery-for-the-agentic-era
type: article
author: "McKinsey"
date: "2026-05"
url: "https://www.mckinsey.com"
deposited_by: ""
topics: [agentic-coding, transformation-organisationnelle, context-engineering]
source_file: "raw/rewiring-software-delivery-for-the-agentic-era.pdf"
needs_review: false
---

# Rewiring software delivery for the agentic era

## Résumé
Article McKinsey Technology (mai 2026) signé Jared Moon, Rory Walsh et Vito Di Leo, avec Adam Thelwall. Il défend que la manière dont l'IA agentique est utilisée dans le développement logiciel annonce des changements plus larges du modèle de livraison. La thèse centrale : les organisations de pointe redessinent déjà la livraison autour d'une exécution quasi continue (24 h/24), via un « sprint de 24 heures » qui combine jugement humain de jour et exécution par des agents la nuit. Plusieurs entreprises constatent des gains de productivité de 3 à 5 fois, avec une réduction d'environ 60 % de la taille des équipes, à condition de « recâbler » le modèle opérationnel (recablage du SDLC, élimination des handoffs humains, infrastructure de connaissance, redimensionnement des équipes).

## Contenu complet

### En-tête
- Sous-titre : « The way agentic AI is being used in software development is a harbinger for broader changes in the delivery model. » (La manière dont l'IA agentique est utilisée dans le développement logiciel annonce des changements plus larges du modèle de livraison.)
- Auteurs : by Jared Moon, Rory Walsh, and Vito Di Leo, with Adam Thelwall.
- Date : May 2026.
- Visuel : un signe d'infini lumineux (symbolisant le cycle continu).

### Scène d'ouverture (page 2)
« At 9:00 a.m., a product owner logs in to review overnight progress on a solution her team is working on. She sees that a feature has moved from structured requirements to tested code. Edge cases are flagged. She notes that architecture dependencies have been validated. A concise summary outlines trade-offs and open decisions. »

À 9 h 00, une product owner se connecte pour passer en revue les progrès réalisés pendant la nuit sur une solution sur laquelle son équipe travaille. Elle constate qu'une fonctionnalité est passée d'exigences structurées à du code testé. Les cas limites (edge cases) sont signalés. Les dépendances d'architecture ont été validées. Un résumé concis présente les arbitrages (trade-offs) et les décisions ouvertes.

« No one worked late. AI agents did. » (Personne n'a travaillé tard. Ce sont les agents IA qui l'ont fait.)

« By midmorning, the team is reviewing outputs, refining guardrails, and reprioritizing the backlog. By evening, the next structured inputs are queued up for the AI agents to work on over another overnight cycle. »

En milieu de matinée, l'équipe revoit les outputs, affine les garde-fous (guardrails) et repriorise le backlog. En soirée, les prochaines entrées structurées sont mises en file pour que les agents IA y travaillent durant un nouveau cycle nocturne.

« This 24-hour work model is no longer theoretical. Leading organizations are already redesigning delivery around near-continuous execution. While the software delivery model is evolving quickly, multiple companies are already seeing it deliver threefold to fivefold improvements in productivity, with a 60 percent reduction in team size. Organizations are finding these gains not by just deploying AI agents but by rewiring the operating model so humans and agents can collaborate 24 hours a day. »

Ce modèle de travail sur 24 heures n'est plus théorique. Les organisations de pointe redessinent déjà la livraison autour d'une exécution quasi continue. Bien que le modèle de livraison logicielle évolue rapidement, plusieurs entreprises constatent déjà qu'il apporte des améliorations de productivité de 3 à 5 fois, avec une réduction de 60 % de la taille des équipes. Ces gains s'obtiennent non pas en déployant simplement des agents IA, mais en recâblant le modèle opérationnel pour que les humains et les agents collaborent 24 heures sur 24.

Citation mise en exergue : « While the software delivery model is evolving quickly, multiple companies are already seeing it deliver threefold to fivefold improvements in productivity. »

### Section 1 — The 24-hour sprint: Design for continuous throughput (Le sprint de 24 heures : conçu pour un débit continu) (page 3)

Les meilleures entreprises évoluent vers un modèle de sprint quotidien qui mêle jugement humain et exécution nocturne par les agents — une réduction significative par rapport au cycle typique de deux semaines (« two-week-sprint cycle times »). Pendant la journée, les humains se concentrent sur la revue des outputs, la résolution des ambiguïtés, le renforcement des garde-fous architecturaux et l'alignement des parties prenantes. De plus en plus, leur rôle consiste moins à produire des artefacts qu'à superviser et améliorer le système qui les produit.

La nuit, les agents exécutent du travail structuré à grande échelle. Leurs tâches incluent : enrichir les exigences, valider l'architecture, générer et tester le code, et packager les outputs pour revue.

Ce modèle ne fonctionne que si quelques fondations pratiques sont en place :
1. **Vision métier claire** : l'entreprise doit avoir une vision claire de ce qui doit être construit (par exemple une feuille de route produit, ou un standard de référence) afin de pouvoir évaluer les exigences générées par les agents quant à leur qualité et leur alignement avec cette vision.
2. **Environnement technologique standard et cohérent** : l'environnement technique doit être standard et cohérent (par exemple en utilisant des frameworks communs et des architectures modulaires) pour que les solutions puissent passer à l'échelle et que les composants soient réutilisés plutôt que réinventés à chaque fois.
3. **Structure standard des exigences au code** : le chemin des exigences au code doit suivre une structure standard pour que les agents puissent interpréter de manière fiable les entrées et produire des sorties prévisibles à travers différents projets.
4. **Parties prenantes engagées de bout en bout** : les mêmes parties prenantes clés (« core stakeholders ») doivent rester engagées tout au long de la chaîne de valeur pour éviter le désalignement et le retravail constant. Sans ce niveau de cohérence et de clarté, l'output des agents sera fragmenté et difficile à fiabiliser (« difficult to trust »).

*Main takeaway :* « Continuous 24-hour delivery is achievable but only with architectural discipline and standardized workflows so agents can operate reliably at scale. » (La livraison continue 24 h/24 est atteignable, mais seulement avec une discipline architecturale et des workflows standardisés pour que les agents puissent opérer de façon fiable à grande échelle.)

#### Encadré : « The AI-enabled operating model is based on daily sprints. » — « The way of working in the AI-enabled operating model (illustrative) »
Frise chronologique illustrative s'étalant de 9:00 am → 5:00 pm → Midnight → 9:00 am → 5:00 pm → Midnight → 9:00 am, montrant l'alternance entre travail diurne (humains) et nocturne (agents).

**Night shift: 16 hours (led by a factory of agents)** — Équipe de nuit : 16 heures (menée par une « factory » d'agents)
- **Requirements** : Create the business requirements for the features requested by the humans. (Créer les exigences métier pour les fonctionnalités demandées par les humains.)
- **Architecture** :
  - Check if the architecture is in place for the features. (Vérifier que l'architecture est en place pour les fonctionnalités.)
  - Set up the structure to build the features. (Mettre en place la structure pour construire les fonctionnalités.)
  - Create the design for how to implement the features. (Créer le design de la mise en œuvre des fonctionnalités.)
- **Build and test** :
  - Build and test a first version of the features. (Construire et tester une première version des fonctionnalités.)
  - Write a report for the humans, with outcomes of the tests and recommendations. (Rédiger un rapport pour les humains, avec les résultats des tests et des recommandations.)

**Day shift: 8 hours (humans supported by agents)** — Équipe de jour : 8 heures (humains assistés par les agents)
- **Sprint review/demo** : Review agent output to identify gaps vs expectations and acceptance criteria. (Revoir l'output des agents pour identifier les écarts par rapport aux attentes et aux critères d'acceptation.)
- **Spec-and-code working session** :
  - Live pair review of critical code paths and AI traceability. (Revue en pair-programming en direct des chemins de code critiques et de la traçabilité IA.)
  - Cross-functional sync (eg, legal/compliance inputs, design feedback). (Synchronisation transverse : apports juridiques/conformité, retours design.)
- **Offline system optimization** :
  - Refactor weak code flagged in morning session and fix outputs. (Refactoriser le code faible signalé en séance du matin et corriger les outputs.)
  - Refine guardrails and quality standards for context, skills, prompts, and workflows; rerun the factory. (Affiner les garde-fous et standards de qualité pour le contexte, les compétences, les prompts et les workflows ; relancer la factory.)
  - Design improvements for next sprint. (Concevoir les améliorations pour le prochain sprint.)
- **Sprint planning** :
  - Refine inputs and instructions for the agentic factory (if needed). (Affiner les entrées et instructions pour la factory agentique, si nécessaire.)
  - Align with stakeholders on priorities for the upcoming night shift. (S'aligner avec les parties prenantes sur les priorités du prochain shift de nuit.)

Source de l'encadré : McKinsey & Company.

### Section 2 — Extend automation to eliminate human handoffs (Étendre l'automatisation pour éliminer les handoffs humains) (page 4)

L'automatisation traditionnelle d'intégration continue et de livraison continue (CI/CD) se concentre largement sur les tests et le déploiement. Bien que ces coûts varient, l'expérience de McKinsey est qu'ils peuvent représenter jusqu'à 30 % de la dépense technologique totale (« as much as 30 percent of total technology spend »). La majorité de l'effort, concentrée des exigences (requirements) jusqu'au codage, reste manuelle et intensive en interprétation. C'est là que la friction s'accumule et que la valeur plafonne (« friction accumulates and value plateaus »).

Dans la plupart des organisations, les exigences, standards, spécifications architecturales et user stories vivent dans des documents et outils déconnectés. Chaque transition introduit de l'ambiguïté. Les humains traduisent à répétition l'intention d'un artefact à un autre.

Le modèle agentique supprime cette friction en structurant les artefacts pour des handoffs machine-à-machine. Les descriptions fonctionnelles, exigences non fonctionnelles, diagrammes de séquence et dépôts (repositories) sont codifiés dans des formats standardisés et lisibles par la machine (« machine-readable formats »). Le pipeline peut alors s'exécuter de bout en bout en quelques heures, les humains n'intervenant qu'à des portes de revue définies (« defined review gates ») plutôt que comme intermédiaires.

*Main takeaway :* « Scaling AI requires applying engineering practices to the development system itself, making the process repeatable and automating handoffs. » (Passer l'IA à l'échelle exige d'appliquer des pratiques d'ingénierie au système de développement lui-même, en rendant le processus répétable et en automatisant les handoffs.)

#### Encadré : « Rewire the product development life cycle to eliminate human handoffs. » — « Automated pipeline with agentic squads across requirements, design, build, and deployment »
Légende : Existing input documents / External inputs → / Agent squad activity / Agent outputs / Agent-generated outputs.

**Requirements** (entrées existantes : Project brief, Business requirements, Functional descriptions, External interface specs) :
- Create process flow → High-level process flow
- Enrich process flow → Enriched business requirements
- Generate detailed requirements → Refined business requirements¹

**Design** (entrées existantes : Future-state architecture, Technical guardrails/standards, Nonfunctional requirements, Code repositories, Rules catalog) :
- Create high-level design (security/ops/exception) → Summarized standards and design
- Create low-level design → Technical user stories
- Validate design against process flow/target architecture → Sequenced diagrams and specifications

**Code/test** (entrées existantes : Development guidelines, YAML rules framework) :
- Develop validation microservices → Business validation services pull request (code)
- Develop transformation microservices → Message transformation services pull request (code)
- Unit testing squad → Test report

**Deploy** :
- Deploy → Traditional continuous integration/continuous delivery automation (deploy and operate)

Note de bas de figure : « Humans are responsible for reviews at the end. » (Les humains sont responsables des revues à la fin.)
¹ « Refined business requirements (1x doc per stage of the flow). »
Encadré latéral : « Requirements, design, and coding take **70%** of tech spend; deployment takes **30%**. » (Exigences, design et codage représentent 70 % de la dépense tech ; le déploiement en représente 30 %.)
Source : « Software development cost: Complete 2026 budget guide, » Boundex AI, Apr 2, 2026; McKinsey analysis. Source de l'encadré : McKinsey & Company.

### Section 3 — Create a knowledge infrastructure to unlock agent autonomy (Créer une infrastructure de connaissance pour libérer l'autonomie des agents) (page 5)

Pour produire des résultats précis, les « agent factories » ont besoin de contexte et de mémoire organisationnels. Les meilleures entreprises construisent des graphes de connaissance (« knowledge graphs ») qui fonctionnent comme une couche de mémoire IA à travers le cycle de développement logiciel (SDLC) pour chaque domaine. Ces graphes connectent les éléments qui aident les agents à comprendre : feedback client, décisions d'architecture, documents de design, tickets, activité GitHub, rapports d'incident et règles de conformité résumées. Le résultat est un système lié sémantiquement (« semantically linked system »), c'est-à-dire une manière pour les agents de comprendre ce que les données signifient afin de mieux accomplir leurs tâches.

L'impact est transformateur. Des questions qui exigeaient autrefois des semaines d'entretiens avec de multiples experts métier (subject matter experts, SMEs) peuvent désormais être répondues en quelques minutes par un agent « bibliothécaire » (« librarian ») puisant dans une mémoire institutionnelle structurée. Chaque décision devient traçable. Si une partie prenante demande pourquoi une fonctionnalité a été dépriorisée, la réponse peut être reliée directement à sa source, par exemple des données d'enquête client ou des analyses d'usage. La connaissance tribale implicite devient explicite et explicable, réduisant le temps de montée en compétence des nouveaux membres et renforçant la gouvernance.

Important : cela ne doit pas commencer par un effort d'ontologie grandiose et top-down. Le graphe doit évoluer organiquement autour des domaines prioritaires et des programmes en cours, capitalisant la valeur au fil du temps. À mesure qu'il passe à l'échelle, la connaissance devient une infrastructure de production, plutôt qu'une documentation statique, et une source durable d'avantage compétitif.

*Main takeaway :* « Structured, connected knowledge is the foundation of agent autonomy. Treat your knowledge architecture as strategic infrastructure. » (La connaissance structurée et connectée est le fondement de l'autonomie des agents. Traitez votre architecture de connaissance comme une infrastructure stratégique.)

#### Encadré : « Knowledge graphs are the critical unlock to enable velocity and agent autonomy. » — « From manually connected context to an AI-enabled context layer (illustrative) »
- État actuel : « Humans manage context and draw connections manually » — « Data is fragmented and disconnected. Making sense of it requires subject matter experts (SMEs) and lots of discussion. »
- État cible : « "Librarian" agent accesses knowledge on demand, handling complex multientity questions » — « Data is organized with clear relationships between data entities within each domain that agents can understand. »

**Example insight data by source** (exemples de données par source) :
- **SharePoint** : Results of previous surveys (eg, drop-off drivers). (Résultats d'enquêtes précédentes, ex. facteurs d'abandon.)
- **Observability** : Recent customer usage data and drop-off points. (Données récentes d'usage client et points d'abandon.)
- **Jira** : Features or user stories already planned for implementation. (Fonctionnalités ou user stories déjà planifiées.)
- **GitHub** : Existing services that support onboarding or related capabilities. (Services existants supportant l'onboarding ou des capacités connexes.)
- **SMEs** : Implicit SME knowledge on the journey (not formally documented). (Connaissance implicite des experts sur le parcours, non formellement documentée.)

« Example knowledge graph » : schéma d'un graphe (Agent au centre, Connections vers les nœuds). Source de l'encadré : McKinsey & Company.

### Section 4 — Capture value: Resize teams and redesign the portfolio (Capter la valeur : redimensionner les équipes et redessiner le portefeuille) (page 6)

Le SDLC agentique peut matériellement augmenter la productivité car des équipes plus petites peuvent désormais faire plus de travail. Les premières mises en œuvre suggèrent que des équipes plus grandes de 8 à 12 équivalents temps plein (full-time equivalents, FTEs) pourraient céder la place à des « pods » plus petits de professionnels hautement qualifiés supervisant une exécution menée par les agents. Le résultat : des délais compressés et des coûts plus bas ou une capacité accrue.

Pour capter la valeur, les organisations devraient se concentrer sur trois priorités :

1. **Reskilling (requalification des personnes)** : Tandis qu'une équipe centrale a besoin des compétences pour développer et maintenir les « factories » d'agents (assurant standardisation, conformité, best practice, etc.), les ingénieurs logiciels de toute l'organisation doivent développer du jugement, des compétences de revue de code et de supervision pour gérer les agents avec lesquels ils travaillent. Les rôles se déplacent de la coordination et des tests manuels vers la cohérence d'architecture, la modélisation de domaine et la supervision de l'IA (« architecture coherence, domain modeling, and AI supervision »).

2. **Les rôles de l'"outer loop"** : s'assurer que les rôles de la boucle externe — support et conformité dans le risque, le juridique, le test et les achats (« risk, legal, testing, and procurement ») — fassent partie de l'effort de développement agentique. Un SDLC plus rapide ne se traduit pas par des progrès plus rapides si cela ne se produit pas. Les agents et l'automatisation (par exemple via la « policy as code ») peuvent aider à garantir que ces contrôles ne deviennent pas des goulets d'étranglement, tout en améliorant qualité, cohérence, complétude et traçabilité. Ces contrôles devraient être intégrés « par design » (« baked in by design »), plutôt que de devenir un gardien (« gatekeeper ») en fin de processus.

3. **Redessiner l'allocation de capacité** : repenser la façon dont la capacité est allouée pour que les gains de productivité se traduisent en nouvelle valeur. La capacité libérée est souvent réinvestie pour accélérer les feuilles de route, moderniser les plateformes ou lancer de nouveaux produits.

*Main takeaway :* « Productivity gains can be translated into structural portfolio changes. Resize teams and consciously redeploy capacity to capture full value. » (Les gains de productivité peuvent être traduits en changements structurels de portefeuille. Redimensionnez les équipes et redéployez consciemment la capacité pour capter toute la valeur.)

#### Encadré : « Agentic software delivery requires smaller teams and less time. » — « Time and team size reductions (illustrative) » (Current delivery model vs Agentic software development life cycle)

- **Full-time equivalents (FTEs) required** : modèle actuel ~100 FTEs → modèle agentique ~60 FTEs.
- **Duration of software development** : modèle actuel 200 person years (24 months) → modèle agentique ~100 person years (18 months).
- **Project team makeup** : modèle actuel 10 teams of 8–12 FTEs → modèle agentique 16 teams of 3–4 FTEs.
- **Team composition** :
  - Modèle actuel (10 par équipe) : Product owner, Business analyst, Tech lead, Software engineers (plusieurs), Testers (2).
  - Modèle agentique (3 par équipe) : Product owner, Tech lead, AI-enabled engineer.
- **~50% reduction in total effort (in person years).**
- **~60% reduction in average team size¹.**
- ¹ « Based on McKinsey experience and observation across multiple companies. »
- Source de l'encadré : McKinsey & Company.

### Conclusion (page 7)

La transformation devrait commencer là où l'impact est le plus grand. Dans la plupart des organisations technologiques, un petit nombre de grands programmes représente la majorité de la dépense totale. Cibler ces initiatives — qu'il s'agisse d'efforts de modernisation de legacy, de reconstructions brownfield ou de lancements de nouveaux produits — maximise l'impact visible et accélère l'apprentissage.

À mesure que les agents prennent en charge l'exécution à grande échelle et produisent un code robuste et systématiquement sécurisé, les rôles humains se concentreront sur l'architecture, le jugement produit et le design système, faisant de la connaissance institutionnelle et de la cohérence technique des différenciateurs décisifs. Les organisations qui commencent à bâtir ces capacités dans le cadre d'un effort plus large de recâblage de leur modèle opérationnel ne se contenteront pas d'aller plus vite ; elles redéfiniront la manière dont le logiciel crée de la valeur.

Citation mise en exergue : « Organizations that rewire their operating model will not just move faster; they will redefine how software creates value. »

### Auteurs et crédits (page 8)
- **Jared Moon** est senior partner au bureau de Londres de McKinsey, où **Adam Thelwall** est associate partner.
- **Rory Walsh** est partner au bureau de Dublin.
- **Vito Di Leo** est partner au bureau de Zurich.
- Remerciements : les auteurs remercient Aishik Dhar, Amray Schwabe, Benjamin Schloesing et Nikolaus Müller pour leurs contributions.
- Édité par Barr Seitz, directeur éditorial au bureau de New York.
- Designed by McKinsey Global Publishing. Copyright © 2026 McKinsey & Company. All rights reserved.
- Mention : « Find more content like this on the McKinsey Insights App. »

## Concepts clés
- Modèle de travail sur 24 heures (« 24-hour work model ») / livraison quasi continue
- Sprint de 24 heures (« 24-hour sprint ») / sprints quotidiens vs cycles de sprint de deux semaines
- Modèle opérationnel activé par l'IA (« AI-enabled operating model »)
- Recâblage du modèle opérationnel (« rewiring the operating model »)
- Night shift (16 h, menée par une « factory of agents ») vs Day shift (8 h, humains assistés par les agents)
- Agent factory / « factory » d'agents / squads agentiques (agentic squads)
- Du développeur producteur d'artefacts au superviseur/orchestrateur du système qui les produit
- Quatre fondations pratiques : vision métier claire, environnement tech standard et cohérent, structure standard des exigences au code, parties prenantes engagées de bout en bout
- Garde-fous (guardrails) et standards de qualité (contexte, compétences, prompts, workflows)
- Élimination des handoffs humains / handoffs machine-à-machine
- CI/CD traditionnel (tests et déploiement) vs friction concentrée en amont (requirements → code)
- Formats lisibles par la machine (« machine-readable formats »)
- Portes de revue définies (« defined review gates »)
- Pipeline automatisé : Requirements → Design → Code/test → Deploy
- YAML rules framework / Rules catalog / Policy as code
- Graphes de connaissance (« knowledge graphs ») comme couche de mémoire IA du SDLC
- Système lié sémantiquement (« semantically linked system »)
- Agent « bibliothécaire » (« librarian ») répondant à des questions multi-entités
- Connaissance tribale implicite rendue explicite et explicable ; traçabilité des décisions
- Knowledge as production infrastructure (avantage compétitif durable, évolution organique du graphe)
- Sources de données : SharePoint, Observability, Jira, GitHub, SMEs
- Redimensionnement des équipes (pods de 3–4 FTEs) ; redesign du portefeuille
- Trois priorités de captation de valeur : reskilling, rôles de l'« outer loop », redessiner l'allocation de capacité
- Outer loop (risque, juridique, test, achats) intégré « by design » plutôt qu'en gatekeeper
- AI-enabled engineer (nouveau rôle de composition d'équipe)
- Rôles humains futurs : architecture, jugement produit, design système, cohérence technique, supervision de l'IA, modélisation de domaine
- Cibler les grands programmes (modernisation legacy, reconstructions brownfield, lancements de produits)

## Citations et formulations notables
- (Ouverture, p. 2) « No one worked late. AI agents did. »
- (Ouverture, p. 2) « This 24-hour work model is no longer theoretical. »
- (Exergue, p. 2) « While the software delivery model is evolving quickly, multiple companies are already seeing it deliver threefold to fivefold improvements in productivity. »
- (Ouverture, p. 2) « Organizations are finding these gains not by just deploying AI agents but by rewiring the operating model so humans and agents can collaborate 24 hours a day. »
- (Section 1, p. 3) « Increasingly, their role is less about producing artifacts and more about supervising and improving the system that produces them. »
- (Section 1, p. 3 — Main takeaway) « Continuous 24-hour delivery is achievable but only with architectural discipline and standardized workflows so agents can operate reliably at scale. »
- (Section 1, p. 3) « Without this level of consistency and clarity, agent output will be fragmented and difficult to trust. »
- (Section 2, p. 4) « This is where friction accumulates and value plateaus. »
- (Section 2, p. 4) « The agentic model removes this friction by structuring artifacts for machine-to-machine handoffs. »
- (Section 2, p. 4) « The pipeline can then run end to end in hours, with humans intervening only at defined review gates rather than acting as intermediaries. »
- (Section 2, p. 4 — Main takeaway) « Scaling AI requires applying engineering practices to the development system itself, making the process repeatable and automating handoffs. »
- (Encadré, p. 4) « Humans are responsible for reviews at the end. »
- (Section 3, p. 5) « These graphs connect elements that agents need to make sense of... The result is a semantically linked system (that is, a way for agents to understand what the data means so they can better perform their tasks). »
- (Section 3, p. 5) « Implicit tribal knowledge becomes explicit and explainable, reducing ramp-up time for new team members and strengthening governance. »
- (Section 3, p. 5) « As it scales, knowledge becomes production infrastructure, rather than static documentation, and a durable source of competitive advantage. »
- (Section 3, p. 5 — Main takeaway) « Structured, connected knowledge is the foundation of agent autonomy. Treat your knowledge architecture as strategic infrastructure. »
- (Encadré, p. 5) « Knowledge graphs are the critical unlock to enable velocity and agent autonomy. »
- (Section 4, p. 6) « These controls should be baked in by design, rather than becoming a gatekeeper at the end of the process. »
- (Section 4, p. 6 — Main takeaway) « Productivity gains can be translated into structural portfolio changes. Resize teams and consciously redeploy capacity to capture full value. »
- (Conclusion, p. 7 — exergue) « Organizations that rewire their operating model will not just move faster; they will redefine how software creates value. »

## Données et chiffres clés
- **3 à 5 fois** (« threefold to fivefold ») : amélioration de productivité constatée par plusieurs entreprises.
- **60 %** : réduction de la taille des équipes (« 60 percent reduction in team size ») ; aussi exprimée comme **~60 % reduction in average team size** dans l'encadré p. 6 (basé sur l'expérience et l'observation McKinsey sur plusieurs entreprises).
- Modèle de travail **24 heures sur 24** ; journée structurée autour de 9:00 am / 5:00 pm / Midnight.
- **Night shift : 16 heures** (menée par une factory d'agents) ; **Day shift : 8 heures** (humains assistés par les agents).
- Cycle visé : sprint quotidien (24 h) vs cycle de sprint de **deux semaines**.
- CI/CD (tests et déploiement) : jusqu'à **30 %** de la dépense technologique totale (« as much as 30 percent of total technology spend »).
- Répartition de la dépense tech : **Requirements + design + coding = 70 %** ; **deployment = 30 %** (source : « Software development cost: Complete 2026 budget guide, » Boundex AI, Apr 2, 2026 ; McKinsey analysis).
- Pipeline agentique exécutable de bout en bout en **quelques heures** (« in hours »).
- Équipes : 8 à 12 FTEs (modèle actuel) → pods de **3 à 4** FTEs (modèle agentique).
- Encadré « Time and team size reductions » :
  - FTEs requis : **~100 FTEs** (actuel) → **~60 FTEs** (agentique).
  - Durée du développement : **200 person years (24 months)** → **~100 person years (18 months)**.
  - Composition des équipes : **10 teams of 8–12 FTEs** → **16 teams of 3–4 FTEs**.
  - **~50 %** : réduction de l'effort total (en personnes-années).
  - **~60 %** : réduction de la taille moyenne d'équipe.
- Date de publication : **May 2026** ; copyright **© 2026** McKinsey & Company.

## Liens connexes
- Topics : [[agentic-coding]] [[transformation-organisationnelle]] [[context-engineering]]
- Auteur : [McKinsey](../../by-author/mckinsey/index.md)
- Date : [Mai 2026](../../by-date/2026/2026-05/index.md)
