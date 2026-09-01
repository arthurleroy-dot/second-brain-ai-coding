# CLAUDE.md — AI Coding Second Brain

Wiki de veille sur l'AI coding + plateforme web. Ce fichier est la **carte** du
projet : il tient sur un écran et renvoie vers `docs/` pour le détail. Ne le
gonfle pas — toute spécification longue va dans `docs/`.

## Carte du projet

```
raw/     ← Couche 1 : sources brutes IMMUABLES (déposées, jamais modifiées)
wiki/    ← Couches 2 & 3 : resources/ (canonique) + vues dérivées + graph.json
           SEULE zone d'écriture de l'ingestion (moteur déterministe)
web/     ← Plateforme Next.js : lit le wiki, chat, upload, ingestion LOCALE
docs/    ← Spécifications détaillées (lues à la demande)
tasks/   ← todo.md + lessons.md + specs/ (plans validés → implémentation)
```

> **Architecture LOCAL-FIRST (refonte 2026-07-20).** L'app est une application de
> bureau (Electron) : chacun a sa propre instance et son propre wiki EN LOCAL. Toutes
> les écritures (dépôt, arbitrages, suppression) et l'ingestion (un appel IA + un
> moteur déterministe) se font sur le disque local — plus de GitHub Action, plus de
> Supabase, plus de Vercel, plus d'auth mot de passe. GitHub ne sert qu'à distribuer
> les binaires de l'app (téléchargement manuel du `.dmg`/`.exe` ; pas d'auto-updater
> en v1). Accès IA : écran de réglages par utilisateur (`/reglages`) — Anthropic en
> direct OU une passerelle compatible (gateway LiteLLM), chacun sa clé. Détails :
> `docs/platform.md` + `tasks/specs/2026-07-20-refonte-local-first-electron.md`.

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
   une **vue dérivée** — jamais de contenu original dedans. **Exception :**
   `wiki/types.json` est un **registre canonique** (liste COMPLÈTE des types de document
   du menu de dépôt, tableau d'objets **`{ "types": [{ "slug", "origin" }] }`** — chaque
   type porte une **origine par défaut** binaire `interne`|`externe` qui pilote les futurs
   dépôts ; compat lecture de l'ancien tableau de strings), comme les registres
   thèmes/entités — **non dérivé**, écrit via l'UI (`/upload`). Amorcé par une graine de
   types par défaut (`BUILTIN_TYPE_SLUGS` + `BUILTIN_TYPE_ORIGIN` dans `web/lib/ui.ts`)
   tant que le fichier est vide ; dès la 1re écriture il fait autorité et est entièrement
   éditable (ajout / renommage / suppression d'un type **tant qu'aucune ressource ne le
   porte** — dès qu'une ressource l'utilise, le slug est figé, cf. règle 5 ; l'origine par
   défaut reste modifiable même en usage — elle n'affecte que les futurs dépôts). Ne pilote
   QUE le menu de dépôt et l'origine des futurs dépôts ; les filtres/graphe/explore restent
   dérivés des ressources réelles.
4. **L'IA d'ingestion n'écrit aucun fichier.** Elle ne produit que du texte (la page
   ressource) ; un **moteur déterministe** (`web/lib/wiki-project.ts`) reconstruit
   toutes les vues sous `wiki/`. L'unique voie d'écriture est `applyFileOps`
   (`web/lib/wiki-fs.ts`), dont le garde-fou n'autorise QUE les chemins sous `wiki/`
   ou `raw/` — tout autre préfixe fait échouer le lot entier.
5. **Les slugs sont immuables** une fois assignés — les renommer casse les wikilinks.
6. **Verbatim** : une ressource reproduit le texte de la source **mot pour mot**,
   dans sa langue d'origine. L'IA met en markdown ; elle ne reformule, ne résume, ne
   traduit ni n'ajoute jamais. Seuls ajouts autorisés = repères structurels
   (blockquote de navigation, annotations `topics:`/`entities:` par section, **et le
   « bloc figure »** — voir ci-dessous) ; seul « nettoyage » = retirer les scories
   d'extraction (n° de page, en-têtes/pieds répétés) et recoller les mots coupés en
   fin de ligne. **Exception « bloc figure » (passe vision PDF, cf.
   `tasks/specs/2026-09-01-ingestion-vision-pdf.md`)** : une figure d'un PDF (schéma,
   tableau-image, courbe, timeline, organigramme) que l'extraction texte ne capte pas
   est décrite par un **bloc figure** = une section `##` portant une légende
   **explicitement marquée « description machine, non-verbatim »**, une ligne image
   `![…](/api/raw-image/<fichier>?page=N)` et une transcription verbatim des
   étiquettes. Ce bloc et **sa référence de page** sont l'unique contenu autorisé à
   sortir du strict verbatim (leur `page=N` échappe donc à la consigne « retirer les
   numéros de page ») — parce qu'il est signalé comme tel. Tout le reste du corps
   demeure verbatim.

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
