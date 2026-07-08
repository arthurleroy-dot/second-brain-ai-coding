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
