---
slug: labor-market-impacts-ai-new-measure-early-evidence
title: "Labor market impacts of AI: A new measure and early evidence"
author: "Maxim Massenkoff and Peter McCrory"
date: "2026-03-05"
source_type: report-pdf
origin: externe
topics: [transformation-organisationnelle, labor-market-evolution]
entities: []
url: ""
source_file: "Nowcasting_Econ-Report-v16.pdf"
---

> Par [[../authors/maxim-massenkoff-and-peter-mccrory|Maxim Massenkoff and Peter McCrory]] · [[../by-date/2026/2026-03/2026-03|2026-03]] · Thèmes : [[../themes/transformation-organisationnelle|Transformation Organisationnelle]], [[../themes/labor-market-evolution|Labor Market Evolution]]

## Introduction et contexte méthodologique

`topics: [transformation-organisationnelle, labor-market-evolution]`

Les auteurs présentent un nouveau cadre d'analyse pour comprendre les impacts de l'IA sur le marché du travail, reconnaissant que les approches passées ont souvent échoué à prédire les transformations économiques. Par exemple, une étude influente avait identifié environ un quart des emplois américains comme vulnérables à la délocalisation, mais une décennie plus tard, la plupart de ces emplois ont maintenu une croissance d'emploi saine. Les prévisions de croissance occupationnelle du gouvernement, bien que directionnellement correctes, n'ont apporté que peu de valeur prédictive au-delà de l'extrapolation linéaire des tendances passées.

L'objectif de ce rapport est d'établir une approche pour mesurer comment l'IA affecte l'emploi et de revisiter périodiquement ces analyses. Cette approche ne capturera pas tous les canaux par lesquels l'IA pourrait remodeler le marché du travail, mais en posant ces bases maintenant, avant que des effets significatifs ne soient apparus, les auteurs espèrent que les résultats futurs identifieront plus fiablement les perturbations économiques que les analyses post-hoc.

## Approche par contrefactuels

`topics: [labor-market-evolution]`

L'inférence causale est plus facile lorsque les effets sont importants et soudains. La pandémie de COVID-19 et les mesures politiques qui l'ont accompagnée ont causé une perturbation économique si marquée que des approches statistiques sophistiquées n'étaient pas nécessaires pour de nombreuses questions. Par exemple, le chômage a fortement augmenté dans les premières semaines de la pandémie, laissant peu de place aux explications alternatives.

Les impacts de l'IA, cependant, pourraient être moins comme le COVID et davantage comme Internet ou le commerce avec la Chine. Les effets peuvent ne pas être immédiatement clairs à partir des données agrégées de chômage ; des facteurs comme la politique commerciale et le cycle économique pourraient brouiller les interprétations des tendances. Une approche courante consiste à comparer les résultats entre travailleurs, entreprises ou industries plus ou moins exposés à l'IA, afin d'isoler l'effet de l'IA des forces confondantes. L'exposition est généralement définie au niveau des tâches : l'IA peut corriger des devoirs mais pas gérer une classe, par exemple, donc les enseignants sont considérés comme moins exposés que les travailleurs dont l'ensemble du travail peut être effectué à distance.

## Mesure de l'exposition : sources de données

`topics: [transformation-organisationnelle]`

L'approche combine des données de trois sources principales :

- La base de données O*NET, qui énumère les tâches associées à environ 800 professions uniques aux États-Unis
- Les données d'usage propres des auteurs (mesurées dans l'Anthropic Economic Index)
- Les estimations d'exposition au niveau des tâches d'Eloundou et al. (2023), qui mesurent s'il est théoriquement possible pour un LLM de rendre une tâche au moins deux fois plus rapide

La métrique d'Eloundou et al., β, évalue les tâches sur une échelle simple : 1 si une tâche peut être doublée en vitesse par un LLM seul, 0,5 si elle nécessite des outils ou logiciels supplémentaires construits sur le LLM, et 0 sinon. Les mesures de capacité théorique et d'usage réel sont fortement corrélées : 97% des tâches observées dans les quatre derniers rapports de l'Economic Index tombent dans des catégories évaluées comme théoriquement faisables par Eloundou et al. (β=0,5 ou β=1,0). Les tâches notées β=1 (entièrement faisables pour un LLM seul) représentent 68% de l'usage observé de Claude, tandis que les tâches notées β=0 (non faisables) ne représentent que 3%.

