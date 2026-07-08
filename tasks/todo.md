# TODO

Plan de travail courant. Coche les items au fur et à mesure ; ajoute une section
« Review » en fin de chantier (résumé de ce qui a été fait + vérifications).

Voir les règles dans [../docs/code-workflow.md](../docs/code-workflow.md).

## En cours : plateforme git-first + ingestion automatisée

- [x] Phase 0 — Committer la migration wiki (structure 3 couches figée)
- [ ] Phase 1 — Restructuration doc agent (CLAUDE.md court + docs/ + tasks/)
- [ ] Phase 2 — Manifeste `_ingested.json` + GitHub Action d'ingestion
- [ ] Phase 3 — Système d'entités (registre, candidates, rétro-annotation)
- [ ] Phase 4 — La plateforme lit le markdown (wiki-parser/query fs, PDF proxy)
- [ ] Phase 5 — Upload → commit GitHub (github.ts, route upload, IngestStatus)
- [ ] Phase 6 — Chat sur le markdown (chat-context fs)
- [ ] Phase 7 — Nettoyage Supabase (drop tables wiki)
- [ ] Phase 8 — Déploiement Vercel + protection mot de passe

## Review

_(à compléter en fin de chantier)_
