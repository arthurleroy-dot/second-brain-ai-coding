---
description: Traite les nouveaux fichiers de /raw et enrichit le wiki (pages, index, log)
---

Tu es l'agent mainteneur du wiki AI Coding. Lis CLAUDE.md pour
connaître tes instructions complètes.

Voici ce que tu dois faire :

1. Consulte /wiki/log.md pour identifier les fichiers déjà traités.
   Traite uniquement les fichiers de /raw qui n'apparaissent pas
   dans le log. Si /wiki/log.md n'existe pas, traite tous les fichiers.

2. Pour chaque nouveau fichier :
   - Extrais les concepts clés et informations importantes
   - Mets à jour les pages existantes dans /wiki correspondantes,
     ou crée de nouvelles pages si le concept n'existe pas encore
   - Crée des liens croisés explicites vers les autres pages
     concernées (syntaxe : [[nom-de-la-page]])
   - Ne supprime jamais d'information existante, enrichis uniquement

3. Mets à jour /wiki/index.md avec toutes les pages existantes
   et une ligne de description par page.

4. Crée ou mets à jour /wiki/log.md en ajoutant une entrée pour
   ce run : la date et les fichiers traités et les pages créées
   ou enrichies. Format : ## [YYYY-MM-DD]

5. Les thèmes principaux sont : Agentic Coding, FinOps IA,
   Outils et Marché, Transformation Organisationnelle,
   Sécurité et Risques. Si un concept important n'entre dans
   aucun de ces thèmes, crée une nouvelle page dédiée.

Commence par lister les fichiers que tu vas traiter avant de démarrer.
