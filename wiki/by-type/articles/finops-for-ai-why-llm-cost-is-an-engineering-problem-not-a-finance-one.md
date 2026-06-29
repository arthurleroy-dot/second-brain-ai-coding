---
slug: finops-for-ai-why-llm-cost-is-an-engineering-problem-not-a-finance-one
type: article
author: "Rick Pollick"
date: "2026"
url: "https://rickpollick.com"
deposited_by: ""
topics: [finops-ia]
source_file: "raw/FinOps for AI: Why LLM Cost Is an Engineering Problem, Not a Finance One.md"
needs_review: true
---

# FinOps for AI: Why LLM Cost Is an Engineering Problem, Not a Finance One

## Résumé
Billet de Rick Pollick défendant la thèse que le coût des LLM est un problème d'ingénierie, pas de finance : « la facture est écrite dans le codebase ». Partant de l'histoire d'une équipe plateforme qui a remplacé son modèle par un autre 10× moins cher par token et a vu sa facture mensuelle tripler en six semaines, l'auteur explique ce phénomène par le paradoxe de Jevons. Il appuie son propos sur le Stanford AI Index 2025, Menlo Ventures et le State of FinOps 2026, puis détaille où vivent réellement les leviers de coût (sélection du modèle, taille du contexte, longueur de sortie, retries / étapes d'agent), pourquoi il faut piloter le coût unitaire plutôt que la facture totale, comment installer une boucle de gouvernance (attribuer, budgéter, gater, optimiser) et quelles actions concrètes mener avant la prochaine release.

## Contenu complet

[FinOps for AI: Why LLM Cost Is an Engineering Problem, Not a Finance One](https://rickpollick.com/_next/image?url=%2Fimages%2Ffinops-ai-hero.png&w=3840&q=75)

Une équipe plateforme avec laquelle l'auteur a travaillé le trimestre dernier a fait quelque chose qui ressemblait à un gain évident. Elle a remplacé le modèle derrière sa fonctionnalité IA phare par un modèle qui coûtait environ dix fois moins par token, a vérifié le prix d'une seule requête, et a annoncé à son VP qu'elle avait réduit le coût de fonctionnement de la fonctionnalité de quatre-vingt-dix pour cent. Six semaines plus tard, la facture mensuelle de cette fonctionnalité avait triplé.

Rien n'était réellement cassé. Le prix par token avait bel et bien chuté. Mais des tokens moins chers ont rendu la fonctionnalité suffisamment bon marché pour être utilisée partout, donc l'équipe l'a câblée dans trois workflows supplémentaires, a élargi la fenêtre de contexte pour améliorer la qualité, et a ajouté un second appel de modèle pour vérifier le premier. Prix unitaire plus bas, beaucoup plus d'unités, une facture bien plus grosse. **C'est le piège dans lequel presque chaque entreprise est en train de tomber en ce moment, et il porte un nom ancien venu de l'économie : le paradoxe de Jevons. Quand une ressource devient moins chère à utiliser, les gens en utilisent tellement plus que la dépense totale grimpe au lieu de baisser.**

Les chiffres macro disent que ce n'est pas l'erreur d'une seule équipe, c'est la forme de tout le marché. Le [Stanford AI Index 2025](https://hai.stanford.edu/ai-index/2025-ai-index-report) a constaté que le coût d'inférence pour un système performant au niveau de GPT-3.5 est tombé d'environ vingt dollars par million de tokens fin 2022 à sept cents fin 2024, une baisse de plus de deux cent quatre-vingts fois. Sur quasiment la même fenêtre, [Menlo Ventures](https://menlovc.com/2024-the-state-of-generative-ai-in-the-enterprise/) a mesuré la dépense des entreprises en IA générative passant de 2,3 milliards de dollars en 2023 à 13,8 milliards en 2024, puis à 37 milliards en 2025. Les prix se sont effondrés. La dépense est partie vers la lune.

Cet écart entre l'effondrement des prix et l'explosion des factures est toute la raison pour laquelle le « FinOps for AI » est passé d'une expression de niche au sujet le plus en mouvement de la finance technologique. L'enquête [State of FinOps 2026](https://data.finops.org/) de la FinOps Foundation, tirée de praticiens responsables de plus de quatre-vingt-trois milliards de dollars de dépense cloud, a constaté que quatre-vingt-dix-huit pour cent des répondants gèrent désormais de la dépense IA, contre soixante-trois pour cent un an plus tôt et seulement trente et un pour cent l'année précédente. Les répondants ont désigné la gestion du coût de l'IA comme la compétence la plus importante que leurs équipes doivent développer. En deux ans, c'est passé d'une erreur d'arrondi au titre principal.

Voici la partie que la plupart des organisations financières n'ont pas encore assimilée. **On ne peut pas gérer cette facture depuis le côté finance, parce que presque rien de ce qui la pilote ne vit dans la finance. Cela vit dans votre codebase.**

### The Bill Is Written in the Codebase

Pendant quinze ans, le FinOps cloud a surtout consisté à gérer des ressources que quelqu'un provisionne et que quelqu'un d'autre paie : une instance surdimensionnée ici, une base de données inactive là, une remise de capacité réservée laissée sur la table. Les plus gros leviers étaient des leviers d'approvisionnement (procurement). On pouvait réduire une facture cloud de manière significative sans qu'un seul ingénieur ne change une ligne de code.

Le coût de l'IA ne fonctionne pas ainsi. Le coût d'une fonctionnalité IA est fixé, presque entièrement, par des décisions que les ingénieurs et les équipes produit prennent pendant qu'ils la construisent. Ramenez la fonctionnalité à son compteur et le coût mensuel ressemble à ceci :

![Diagram showing the cost of one AI request as the product of requests, tokens per call, price per token, and retries or agent steps, every term set by an engineering decision](https://rickpollick.com/images/finops-ai-cost-drivers.png)

Le coût d'une requête IA est le produit : requêtes × tokens par appel × prix par token × retries ou étapes d'agent. Chaque terme de ce produit est un choix de conception.

- **Model selection (sélection du modèle)** fixe le prix par token, et l'écart est énorme ; un modèle frontier peut coûter vingt à cinquante fois plus par token qu'un petit modèle qui aurait répondu à la question tout aussi bien.
- **Context size (taille du contexte)** fixe les tokens d'entrée, et la facilité d'habitude consistant à fourrer un document entier, un long historique, ou une généreuse pile de chunks récupérés dans chaque prompt est la source la plus courante de croissance silencieuse des coûts.
- **Output length (longueur de sortie)** est un réglage que la plupart des équipes n'ajustent jamais.
- **Retries and agent steps (retries et étapes d'agent)** sont le multiplicateur discret de l'ère agentique : un agent qui boucle huit fois pour terminer une tâche coûte huit fois ce qu'un seul appel coûterait, et un modèle garde-fou ou juge qui vérifie chaque réponse, un pattern de qualité qui vaut bien la peine d'être adopté, double discrètement le nombre d'appels derrière une action utilisateur.

Aucune de ces décisions n'est prise par le procurement. Elles sont prises dans des pull requests, dans des templates de prompt, dans la configuration de récupération, et dans les conditions de boucle d'un agent, sprint après sprint. C'est tout l'argument en une phrase. **Rightsizer une instance est une tâche d'opérations ; rightsizer un prompt, un modèle et une boucle d'agent est une tâche d'ingénierie, ce qui signifie que le levier de coût s'est déplacé de l'équipe finance vers l'équipe de delivery.** Traiter la dépense LLM comme une ligne que la finance optimisera plus tard, c'est comme demander à la finance de rendre votre application plus rapide. Elle peut voir le nombre. Elle ne peut pas le bouger.

### Stop Watching the Bill, Start Watching Unit Cost

Une fois qu'on accepte que le coût est un output d'ingénierie, l'erreur suivante à éviter est de gouverner la mauvaise métrique. La facture totale est le nombre que tout le monde fixe, et à elle seule elle est presque inutile. Une facture qui a doublé ce trimestre peut signifier que vous mettez à l'échelle une fonctionnalité que les clients adorent, ou qu'une fuite d'argent vous fait gaspiller. Le total ne peut pas distinguer les deux.

Le nombre qui le peut est le coût unitaire : coût par requête, et mieux encore, coût par tâche résolue ou coût par résultat réussi (cost per resolved task ou cost per successful outcome). Choisissez l'unité de valeur que la fonctionnalité délivre réellement — un ticket de support résolu, un brouillon accepté, une réservation complétée — et divisez la dépense par cette unité.

![Illustrative line chart contrasting an unmanaged pipeline whose cost per resolved task keeps rising with a cost-engineered pipeline whose cost per resolved task falls release over release](https://rickpollick.com/images/finops-ai-unit-economics.png)

Un produit IA sain fait baisser le coût unitaire dans le temps, même tandis que la facture totale monte avec l'adoption. Un produit malsain laisse le coût unitaire dériver vers le haut, de sorte que chaque nouvel utilisateur rend l'économie pire. Le total a l'air identique dans les deux cas pendant un certain temps, ce qui est exactement pourquoi il trompe les gens. C'est le même point que l'auteur a fait dans [DORA metrics in the agentic era](https://rickpollick.com/blog/dora-metrics-agentic-era) : quand le monde sous votre dashboard se déplace, le confortable nombre de tête continue d'avoir l'air bien longtemps après avoir cessé de signifier ce que vous pensez qu'il signifie.

Le coût unitaire recadre aussi la conversation, du cost-cutting vers la valeur, ce qui est précisément la direction que prend la discipline. Les résultats du State of FinOps 2026 ont rebaptisé toute la pratique autour de la valeur technologique plutôt que des pures économies, et le coût par unité de valeur est le pont entre une décision d'ingénierie et une décision business. C'est aussi la métrique qui maintient un programme de coût honnête, parce qu'elle refuse de vous récompenser de simplement dépenser moins sur quelque chose que personne n'utilise. Si votre programme IA ne peut pas encore énoncer le coût d'une unité de la valeur qu'il produit, ce vide est le même que celui décrit dans [why your agentic AI strategy will fail without product thinking](https://rickpollick.com/blog/why-your-agentic-ai-strategy-will-fail-without-product-thinking) : vous optimisez l'activité au lieu des résultats.

### Make Cost a First-Class KPI, Not a Quarterly Surprise

Savoir que le coût est une métrique d'ingénierie n'est pas la même chose que le contrôler. Le contrôle vient d'une boucle, la même boucle operate-and-improve que le FinOps a toujours fait tourner pour le cloud, adaptée aux choses qui rendent l'IA différente.

![Diagram of a FinOps for AI control loop cycling through attribute, budget, gate, and optimize around a central label](https://rickpollick.com/images/finops-ai-governance-loop.png)

La boucle de contrôle FinOps for AI cycle à travers : attribuer, budgéter, gater et optimiser.

**Attribute first, because you cannot manage what you cannot see (attribuer d'abord, car on ne peut pas gérer ce qu'on ne peut pas voir).** La plupart des organisations reçoivent une facture IA unique et indifférenciée et n'ont aucune idée de quelle fonctionnalité, équipe ou client l'a pilotée. Corriger cela signifie taguer l'usage à la source : des métadonnées sur chaque appel de modèle, des clés ou projets séparés par fonctionnalité, et un mapping de la dépense vers l'équipe qui la possède. Tant que cela n'existe pas, chaque autre étape est de la devinette.

**Set budgets at design time (fixer les budgets dès la conception).** Un budget de tokens par fonctionnalité, ou un coût par requête cible convenu quand la fonctionnalité est spécifiée, transforme le coût d'une réflexion après coup en une exigence, de la même façon qu'un budget de performance plafonne le poids d'une page avant que quiconque ne livre.

**Gate the budget in delivery (gater le budget dans le delivery).** Vous faites presque certainement déjà tourner des evals avant une release IA ; mesurez le coût dans cette même exécution et faites échouer le build quand un changement dépasse son budget par requête, exactement comme vous le feriez échouer pour un score de qualité dégradé. Un budget que tout le monde peut discrètement dépasser sous la pression des délais n'est pas un budget. Le gate est ce qui le rend réel.

**Then optimize, with the levers that actually move the meter (puis optimiser, avec les leviers qui bougent réellement le compteur)** : right-sizer le modèle pour chaque tâche au lieu de prendre par défaut le plus capable, élaguer et mettre en cache le contexte (trim and cache context), mémoïser les appels répétés (memoize repeated calls), batcher quand la latence le permet, et mettre un plafond dur sur chaque boucle d'agent. Ce dernier point est l'endroit où le contrôle des coûts et la gouvernance deviennent le même problème. Quand un agent peut décider de lui-même de faire plus d'appels de modèle, une boucle non bornée est à la fois un risque de fiabilité et un coût galopant, ce qui est le trou de responsabilité décrit dans [the AI agent governance gap](https://rickpollick.com/blog/the-ai-agent-governance-gap). Un budget que quelqu'un a signé, appliqué par un plafond dans le code, est la façon de le combler.

### What To Do Before Your Next AI Release

Vous n'avez pas besoin d'une équipe plateforme ou d'une initiative procurement pour commencer. Vous avez besoin de traiter la prochaine release comme la première qui livre avec une étiquette de prix.

**Put a number on a single request (mettre un nombre sur une seule requête).** Prenez une fonctionnalité IA et calculez, de bout en bout, ce qu'une action utilisateur coûte aujourd'hui en tokens et en appels. La plupart des équipes ne l'ont jamais fait, et le nombre est généralement une surprise.

**Define the unit of value and track cost against it (définir l'unité de valeur et suivre le coût par rapport à elle).** Décidez ce qu'est un résultat réussi pour la fonctionnalité, puis surveillez le coût par résultat, pas le total mensuel.

**Set a per-request cost budget and wire it into your eval run (fixer un budget de coût par requête et le câbler dans votre run d'eval).** Réutilisez le gate de qualité que vous avez déjà, et ajoutez un seuil de coût à côté du seuil de qualité.

**Tag spend so you can attribute it (taguer la dépense pour pouvoir l'attribuer).** Même un tagging grossier par fonctionnalité bat une facture unique, et c'est généralement une journée de travail plutôt qu'un projet.

**Give every agent loop a hard ceiling (donner à chaque boucle d'agent un plafond dur).** Plafonnez les étapes et les appels de modèle qu'un agent peut faire par tâche, et alertez quand il atteint le plafond, pour qu'un mauvais prompt ne se transforme pas en un après-midi à quatre chiffres.

### The Honest Part

Des tokens moins chers ne sont pas une remise. Ce sont une invitation à dépenser plus, et la plupart des organisations l'acceptent sans s'en rendre compte. Le prix par token continuera de baisser, et la facture continuera de monter, parce que des prix qui baissent sont exactement ce qui fait venir plus d'usage à l'existence. Ce n'est pas un problème qu'on résout une fois ; c'est un compteur qu'on surveille continuellement.

Les équipes qui s'en sortiront en tête traiteront le coût des LLM de la façon dont les organisations d'ingénierie matures traitent déjà la latence et la fiabilité : comme une contrainte de conception possédée par les gens qui écrivent le code, mesurée par unité de valeur, et vérifiée avant la release plutôt qu'expliquée après l'arrivée de la facture. Le FinOps for AI n'est vraiment que du FinOps, comme aime à le dire la FinOps Foundation. La différence est que les contrôles ne vivent plus dans un contrat de procurement. Ils vivent dans votre architecture, vos prompts et vos pipelines. La facture va grandir de toute façon. La seule question qui vaille la peine d'être répondue est de savoir si elle grandit parce que votre produit gagne, ou parce que personne ne surveillait le compteur.

### References

- Stanford HAI. The 2025 AI Index Report. [hai.stanford.edu](https://hai.stanford.edu/ai-index/2025-ai-index-report)
- FinOps Foundation. The State of FinOps 2026. [data.finops.org](https://data.finops.org/)
- FinOps Foundation. FinOps for AI. [finops.org](https://www.finops.org/topic/finops-for-ai/)
- Menlo Ventures. 2024: The State of Generative AI in the Enterprise. [menlovc.com](https://menlovc.com/2024-the-state-of-generative-ai-in-the-enterprise/)

Tags de la source : FinOps for AI, LLM cost, AI cost management, token cost, unit economics, cost per token, engineering KPIs, cloud cost optimization, agentic AI, AI governance, software delivery, cost observability, showback, model right-sizing, digital transformation.

## Concepts clés
- **Paradoxe de Jevons appliqué aux tokens** : quand une ressource devient moins chère, l'usage augmente tellement que la dépense totale grimpe au lieu de baisser (prix unitaire ↓, dépense totale ↑).
- **« The bill is written in the codebase »** : le coût de l'IA est fixé par des décisions d'ingénierie et produit, pas de finance.
- **Décomposition du coût d'une requête IA** : requêtes × tokens par appel × prix par token × retries/étapes d'agent.
- **Quatre leviers de conception** : model selection (prix par token), context size (tokens d'entrée), output length (longueur de sortie), retries and agent steps (multiplicateur agentique).
- **Rightsizing comme tâche d'ingénierie** : rightsizer un prompt/modèle/boucle d'agent ≠ rightsizer une instance (opérations) → le levier de coût migre de la finance vers le delivery.
- **Coût unitaire vs facture totale** : cost per request, cost per resolved task, cost per successful outcome ; un produit sain fait baisser le coût unitaire dans le temps même si le total monte avec l'adoption.
- **Recadrage cost-cutting → valeur technologique** (technology value) : le coût par unité de valeur comme pont entre décision d'ingénierie et décision business.
- **Boucle de contrôle FinOps for AI (operate-and-improve)** : Attribute → Budget → Gate → Optimize.
  - Attribute : taguer l'usage à la source (métadonnées par appel, clés/projets par fonctionnalité, mapping vers l'équipe).
  - Budget at design time : budget de tokens / coût par requête cible défini à la spécification (analogie performance budget / page weight).
  - Gate in delivery : mesurer le coût dans le run d'eval et faire échouer le build au dépassement du budget par requête.
  - Optimize : right-sizing du modèle, trim & cache du contexte, mémoïsation des appels répétés, batching, plafond dur (hard ceiling) sur chaque boucle d'agent.
- **Hard ceiling sur les boucles d'agent** : convergence entre contrôle des coûts et gouvernance (boucle non bornée = risque de fiabilité + coût galopant).
- **Cinq actions avant la prochaine release** : chiffrer une requête, définir l'unité de valeur, fixer un budget par requête dans l'eval, taguer la dépense, plafonner chaque boucle d'agent.
- **« FinOps for AI really is just FinOps »** : la pratique est la même ; seuls les contrôles ont migré du contrat procurement vers l'architecture, les prompts et les pipelines.
- **Modèle garde-fou / juge** (guardrail / judge model) : pattern de qualité qui double le nombre d'appels par action utilisateur.
- Métriques DORA dans l'ère agentique ; product thinking ; AI agent governance gap (références aux autres billets de l'auteur).

## Citations et formulations notables
- (Intro) « Lower unit price, many more units, a much bigger bill. »
- (Intro, paradoxe de Jevons) « This is the trap almost every enterprise is walking into right now, and it has an old name from economics: the Jevons paradox. When a resource gets cheaper to use, people use so much more of it that total spending climbs instead of falling. »
- (Intro) « Prices fell through the floor. Spending went to the moon. »
- (Intro) « In two years it went from a rounding error to the headline. »
- (Intro) « You cannot manage this bill from the finance side, because almost nothing that drives it lives in finance. It lives in your codebase. »
- (The Bill Is Written in the Codebase) « Rightsizing an instance is an operations task; rightsizing a prompt, a model, and an agent loop is an engineering task, which means the cost lever has moved from the finance team to the delivery team. »
- (The Bill Is Written in the Codebase) « Treating LLM spend as a line item that finance will optimize later is like asking finance to make your application faster. They can see the number. They cannot move it. »
- (Stop Watching the Bill) « A healthy AI product drives unit cost down over time, even while the total bill rises with adoption. »
- (Make Cost a First-Class KPI) « Attribute first, because you cannot manage what you cannot see. »
- (Make Cost a First-Class KPI) « A budget that everyone can quietly exceed under deadline pressure is not a budget. The gate is what makes it real. »
- (What To Do) « ...so a bad prompt cannot turn into a four figure afternoon. » (un mauvais prompt qui se transforme en un après-midi à quatre chiffres)
- (The Honest Part) « Cheaper tokens are not a discount. They are an invitation to spend more, and most organizations are accepting it without noticing. »
- (The Honest Part) « That is not a problem you solve once; it is a meter you watch continuously. »
- (The Honest Part) « FinOps for AI really is just FinOps... The difference is that the controls no longer live in a procurement contract. They live in your architecture, your prompts, and your pipelines. »
- (The Honest Part) « The only question worth answering is whether it grows because your product is winning, or because nobody was watching the meter. »

## Données et chiffres clés
- **10× moins cher par token** : facteur de réduction du prix unitaire du modèle adopté par l'équipe plateforme.
- **−90 %** : réduction de coût annoncée au VP sur la base du prix d'une seule requête.
- **Facture triplée (×3)** en **six semaines** après le changement de modèle.
- **3 workflows supplémentaires** où la fonctionnalité a été câblée + fenêtre de contexte élargie + 1 second appel de modèle de vérification.
- **Stanford AI Index 2025** : coût d'inférence d'un système au niveau de GPT-3.5 passé d'**environ 20 $ par million de tokens fin 2022** à **7 cents fin 2024**, soit une baisse de **plus de 280×**.
- **Menlo Ventures** : dépense entreprise en IA générative de **2,3 milliards $ (2023)** → **13,8 milliards $ (2024)** → **37 milliards $ (2025)**.
- **State of FinOps 2026** (FinOps Foundation) : praticiens responsables de **plus de 83 milliards $** de dépense cloud ; **98 %** des répondants gèrent désormais de la dépense IA, contre **63 %** un an plus tôt et **31 %** l'année précédente. La gestion du coût IA désignée compétence n°1 à développer.
- **Écart de prix entre modèles** : un modèle frontier peut coûter **20 à 50× plus** par token qu'un petit modèle.
- **Boucle d'agent** : un agent qui boucle **8 fois** coûte **8×** le coût d'un appel unique ; un modèle juge/garde-fou **double** le nombre d'appels par action utilisateur.
- **Quinze ans** : durée pendant laquelle le FinOps cloud a porté surtout sur des leviers d'approvisionnement.
- Tagging par fonctionnalité estimé à **environ une journée de travail** plutôt qu'un projet.

## Liens connexes
- Topics : [[finops-ia]]
- Auteur : [Rick Pollick](../../by-author/rick-pollick/index.md)
- Date : [2026 (mois inconnu)](../../by-date/2026/unknown/index.md)
