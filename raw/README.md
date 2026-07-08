# /raw — Inbox

Ce dossier est l'**inbox** du second brain, et il est **immuable** : on y dépose
des sources, on n'y modifie jamais rien ensuite.

## Règles

- On y **dépose les fichiers bruts** : notes, articles copiés-collés, transcriptions,
  liens annotés, captures de réflexion, exports de conversations, PDF, etc.
- On **n'organise jamais** ces fichiers à la main : pas de tri, pas de renommage
  thématique, pas de regroupement manuel.
- C'est l'agent (voir [CLAUDE.md](../CLAUDE.md) et [docs/ingestion.md](../docs/ingestion.md))
  qui lit ces fichiers et alimente le [/wiki](../wiki/index.md). **L'agent n'écrit
  jamais dans `/raw`** — uniquement dans `wiki/`.

## Format attendu

- Fichier de **contenu** : `.md`, `.txt`, `.pdf`, `.pptx`, `.docx`.
- Optionnellement, un **sidecar de métadonnées** `<nom-du-fichier>.meta.md`
  (frontmatter : titre, type, auteur, date, url, deposited_by, entities…). Les
  uploads via la plateforme le génèrent automatiquement ; pour un dépôt manuel,
  il est facultatif (l'agent infère ce qui manque).

## Cycle de vie d'un fichier

1. Vous déposez un fichier ici (via la plateforme, qui le commit ; ou via git).
2. Le commit sous `raw/**` déclenche la GitHub Action d'ingestion (ou un
   `workflow_dispatch` manuel ; un cron nocturne rattrape les dépôts manuels).
3. L'agent crée la ressource + les vues dérivées, et enregistre le fichier comme
   traité dans `wiki/_ingested.json` (il **ne modifie pas** le fichier `/raw`).

> Ne supprimez pas les fichiers déposés : ils servent de trace des sources.
