# Workflow d'ingestion

Comment une source déposée dans `/raw` devient une ressource du wiki + ses vues
dérivées. Suppose la connaissance de [wiki-spec.md](wiki-spec.md) (formats) et
[entities.md](entities.md) (liens).

**Invariant absolu :** l'agent d'ingestion n'écrit **que sous `wiki/`**. Il ne
touche jamais `/raw` ni `web/`. C'est ce qui empêche la boucle de re-déclenchement
de la GitHub Action (filtrée sur `raw/**`).

---

## 1. Détection des fichiers à traiter

La source de vérité du « déjà traité » est le manifeste `wiki/_ingested.json` :

```json
{
  "version": 1,
  "files": {
    "state-of-ai-2026.pdf": {
      "slug": "state-of-ai-2026-untapped-edge",
      "ingested_at": "2026-07-08",
      "run": "gha-1234567890"
    }
  }
}
```

La **clé** est le nom du fichier de **contenu** (`state-of-ai-2026.pdf`), jamais
le sidecar `.meta.md`.

Un fichier `/raw` est **à traiter** s'il remplit toutes ces conditions :
- extension de contenu : `.md`, `.txt`, `.pdf`, `.pptx`, `.docx` ;
- n'est pas `README.md` ni un `*.meta.md` (sidecar de métadonnées) ;
- sa clé est absente de `wiki/_ingested.json`.

Cette logique est identique au push et au cron de rattrapage. Si aucun fichier
n'est à traiter → ne rien faire (l'Action skippe, coût nul).

---

## 2. Sidecar de métadonnées `<source>.meta.md`

Tout fichier déposé via la plateforme est accompagné d'un sidecar
`raw/<source>.meta.md` porté par le commit d'upload. Le fichier de contenu reste
**byte-identique** (raw immuable) ; le sidecar porte ce que l'humain a saisi :

```yaml
---
title: "Titre saisi (peut être vide)"
type: article                 # source_type choisi dans la modale
author: "Auteur / Organisation"
date: "2026-07"
url: "https://..."
deposited_by: "Prénom"
links:                        # liens TYPÉS déclarés (optionnel) — voir entities.md
  tool: [n8n, claude-code]
  client: [acme-corp]
entities_granularity: auto    # auto | resource | chunk
themes: [agentic-coding, finops-ia]   # thèmes déclarés (optionnel) — liste plate
themes_granularity: auto      # auto | resource | chunk (indice pour l'agent)
---
```

(Ancien format encore accepté : `entities: [n8n]` — liste plate sans type.)

Les `themes:` déclarés sont **autoritaires** (comme `links:`) : l'agent crée/relie
directement le thème, même nouveau. `themes_granularity` est un **indice grossier**
(la ressource n'est pas encore découpée à l'upload) — l'agent choisit les sections
exactes. Voir [entities.md](entities.md) pour le mécanisme candidate (thèmes inclus).

**Précédence « l'humain gagne si rempli » :** une métadonnée saisie dans le
sidecar est autoritaire ; l'agent ne comble que les champs vides par inférence.
L'`url` n'est **jamais** devinée depuis le contenu — elle vient uniquement du
sidecar. Un dépôt manuel par git peut ne pas avoir de sidecar : dans ce cas
l'agent infère tout (et applique l'heuristique origin de wiki-spec.md §5).

---

## 3. Étapes par fichier à traiter