Pourquoi l'usage réel pourrait-il être en deçà de la capacité théorique ? Certaines tâches théoriquement possibles peuvent ne pas apparaître dans l'usage en raison de limitations du modèle. D'autres peuvent être lentes à se diffuser en raison de contraintes légales, d'exigences logicielles spécifiques, d'étapes de vérification humaine ou d'autres obstacles. Par exemple, Eloundou et al. marquent "Autoriser les renouvellements de médicaments et fournir des informations sur les prescriptions aux pharmacies" comme entièrement exposé (β=1). Les auteurs n'ont pas observé Claude effectuer cette tâche, bien que l'évaluation semble correcte en ce qu'elle pourrait théoriquement être accélérée par un LLM.

## Mesure de l'exposition observée

`topics: [transformation-organisationnelle]`

La nouvelle mesure introduite, "Observed Exposure" (exposition observée), vise à quantifier : parmi les tâches que les LLM pourraient théoriquement accélérer, lesquelles voient réellement un usage automatisé dans des contextes professionnels ? La capacité théorique englobe une gamme beaucoup plus large de tâches. En suivant comment cet écart se réduit, l'exposition observée fournit un aperçu des changements économiques à mesure qu'ils émergent.

La mesure capture qualitativement plusieurs aspects de l'usage de l'IA qui sont prédictifs des impacts sur l'emploi. L'exposition d'un emploi est plus élevée si :

- Ses tâches sont théoriquement possibles avec l'IA
- Ses tâches voient un usage significatif dans l'Anthropic Economic Index
- Ses tâches sont effectuées dans des contextes liés au travail
- Il a une part relativement plus élevée de modèles d'usage automatisés ou d'implémentation API
- Ses tâches impactées par l'IA constituent une plus grande part du rôle global

Les auteurs comptent les tâches théoriquement capables avec un LLM comme couvertes si elles ont vu un usage suffisant lié au travail dans le trafic de Claude. Ils ajustent ensuite pour la façon dont la tâche est effectuée : les implémentations entièrement automatisées reçoivent un poids complet, tandis que l'usage augmentatif reçoit la moitié du poids. Enfin, les mesures de couverture au niveau des tâches sont moyennées au niveau de la profession, pondérées par la fraction de temps passée sur chaque tâche.

## Écart entre capacité théorique et exposition observée par catégorie

`topics: [transformation-organisationnelle, labor-market-evolution]`

L'exposition observée (en rouge) comparée à β d'Eloundou et al. (en bleu) illustre la différence entre usage théorique et réel sur la plateforme, regroupés par grandes catégories professionnelles. Les auteurs calculent cela en moyennant d'abord au niveau de la profession en pondérant par leur mesure de fraction de temps, puis en moyennant à la catégorie professionnelle en pondérant par l'emploi total.

La mesure β montre une marge de pénétration des LLM dans la majorité des tâches dans les professions Informatique & Mathématiques (94%) et Bureau & Administration (90%). L'aire rouge, représentant l'usage de LLM de l'Anthropic Economic Index, montre comment les gens utilisent Claude dans des contextes professionnels. La couverture montre que l'IA est loin d'atteindre ses capacités théoriques. Par exemple, Claude couvre actuellement seulement 33% de toutes les tâches dans la catégorie Informatique & Mathématiques.

À mesure que les capacités progressent, que l'adoption se répand et que le déploiement s'approfondit, l'aire rouge grandira pour couvrir le bleu. Il existe également une grande zone non couverte ; de nombreuses tâches, bien sûr, restent au-delà de la portée de l'IA — du travail agricole physique comme la taille des arbres et l'exploitation de machines agricoles aux tâches juridiques comme la représentation de clients devant les tribunaux.

## Professions les plus exposées

`topics: [labor-market-evolution]`

Les dix professions les plus exposées selon cette mesure sont :

