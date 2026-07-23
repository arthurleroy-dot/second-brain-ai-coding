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

- Fichier de **contenu** : `.md`, `.txt`, `.pdf`, `.pptx`, `.docx`. Pas besoin de
  markdown : un texte brut collé via la plateforme atterrit en `.txt` et l'agent
  le met en forme à l'ingestion (`.txt` = brut à normaliser, `.md` = markdown déjà
  structuré et préservé).
- Optionnellement, un **sidecar de métadonnées** `<nom-du-fichier>.meta.md`
  (frontmatter : titre, type, auteur, date, url, deposited_by, entities…). Les
  uploads via la plateforme le génèrent automatiquement ; pour un dépôt manuel,
  il est facultatif (l'agent infère ce qui manque).

## Cycle de vie d'un fichier

1. Vous déposez un fichier ici — via la plateforme (bouton d'upload, qui l'écrit
   sur votre **disque local** avec un sidecar `.meta.md`), ou en copiant le fichier
   à la main.
2. L'ingestion **locale** se déclenche : automatiquement en fin d'upload (en
   arrière-plan), ou via la relance manuelle (`POST /api/ingest`). Plus aucune
   GitHub Action, plus aucun cron — tout tourne en local, dans l'app. Un fichier
   copié à la main est rattrapé au prochain déclenchement (détection idempotente
   via `wiki/_ingested.json`).
3. Un appel IA transforme la source en ressource `wiki/resources/<slug>.md`, puis
   un moteur déterministe reconstruit les vues dérivées et le graphe. Le fichier
   est enregistré comme traité dans `wiki/_ingested.json` (l'ingestion **ne modifie
   jamais** `/raw`).

> Ne supprimez pas les fichiers à la main ici. La **seule** suppression sanctionnée
> passe par la plateforme : elle retire la ressource **et** son fichier brut (+ le
> sidecar + l'entrée manifeste) dans le même lot d'écritures.
