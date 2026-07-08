# Entités candidates

Sas de décision humaine pour les entités **non reconnues** détectées à
l'ingestion (écriture absente des `label`/`aliases` du registre). Elles ne sont
**pas** créées automatiquement.

Pour chaque entrée : coche **une** case, précise `entity_type` si tu crées
l'entité, puis relance l'ingestion (`workflow_dispatch`). L'agent applique les
décisions cochées, crée les liens rétroactivement et purge les entrées traitées.

Ce canal est distinct de `needs_review` (réservé à l'ambiguïté d'origin).

---

<!-- Format d'une entrée :

## <écriture détectée>
- Vu dans : [[../resources/<slug>#section]] ("…contexte de la mention…")
- Ressemble à : [[<slug-existant>]] ?   (ou : aucune correspondance)
- Décision : ☐ fusionner comme alias de `<slug>` · ☐ créer l'entité (entity_type: ?) · ☐ rejeter

-->

## Cursor
- Vu dans : [[../resources/unlocking-value-ai-software-development#two-key-shifts-to-unlock-ais-full-potential-in-software-development]] ("Cursor, start-up AI-native, fonctionne comme laboratoire interne pour les workflows d'ingénierie IA ; Bugbot, Plan Mode, agents en arrière-plan ; citation de Michael Truell, CEO et cofondateur de Cursor")
- Vu dans : [[../resources/microsoft-google-late-ai-coding-compete-growth#concurrence-elargie-cursor-spacex-et-le-marche-en-pleine-ebullition]] ("Cursor a signé un accord avec SpaceX lui donnant une option d'acquisition à 60 Md$ ; passé de 4 M$ à 2 Md$ d'ARR en 18 mois, un des éditeurs cloud à plus forte croissance")
- Ressemble à : aucune correspondance dans le registre
- Décision : ☐ fusionner comme alias de `<slug>` · ☐ créer l'entité (entity_type: ?) · ☐ rejeter

## GitHub Copilot
- Écritures détectées : « GitHub Copilot », « Copilot ». (Note : l'occurrence « Fountain Copilot » dans [[../resources/2026-agentic-coding-trends-report]] est un faux positif — produit propre du client Fountain, non lié à GitHub Copilot — donc non retenue.)
- Vu dans : [[../resources/ai-software-development-what-changes-2026-2035#ai-is-already-writing-half-the-code]] ("GitHub Copilot compte 20 millions d'utilisateurs et est déployé dans 90 % des Fortune 100 ; l'IA génère 46 % du code dans les fichiers où Copilot est actif, jusqu'à 61 % pour Java")
- Vu dans : [[../resources/microsoft-google-late-ai-coding-compete-growth#customer-choice-pas-de-lock-in-vendor-marche-fragmente]] ("via GitHub Copilot les développeurs accèdent aux modèles Anthropic, Google et OpenAI ; lancé en 2021 en s'appuyant sur OpenAI, pionnier mais a perdu de l'élan face à Cursor et Claude Code")
- Ressemble à : aucune correspondance dans le registre
- Décision : ☐ fusionner comme alias de `<slug>` · ☐ créer l'entité (entity_type: ?) · ☐ rejeter

## Windsurf
- Vu dans : [[../resources/microsoft-google-late-ai-coding-compete-growth#concurrence-elargie-cursor-spacex-et-le-marche-en-pleine-ebullition]] ("Google a signé l'an dernier un accord de licence de 2,4 Md$ pour la technologie de Windsurf et a recruté le CEO de la startup, Varun Mohan, ainsi que des chercheurs clés")
- Ressemble à : aucune correspondance dans le registre
- Décision : ☐ fusionner comme alias de `<slug>` · ☐ créer l'entité (entity_type: ?) · ☐ rejeter
