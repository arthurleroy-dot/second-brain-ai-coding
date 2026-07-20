# CLAUDE.md — AI Coding Second Brain

Wiki de veille sur l'AI coding + plateforme web. Ce fichier est la **carte** du
projet : il tient sur un écran et renvoie vers `docs/` pour le détail. Ne le
gonfle pas — toute spécification longue va dans `docs/`.

## Carte du projet

```
raw/     ← Couche 1 : sources brutes IMMUABLES (déposées, jamais modifiées)
wiki/    ← Couches 2 & 3 : resources/ (canonique) + vues dérivées + graph.json
           SEULE zone d'écriture de l'agent d'ingestion
web/     ← Plateforme Next.js : lit le wiki, chat, upload, ingestion LOCALE
docs/    ← Spécifications détaillées (lues à la demande)
tasks/   ← todo.md + lessons.md + specs/ (plans validés → implémentation)
```

> **Architecture LOCAL-FIRST (refonte 2026-07-20).** L'app est une application de
> bureau (Electron) : chacun a sa propre instance et son propre wiki EN LOCAL. Toutes
> les écritures (dépôt, arbitrages, suppression) et l'ingestion (agent IA embarqué)
> se font sur le disque local — plus de GitHub Action, plus de Supabase, plus de Vercel,
> plus d'auth mot de passe. GitHub ne sert qu'à distribuer les mises à jour. Accès IA :
> gateway LiteLLM de l'entreprise (clé partagée). Détails : `docs/platform.md` +
> `tasks/specs/2026-07-20-refonte-local-first-electron.md`.

## Règles cardinales

1. **Le markdown local = seule source de vérité du wiki.** L'historique de chat vit
   en fichiers JSON locaux (`<DATA_ROOT>/.data/conversations/`) ; JAMAIS de contenu
   wiki hors des fichiers markdown.
2. **`raw/` est immuable.** On y dépose, on n'y modifie/renomme/réorganise jamais
   rien. Le marqueur « déjà ingéré » vit dans `wiki/_ingested.json`. **Seule
   exception sanctionnée :** la _suppression_ d'une ressource via la plateforme
   retire aussi son fichier brut `raw/<source>` (+ sidecar + entrée manifeste),
   dans le même lot d'écritures — sinon l'ingestion ré-ingérerait la source. Moteur
   déterministe : `web/lib/wiki-mutate.ts` (voir [docs/entities.md](docs/entities.md) §7).
3. **`wiki/resources/*.md` est canonique.** Tout le reste sous `wiki/` (themes/,
   authors/, entities/, by-date/, types.md, origin/, index.md, graph.json) est
   une **vue dérivée** — jamais de contenu original dedans.
4. **L'agent d'ingestion n'écrit QUE sous `wiki/`.** Garde-fou déterministe
   (`canUseTool` scopé `wiki/`) dans `web/lib/ingest-local.ts` — toute écriture hors
   `wiki/` est refusée.
5. **Les slugs sont immuables** une fois assignés — les renommer casse les wikilinks.
6. **Fidélité > brièveté** : une ressource reproduit toute l'information de la
   source (chiffres, exemples, citations), paraphrasée mais non raccourcie.

## Où lire quoi

| Tu fais… | Lis d'abord |
|----------|-------------|
| Ingérer une source de `raw/` | [docs/ingestion.md](docs/ingestion.md) |
| Créer/éditer une ressource ou une vue | [docs/wiki-spec.md](docs/wiki-spec.md) |
| Relier une ressource à un outil/client/entité ou arbitrer un thème candidat | [docs/entities.md](docs/entities.md) |
| Répondre à une question sur le contenu | [docs/wiki-spec.md](docs/wiki-spec.md) §7 (requête par paliers) |
| Un lint du wiki | [docs/wiki-spec.md](docs/wiki-spec.md) §8 |
| Toucher au code de `web/` | [docs/platform.md](docs/platform.md) + [docs/code-workflow.md](docs/code-workflow.md) |
| N'importe quelle tâche de code | [docs/code-workflow.md](docs/code-workflow.md) (plan mode, subagents, vérif, lessons) |

Après toute correction de l'utilisateur, note le pattern dans
[tasks/lessons.md](tasks/lessons.md).