1. Programmeurs informatiques - 75% de couverture
2. Représentants du service client - dont les tâches principales sont de plus en plus vues dans le trafic API de première partie
3. Opérateurs de saisie de données - 67% de couverture, dont la tâche principale de lire des documents sources et d'entrer des données voit une automatisation significative
4-10. Autres professions avec niveaux de couverture décroissants

À l'extrémité inférieure, 30% des travailleurs ont une couverture nulle, car leurs tâches sont apparues trop rarement dans les données pour atteindre le seuil minimum. Ce groupe comprend, par exemple, les cuisiniers, mécaniciens de motos, sauveteurs, barmans, plongeurs et préposés aux vestiaires.

## Corrélation avec les projections de croissance de l'emploi

`topics: [labor-market-evolution]`

Le Bureau of Labor Statistics (BLS) des États-Unis publie régulièrement des projections d'emploi, la dernière série, publiée en 2025, couvrant les changements prévus dans l'emploi pour chaque profession de 2024 à 2034. Les auteurs comparent leur mesure de couverture au niveau de l'emploi à leurs prédictions.

Une régression au niveau de la profession pondérée par les niveaux d'emploi actuels révèle que les projections de croissance sont quelque peu plus faibles pour les emplois avec plus d'exposition observée. Pour chaque augmentation de 10 points de pourcentage de la couverture, la projection de croissance du BLS diminue de 0,6 points de pourcentage. Cela fournit une certaine validation en ce que les mesures suivent les estimations dérivées indépendamment des analystes du marché du travail, bien que la relation soit légère. Il est intéressant de noter qu'il n'y a pas de telle corrélation en utilisant la seule mesure d'Eloundou et al.

## Caractéristiques des travailleurs exposés

`topics: [labor-market-evolution]`

Les auteurs examinent les caractéristiques des travailleurs dans le quartile supérieur d'exposition et les 30% de travailleurs avec une exposition nulle dans les trois mois avant la sortie de ChatGPT, d'août à octobre 2022, en utilisant les données de la Current Population Survey. Les groupes sont très différents :

Le groupe le plus exposé est :
- 16 points de pourcentage plus susceptible d'être féminin
- 11 points de pourcentage plus susceptible d'être blanc
- Presque deux fois plus susceptible d'être asiatique
- Gagne 47% de plus en moyenne
- A des niveaux d'éducation plus élevés

Par exemple, les personnes avec des diplômes d'études supérieures représentent 4,5% du groupe non exposé, mais 17,4% du groupe le plus exposé, une différence de près de quatre fois.

## Priorisation des résultats : focus sur le chômage

`topics: [labor-market-evolution]`

Avec ces mesures d'exposition en main, la question est de savoir quoi rechercher. Les chercheurs ont adopté différentes approches. Gimbel et al. (2025) suivent les changements dans le mix professionnel en utilisant la Current Population Survey, arguant que toute restructuration importante de l'économie due à l'IA se manifesterait par des changements dans la distribution des emplois (ils constatent que, jusqu'à présent, les changements ont été peu remarquables). Brynjolfsson et al. (2025) examinent les niveaux d'emploi divisés par groupe d'âge en utilisant les données de la société de traitement de la paie ADP, tandis qu'Acemoglu et al. (2022) et Hampole et al. (2025) utilisent respectivement les données d'offres d'emploi de Burning Glass (maintenant Lightcast) et Revelio.

Les auteurs se concentrent sur le chômage comme résultat prioritaire car il capture le plus directement le potentiel de préjudice économique — un travailleur qui est au chômage veut un emploi et n'en a pas encore trouvé. Dans ce cas, les offres d'emploi et l'emploi ne signalent pas nécessairement la nécessité de réponses politiques ; une baisse des offres d'emploi pour un rôle hautement exposé peut être contrebalancée par une augmentation des ouvertures dans un rôle connexe. Les développements les plus nuisibles du marché du travail dus à l'IA devraient sans doute inclure une période d'augmentation du chômage, alors que les travailleurs déplacés cherchent des alternatives.

