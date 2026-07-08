# TODO

Plan de travail courant. Coche les items au fur et à mesure ; ajoute une section
« Review » en fin de chantier (résumé de ce qui a été fait + vérifications).

Voir les règles dans [../docs/code-workflow.md](../docs/code-workflow.md).

## En cours : plateforme git-first + ingestion automatisée

- [x] Phase 0 — Committer la migration wiki (structure 3 couches figée)
- [x] Phase 1 — Restructuration doc agent (CLAUDE.md court + docs/ + tasks/)
- [x] Phase 2 — Manifeste `_ingested.json` + GitHub Action d'ingestion
- [x] Phase 3 — Système d'entités (registre, candidates, rétro-annotation)
- [x] Phase 4 — La plateforme lit le markdown (wiki-parser/query fs, PDF proxy)
- [x] Phase 5 — Upload → commit GitHub (github.ts, route upload, IngestStatus)
- [x] Phase 6 — Chat sur le markdown (chat-context fs)
- [x] Phase 7 — Nettoyage Supabase (drop tables wiki)
- [x] Phase 8 — Déploiement Vercel + protection mot de passe

## Review

Les 8 phases sont implémentées et committées en local (10 commits, de `5e4514e`
à `0464fab`). Build `npm run build` vert à chaque phase.

**Vérifié en dev :** 13 sources lues depuis le markdown ; compteurs thèmes/types/
auteurs corrects ; proxy PDF (noms simples et complexes) ; iframe dans les fiches ;
wikilinks convertis ; chat — « Deloitte + agents » remonte le rapport Deloitte,
« Claude Code » remonte les 6 ressources liées à l'entité, filtres respectés ;
auth — redirection /login, mauvais/bon mot de passe, cookie valide/falsifié.

**Non vérifiable en local (dépend de secrets/déploiement fournis par l'humain) :**
run réel de l'Action d'ingestion (nécessite `ANTHROPIC_API_KEY` + push) ; commit
d'upload réel (nécessite `GITHUB_TOKEN`) ; exécution du SQL de migration Supabase ;
compatibilité CLI Claude Code ↔ proxy LiteLLM.

**Reste à faire côté humain :** pousser les commits sur `main` ; poser les secrets
GitHub Actions + variables Vercel ; créer le PAT GitHub ; exécuter le SQL de
migration ; trancher les 3 entités candidates (Cursor, GitHub Copilot, Windsurf).

**Leçon clé :** ne pas mettre de deny bloquants dans le `.claude/settings.json`
partagé (voir [lessons.md](lessons.md)) — le garde-fou de l'Action vit dans
`.github/ingest-settings.json` chargé via `--settings`.