1. Lire le fichier de contenu en entier (+ son sidecar `.meta.md` s'il existe).
   Une source `.txt` (ou un texte collé via la plateforme) peut être du **texte
   brut non structuré** : elle sera normalisée en markdown propre à l'étape 4
   (titres, paragraphes, listes) sans perte d'information. Un `.md` déjà bien
   formé garde sa structure.
2. Déterminer : `title`, `source_type`, `author`, `date`, `topics`, `url`,
   `origin` (heuristique wiki-spec.md §5). Le sidecar prime sur l'inférence.
3. Détecter les entités (voir [entities.md](entities.md)) : alias connu → lien
   (mandat de complétude : TOUTE mention connue est reliée) ; écriture inconnue →
   candidate dans `entities/_candidates.json`. Déterminer la granularité
   (resource vs chunk). Appliquer les décisions humaines déjà posées
   (`status` ≠ `pending`) et purger.
3bis. Déterminer les thèmes (`topics:`) — même confiance graduée : `themes:` du
   sidecar → crée/relie directement (même nouveau) ; thème détecté connu → relie ;
   sujet inédit → candidate dans `themes/_candidates.json` (ne crée pas). Appliquer
   les décisions thèmes déjà posées et purger. Granularité via `themes_granularity`.
4. Créer `/wiki/resources/<slug>.md` : frontmatter + blockquote de navigation +
   contenu intégral avec chunk annotations (`topics:` et `entities:`). Si la
   source est du texte brut, **structure-la** ici en markdown lisible (fidélité
   intégrale : on met en forme, on ne raccourcit pas).
5. Pour chaque topic : mettre à jour `/wiki/themes/<topic>.md` (entrée ressource
   + liens vers les sections concernées).
6. Créer ou mettre à jour `/wiki/authors/<slug-auteur>.md` (ligne dans la table).
7. Pour chaque entité liée : mettre à jour `/wiki/entities/<slug>.md`.
8. Ajouter les entrées dans `types.md`, `origin/interne.md` + `origin/externe.md`
   (les deux pages toujours présentes), `by-date/`.
9. Mettre à jour `index.md`.
10. Ajouter nodes/edges dans `graph.json` (ne pas régénérer de zéro).
11. Ajouter l'entrée `{ "<fichier-contenu>": { slug, ingested_at, run } }` dans
    `wiki/_ingested.json`.
12. Ajouter une entrée dans `log.md`.

Traiter tout le lot sans demander validation à chaque fichier. Résumé final :
nombre de ressources créées, tensions détectées, `needs_review` à résoudre,
entités candidates ajoutées.

---

## 4. Automatisation (GitHub Action)

Le pipeline est piloté par `.github/workflows/ingest.yml` :

- **Déclencheurs** : `push` sur `paths: ['raw/**']` (dépôt via la plateforme ou
  git direct) + `workflow_dispatch` (manuel) + `schedule` nocturne (rattrapage
  des dépôts manuels et des runs échoués).
- **`concurrency`** : groupe unique, `cancel-in-progress: false` → deux uploads
  rapprochés sont sérialisés.
- **Détection** : un step shell calcule la liste des fichiers à traiter (§1) et
  la passe au prompt. Liste vide → run skippé.
- **Agent** : `claude -p "$(cat .github/prompts/ingest-prompt.md)"`
  `--permission-mode acceptEdits --settings .github/ingest-settings.json`. Ce
  fichier de settings **dédié à l'Action** refuse toute écriture hors `wiki/`
  (double ceinture avec le `git add wiki/`). Il n'est chargé QUE dans l'Action —
  jamais dans les sessions de dev (le `.claude/settings.json` partagé ne contient
  aucun deny bloquant).
- **Vérification** : après l'agent, `npm --prefix web run wiki:verify` recontrôle
  la cohérence des liens/entités (liens ratés, doublons, graphe/manifeste — voir
  [entities.md](entities.md) §6). Mode non bloquant : le rapport va dans les logs,
  le commit a lieu quand même (le cron rattrapera). C'est le filet du moteur LLM.
- **Commit** : `git add wiki/ && git commit && git pull --rebase && git push`
  (le rebase encaisse un éventuel commit d'upload concurrent).
- **Échec** : ouvre une issue GitHub. Pas de retry dans le run — le cron nocturne
  EST le retry (la détection par manifeste est idempotente).

Le **texte paraphrasé** peut varier d'un run à l'autre (le LLM n'est pas
déterministe sur la prose) ; tout ce qui touche le graphe est cadré par le mandat
de complétude du prompt + le vérificateur `wiki:verify`, l'idempotence du manifeste,
et le deny hors `wiki/`. La comparaison avec un moteur TypeScript déterministe
(branche `feat/ts-resolver`) se fera via `wiki:verify --json` (comptage des ratés).