La Current Population Survey est bien adaptée pour suivre cela, car les répondants au chômage déclarent leur emploi et leur industrie précédents.

## Résultats initiaux : tendances du chômage

`topics: [labor-market-evolution]`

Les auteurs étudient ensuite les tendances du chômage, en faisant correspondre leurs mesures au niveau de la profession aux répondants de la Current Population Survey. Une question clé dans l'interprétation de la mesure de couverture est : quels travailleurs devraient être considérés comme traités ? Des changements d'emploi devraient-ils être attendus avec seulement 10% de couverture de tâches ?

Gans et Goldfarb (2025) montrent que si un modèle O-ring décrit le mieux les emplois, les effets sur l'emploi pourraient n'être visibles que lorsque toutes les tâches ont un certain degré de pénétration de l'IA. Hampole et al. (2025) soutiennent que l'exposition moyenne diminue la demande de travail, mais la concentration de l'exposition dans certaines tâches seulement peut contrecarrer cela. Et Autor et Thompson (2025) mettent en évidence le niveau d'expertise requis pour les tâches restantes.

Dans un souci de simplicité, et notant que les auteurs sont le plus préoccupés par les impacts importants, ils centrent leur analyse sur l'idée que les impacts devraient être ressentis le plus dans les groupes avec l'exposition moyenne la plus élevée. Ils comparent les travailleurs dans le quartile supérieur de couverture de tâches pondérée par le temps à ceux dans le quartile inférieur.

Le panneau supérieur montre les tendances brutes du taux de chômage depuis 2016 pour les travailleurs dans le quartile supérieur d'exposition et le groupe non exposé. Pendant le COVID, les travailleurs moins exposés à l'IA — qui sont plus susceptibles d'avoir des emplois en personne — ont connu une augmentation beaucoup plus importante du chômage. Depuis lors, les tendances ont été largement similaires entre les deux groupes.

Le panneau inférieur mesure la taille de l'écart entre les travailleurs les plus et les moins exposés dans un cadre de différence-en-différences, reflétant les résultats des données brutes. Le changement moyen de l'écart depuis la sortie de ChatGPT est petit et non significatif, suggérant que le taux de chômage du groupe le plus exposé a légèrement augmenté mais l'effet est indiscernable de zéro.

## Scénarios détectables par ce cadre

`topics: [labor-market-evolution]`

Quel type de scénarios ce cadre peut-il identifier ? Sur la base de l'intervalle de confiance de l'estimation groupée, des augmentations différentielles du chômage de l'ordre de 1 point de pourcentage seraient détectables (cela changera à mesure que de nouvelles données arrivent, c'est donc simplement une estimation approximative).

Si tous les travailleurs dans les 10% supérieurs de couverture étaient licenciés, cela augmenterait le chômage dans le groupe du quartile supérieur de 3% à 43%, et cela augmenterait le chômage agrégé de 4% à 13%.

Un impact plus petit mais toujours préoccupant serait un scénario tel qu'une "Grande Récession pour les travailleurs cols blancs". Pendant la Grande Récession de 2007-2009, les taux de chômage ont doublé de 5% à 10% aux États-Unis. Un tel doublement dans le quartile supérieur d'exposition augmenterait son taux de chômage de 3% à 6%. Cela devrait également être visible dans l'analyse.

L'estimation centrale est basée sur les changements différentiels du taux de chômage dans le groupe exposé par rapport au groupe moins exposé. Si le chômage augmentait pour tous les travailleurs en parallèle, les auteurs ne l'attribueraient pas aux avancées de l'IA qui laissent encore de nombreuses tâches non affectées.

## Cas particulier : jeunes travailleurs et ralentissement de l'embauche

`topics: [labor-market-evolution]`
`entities: [chatgpt]`

Un groupe particulièrement préoccupant est celui des jeunes travailleurs. Brynjolfsson et al. rapportent une baisse de 6 à 16% de l'emploi dans les professions exposées parmi les travailleurs âgés de 22 à 25 ans. Ils attribuent cette diminution principalement à un ralentissement de l'embauche plutôt qu'à une augmentation des séparations.

