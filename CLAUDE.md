# CLAUDE.md — AI Coding Second Brain

Wiki de veille sur l'AI coding + plateforme web. Ce fichier est la **carte** du
projet : il tient sur un écran et renvoie vers `docs/` pour le détail. Ne le
gonfle pas — toute spécification longue va dans `docs/`.

## Carte du projet

```
raw/     ← Couche 1 : sources brutes IMMUABLES (déposées, jamais modifiées)
wiki/    ← Couches 2 & 3 : resources/ (canonique) + vues dérivées + graph.json
           SEULE zone d'écriture de l'agent d'ingestion
web/     ← Plateforme Next.js : lit le wiki (markdown), chat, upload
docs/    ← Spécifications détaillées (lues à la demande)
tasks/   ← todo.md (plan courant) + lessons.md (leçons des corrections)
```

## Règles cardinales

1. **Git markdown = seule source de vérité du wiki.** Supabase ne stocke QUE les
   données applicatives (conversations/messages du chat, comptes). Jamais de
   contenu wiki en base.
2. **`raw/` est immuable.** On y dépose, on n'y modifie/renomme/réorganise jamais
   rien. Le marqueur « déjà ingéré » vit dans `wiki/_ingested.json`.
3. **`wiki/resources/*.md` est canonique.** Tout le reste sous `wiki/` (themes/,
   authors/, entities/, by-date/, types.md, origin.md, index.md, graph.json) est
   une **vue dérivée** — jamais de contenu original dedans.
4. **L'agent d'ingestion n'écrit QUE sous `wiki/`.** C'est ce qui empêche la
   boucle de la GitHub Action (filtrée sur `raw/**`).
5. **Les slugs sont immuables** une fois assignés — les renommer casse les wikilinks.
6. **Fidélité > brièveté** : une ressource reproduit toute l'information de la
   source (chiffres, exemples, citations), paraphrasée mais non raccourcie.

## Où lire quoi

| Tu fais… | Lis d'abord |
|----------|-------------|
| Ingérer une source de `raw/` | [docs/ingestion.md](docs/ingestion.md) |
| Créer/éditer une ressource ou une vue | [docs/wiki-spec.md](docs/wiki-spec.md) |
| Relier une ressource à un outil/client/entité | [docs/entities.md](docs/entities.md) |
| Répondre à une question sur le contenu | [docs/wiki-spec.md](docs/wiki-spec.md) §7 (requête par paliers) |
| Un lint du wiki | [docs/wiki-spec.md](docs/wiki-spec.md) §8 |
| Toucher au code de `web/` | [docs/platform.md](docs/platform.md) + [docs/code-workflow.md](docs/code-workflow.md) |
| N'importe quelle tâche de code | [docs/code-workflow.md](docs/code-workflow.md) (plan mode, subagents, vérif, lessons) |

Après toute correction de l'utilisateur, note le pattern dans
[tasks/lessons.md](tasks/lessons.md).
