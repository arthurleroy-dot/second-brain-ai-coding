---
slug: point-equipe-plateforme-etat-de-notre-pratique-du-coding-assiste-par-ia
title: "Point d'équipe plateforme — état de notre pratique du coding assisté par IA"
author: ""
date: ""
source_type: meeting-notes
origin: interne
topics: [agentic-coding, outils-et-marche, finops-ia, context-engineering, securite-et-risques, transformation-organisationnelle]
entities: []
url: ""
source_file: "note-3.txt"
---

> Thèmes : [[../themes/agentic-coding|Agentic Coding]], [[../themes/outils-et-marche|Outils et Marché]], [[../themes/finops-ia|FinOps IA]], [[../themes/context-engineering|Context Engineering]], [[../themes/securite-et-risques|Sécurité et Risques]], [[../themes/transformation-organisationnelle|Transformation Organisationnelle]]

Point d'équipe plateforme — état de notre pratique du coding assisté par IA

Notes prises après la rétro trimestrielle. À ranger.

## Outils en place

`topics: [agentic-coding, outils-et-marche]`
`entities: [claude-code, n8n, supabase, databricks]`

- On a généralisé Claude Code comme agent principal en terminal : il lit le repo, planifie, écrit et corrige tout seul sur plusieurs fichiers à la fois. Le passage à des agents qui codent en autonomie, et non plus à de la simple autocomplétion, a vraiment changé notre façon de bosser.
- Deux devs ont testé Cursor en parallèle pour comparer l'expérience dans l'éditeur ; un autre reste sur GitHub Copilot par habitude. On a donc trois outils en concurrence à trancher.
- Nos automatisations internes tournent sur n8n (webhooks, relances, synchro), la donnée applicative est sur Supabase, et les gros jeux analytiques restent sur Databricks.

## Ce qui marche, ce qui coince

`topics: [finops-ia, context-engineering, securite-et-risques]`

1. Le coût. Le poste "tokens" explose. On paie à la requête et les agents autonomes consomment énormément dès que le contexte est mal maîtrisé. Il nous faut un vrai suivi FinOps du budget IA : coût par ressource, plafond mensuel, alertes de dépassement. Sans ça, on ne pilote rien.
2. Le contexte. La qualité des réponses dépend surtout de CE QU'ON MET dans la fenêtre de contexte : quels fichiers, quelles specs, quel historique on fournit. On perd un temps fou à cadrer ça à la main. Savoir composer le bon contexte est devenu plus déterminant qu'un prompt bien tourné.
3. La dette technique. Ça revient à chaque rétro : les agents produisent beaucoup de code très vite, mais une partie est bricolée, dupliquée ou mal testée. On accumule une dette technique générée par l'IA qu'on ne voit pas passer. Il faut une politique de revue systématique du code produit par les agents.
4. L'empreinte. Point soulevé par la RSE : la sobriété numérique de tous ces appels modèle. On n'a aucune mesure de l'empreinte environnementale de notre usage, alors que le volume grimpe. À creuser sérieusement.

## Décisions

`topics: [transformation-organisationnelle, finops-ia, context-engineering]`

- Nommer un référent FinOps IA d'ici la fin du mois.
- Écrire un guide interne de cadrage du contexte.
- Ajouter une étape de revue dédiée au code d'agent.
