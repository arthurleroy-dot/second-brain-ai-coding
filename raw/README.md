# /raw — Inbox

Ce dossier est l'**inbox** du second brain.

## Règles

- On y **dépose les fichiers bruts** : notes, articles copiés-collés, transcriptions, liens annotés, captures de réflexion, exports de conversations, etc.
- On **n'organise jamais** ces fichiers à la main : pas de tri, pas de renommage thématique, pas de regroupement manuel.
- C'est l'agent (voir [CLAUDE.md](../CLAUDE.md)) qui lit ces fichiers, en extrait les concepts clés et alimente le [/wiki](../wiki/index.md).

## Format attendu

N'importe quel format texte fait l'affaire (`.md`, `.txt`). Si vous avez une source, indiquez l'**URL** et la **date** quelque part dans le fichier pour que l'agent puisse les reporter dans le wiki.

## Cycle de vie d'un fichier

1. Vous déposez un fichier ici.
2. L'agent le traite (tous les soirs à 23h via la GitHub Action, ou à la demande).
3. Une fois traité, l'agent ajoute `processed: true` en haut du fichier pour ne pas le retraiter.

> Ne supprimez pas les fichiers traités : ils servent de trace des sources.
