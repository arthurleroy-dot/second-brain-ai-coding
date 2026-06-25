---
description: Audit complet du wiki (pages orphelines, contradictions, sources incomplètes) avec rapport priorisé
allowed-tools: Read, Glob, Grep, Write, Edit
---

Fais un audit complet du wiki. Vérifie :
- Les pages orphelines (aucun lien entrant depuis une autre page)
- Les contradictions entre pages
- Les concepts mentionnés dans plusieurs pages mais sans page dédiée
- Les cross-références manquantes évidentes
- Les sources sans URL ou sans date

Produis un rapport dans /wiki/lint-report.md avec la date et la liste des problèmes trouvés, classés par priorité.