Les auteurs constatent que le taux de chômage pour les jeunes travailleurs dans les professions exposées est stable. Mais le ralentissement de l'embauche peut ne pas nécessairement se manifester comme une augmentation du chômage, puisque de nombreux jeunes travailleurs sont des entrants sur le marché du travail sans profession répertoriée dans les données CPS et peuvent sortir de la population active plutôt que d'apparaître comme chômeurs.

Pour aborder directement l'embauche, les auteurs utilisent la dimension de panel du CPS, en comptant le pourcentage de jeunes travailleurs (22-25 ans) qui commencent un nouveau travail dans une profession plus ou moins exposée au fil du temps. La figure montre le taux mensuel de démarrage d'emploi (c'est-à-dire lorsqu'un travailleur signale un emploi qu'il n'avait pas le mois précédent) pour les jeunes travailleurs, divisé selon qu'ils entrent dans une profession à exposition élevée ou faible.

Outre quelques grandes fluctuations en 2020-2021, ces séries divergent visuellement en 2024, les jeunes travailleurs étant relativement moins susceptibles d'être embauchés dans des professions exposées. Les taux de recherche d'emploi dans les professions moins exposées restent stables à 2% par mois, tandis que l'entrée dans les emplois les plus exposés diminue d'environ un demi-point de pourcentage. L'estimation moyenne à l'ère post-ChatGPT est une baisse de 14% du taux de recherche d'emploi par rapport à celui de 2022 dans les professions exposées, bien que cela soit juste significatif statistiquement. (Il n'y a pas de telle diminution pour les travailleurs de plus de 25 ans.)

Cela peut fournir un certain signal des effets précoces de l'IA sur l'emploi, et fait écho aux résultats de Brynjolfsson et al. Mais il existe plusieurs interprétations alternatives. Les jeunes travailleurs qui ne sont pas embauchés peuvent rester à leurs emplois existants, prendre des emplois différents ou retourner à l'école. Une autre réserve liée aux données est que les transitions d'emploi peuvent être plus vulnérables à une erreur de mesure dans les enquêtes.

## Discussion et perspectives futures

`topics: [transformation-organisationnelle, labor-market-evolution]`

Ce rapport introduit une nouvelle mesure pour comprendre les effets de l'IA sur le marché du travail et étudie les impacts sur le chômage et l'embauche. Les emplois sont plus exposés à l'IA dans la mesure où leurs tâches sont théoriquement faisables avec les LLM et observées sur les plateformes dans des cas d'usage automatisés et liés au travail.

Les auteurs constatent que les programmeurs informatiques, les représentants du service client et les analystes financiers figurent parmi les plus exposés. En utilisant les données d'enquête des États-Unis, ils ne trouvent aucun impact sur les taux de chômage pour les travailleurs dans les professions les plus exposées, bien qu'il y ait des preuves provisoires que l'embauche dans ces professions a légèrement ralenti pour les travailleurs âgés de 22 à 25 ans.

Ce travail est une première étape vers la catalogage de l'impact de l'IA sur le marché du travail. Les auteurs espèrent que les étapes analytiques prises dans ce rapport, en particulier autour de la couverture et des contrefactuels, seront faciles à mettre à jour à mesure que de nouvelles données sur l'emploi et l'usage de l'IA émergent. Une approche établie peut aider les observateurs futurs à séparer le signal du bruit.

## Améliorations futures et limites

`topics: [transformation-organisationnelle]`

Il existe plusieurs améliorations à apporter au présent travail :

- Les données d'usage seront incorporées dans les mises à jour futures, formant une image évolutive de la couverture des tâches et des emplois dans l'économie
- La métrique d'Eloundou et al. pourrait également être mise à jour, dans la mesure où elle est liée aux capacités des LLM début 2023
- Étant donné les résultats suggestifs autour des jeunes travailleurs et des entrants sur le marché du travail, une prochaine étape clé pourrait être d'examiner comment les récents diplômés avec des qualifications éducatives dans les domaines exposés naviguent sur le marché du travail

Les données de couverture observée au niveau de la tâche et de l'emploi sont disponibles publiquement sur Hugging Face.
