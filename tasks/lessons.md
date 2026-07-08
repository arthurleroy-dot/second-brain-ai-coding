# Lessons

Journal des leçons tirées des corrections de l'utilisateur. Après **toute**
correction, ajoute ici le pattern + la règle pour ne pas refaire l'erreur. Relis
ce fichier en début de session.

Format :

```
## <date> — <titre court>
**Contexte :** ce qui s'est passé.
**Correction :** ce que l'utilisateur a demandé à la place.
**Règle :** ce que je fais désormais systématiquement.
```

---

## 2026-07-08 — Git = seule source de vérité du wiki
**Contexte :** l'ancienne plateforme écrivait le wiki dans Supabase, créant une
seconde source de vérité désynchronisée du markdown.
**Correction :** le wiki markdown versionné dans git est la SEULE source de
vérité ; Supabase ne garde que conversations/messages/comptes.
**Règle :** ne jamais persister de contenu wiki dans Supabase. La plateforme lit
le markdown. Toute écriture de contenu passe par un commit dans `raw/` puis
l'agent d'ingestion (qui n'écrit que dans `wiki/`).

## 2026-07-08 — CLAUDE.md doit rester court
**Contexte :** CLAUDE.md faisait 261 lignes, chargé intégralement à chaque session.
**Correction :** CLAUDE.md court (carte + règles cardinales + renvois) ; le détail
dans `docs/*` que les agents ne lisent que si nécessaire.
**Règle :** ne pas gonfler CLAUDE.md ; toute spec détaillée va dans `docs/`.

## 2026-07-08 — Ne pas mettre de deny bloquants dans le `.claude/settings.json` committé
**Contexte :** j'avais mis `Write/Edit(web/**, .github/**, .claude/**, …)` en deny
dans le `.claude/settings.json` versionné comme « double ceinture » pour l'Action
d'ingestion. Mais ce fichier s'applique à TOUTES les sessions du repo : il a fini
par bloquer mes propres éditions de `web/` (dev), et il se protège lui-même
(`Edit(.claude/**)`), créant un lockout impossible à corriger en auto-mode.
**Correction :** les restrictions spécifiques à un run headless doivent vivre dans
un fichier dédié chargé via `claude --settings <file>` (ex. `.github/ingest-settings.json`),
PAS dans le `.claude/settings.json` partagé. L'invariant anti-boucle est de toute
façon garanti par `git add wiki/` seul dans l'Action.
**Règle :** ne jamais committer dans `.claude/settings.json` un deny qui couvre des
chemins de dev (`web/**`, `.github/**`, `.claude/**`). Scoper les restrictions d'un
agent headless via `--settings`. Vérifier après coup que je peux toujours éditer
les zones de travail.
