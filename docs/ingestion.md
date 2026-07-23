# Workflow d'ingestion

Comment une source déposée dans `/raw` devient une ressource du wiki + ses vues
dérivées. Suppose la connaissance de [wiki-spec.md](wiki-spec.md) (formats) et
[entities.md](entities.md) (liens).

**Invariant absolu :** l'IA d'ingestion **n'écrit aucun fichier** — elle ne produit
que du texte (la page ressource). C'est un **moteur déterministe**
(`web/lib/wiki-project.ts`) qui écrit sous `wiki/`, via l'unique voie d'écriture
`applyFileOps` (`web/lib/wiki-fs.ts`) dont le garde-fou n'autorise QUE les chemins
sous `wiki/` ou `raw/` (tout autre préfixe fait échouer le lot entier). `/raw` reste
immuable : l'ingestion n'y écrit jamais ; seule la _suppression_ d'une ressource via
la plateforme en retire un fichier brut.

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
      "run": "local"
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

Cette logique est implémentée en TypeScript par `detectPending()`
(`web/lib/ingest-local.ts`) : contenu de `raw/` moins `README.md`, moins les
sidecars `*.meta.md`, moins les clés déjà présentes dans le manifeste. Elle vaut
pour tout déclencheur (fin d'upload ou relance manuelle). Si aucun fichier n'est à
traiter → ne rien faire (coût nul). Un fichier déposé **directement par git** dans
`raw/` (sans passer par la plateforme) est rattrapé au prochain déclenchement
(détection idempotente).

---

## 2. Sidecar de métadonnées `<source>.meta.md`

Tout fichier déposé via la plateforme est accompagné d'un sidecar
`raw/<source>.meta.md`, écrit sur le disque local à côté du fichier de contenu par
la route d'upload (même lot `applyFileOps`). Le fichier de contenu reste
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
entities_granularity:         # granularité PAR type (map) — un type absent ⇒ auto
  tool: chunk
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

> **Qui fait quoi.** L'étape 4 (la page ressource canonique) est produite par **l'IA**
> en un seul appel ; les étapes 5 à 12 (toutes les vues dérivées, le graphe, le
> manifeste, les candidates) sont reconstruites **déterministiquement** par
> `web/lib/wiki-project.ts` à partir de cette page — aucun autre appel IA. Le détail
> du mécanisme est en §4.

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
   (resource vs chunk ; `entities_granularity` déclaré = indice PAR type d'entité).
   Une entité déclarée ne part jamais en candidate. Appliquer les décisions humaines déjà posées
   (`status` ≠ `pending`) et purger.
3bis. Déterminer les thèmes (`topics:`) — même confiance graduée : `themes:` du
   sidecar → crée/relie directement (même nouveau) ; thème détecté connu → relie ;
   sujet inédit → candidate dans `themes/_candidates.json` (ne crée pas). Appliquer
   les décisions thèmes déjà posées et purger. Granularité via `themes_granularity`.
4. Créer `/wiki/resources/<slug>.md` : frontmatter + blockquote de navigation +
   contenu intégral avec chunk annotations (`topics:` et `entities:`). Si la
   source est du texte brut, **mets-la en forme** ici en markdown lisible
   (**verbatim** : on met en forme le texte exact, on ne reformule ni ne raccourcit).
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

> **Décisions candidates & suppression.** L'application des décisions
> `merge_alias`/`create`/`reject` (étapes 3 et 3bis) et la suppression de ressources
> sont désormais faites **DÉTERMINISTIQUEMENT et in-process par la plateforme** (moteur
> `web/lib/wiki-mutate.ts`, cf. [entities.md](entities.md) §7) — dès le clic, sans
> attendre l'ingestion. L'application par cet agent reste un **fallback idempotent**
> (une décision déjà appliquée a purgé son entrée : rien à faire).

Traiter tout le lot sans demander validation à chaque fichier. Résumé final :
nombre de ressources créées, tensions détectées, entités candidates ajoutées.

---

## 4. Automatisation (ingestion locale « IA + déterministe »)

Le pipeline est piloté **in-process** par `web/lib/ingest-local.ts` (refonte
2026-07-21). Principe : **un seul appel IA par ressource** produit la page canonique,
puis un **moteur déterministe** reconstruit tout le reste. Plus d'« agent Claude Code »
multi-tours, plus de `canUseTool`, plus de docs injectées dans le prompt — le coût
passe de ~6,64 $ à **~0,12 $/ressource**. `runIngestion()` :

- **Déclencheurs** : automatique en **fin d'upload** (arrière-plan, non bloquant —
  `web/app/api/upload/route.ts`) + **relance manuelle** via `POST /api/ingest`
  (bouton de l'UI). Ni GitHub Action, ni cron : la détection idempotente (§1)
  rattrape au prochain déclenchement tout fichier déposé entre-temps (y compris à la
  main dans `raw/`).
- **Verrou** : `acquireLock()` crée `<DATA_ROOT>/.data/ingest.lock` de façon atomique
  (`O_EXCL`). Verrou déjà tenu → `runIngestion()` est un no-op : les déclenchements
  rapprochés sont **sérialisés** (jamais de double run).
- **Détection** : `detectPending()` (§1) calcule la liste des fichiers à traiter.
  Liste vide → état `done`, rien d'autre (coût nul).
- **Extraction du texte, en local** (`extractSourceText`, `web/lib/ingest-local.ts`) —
  tout se fait **sur la machine, gratuitement, en pur JavaScript** ; on n'envoie que le
  texte au modèle, jamais le binaire :
  - `.md`/`.txt` : lus directement.
  - `.pdf` : `unpdf`.
  - `.docx` (Word) : `mammoth` (`extractRawText`) — paragraphes, titres, listes, tableaux.
  - `.pptx` (PowerPoint) : `jszip` ouvre l'archive OOXML ; on lit les diapos
    `ppt/slides/slideN.xml` **dans l'ordre numérique**, on concatène le texte des `<a:t>`
    regroupés par paragraphe `<a:p>`, et on inclut les **notes de l'orateur**
    (`ppt/notesSlides/notesSlideN.xml`) à la suite du corps de chaque diapo.
  - **Garde-fou « texte vide »** : sur `.pdf`/`.docx`/`.pptx`, une extraction qui ne rend
    aucun texte lève une erreur explicite (« Aucun texte extractible… ») plutôt que de
    produire une page vide ou de gâcher un appel IA — typiquement un **document scanné /
    composé d'images**. (Ne s'applique PAS aux `.md`/`.txt` : un fichier texte vide reste
    valide.)
  - **Limites** : pas d'**OCR** (texte à l'intérieur d'images ou PDF scanné non lu), et
    pour un `.pptx` on extrait le **texte** des zones de texte et des notes, pas la
    fidélité visuelle (schémas, disposition, texte gravé dans une image).
- **L'unique appel IA** (`callModel`) : `anthropic.messages.create` via le client
  partagé `getAnthropic()` (`web/lib/claude.ts`, auth `x-api-key`, cf.
  [platform.md](platform.md) §6). Le **prompt système** = `prompts/ingest-prompt.md`
  (statique) + un **snapshot des registres** (entités/thèmes connus) — identique d'une
  ressource à l'autre dans un run, marqué `cache_control: ephemeral`. Le **message
  utilisateur** porte le texte brut, le sidecar (fait autorité) et les entités/thèmes
  déclarés (slugs + granularité). L'IA renvoie **exactement deux blocs** et rien
  d'autre : `<resource>…</resource>` (la page canonique — frontmatter + nav + corps
  annoté par section) et `<detected-new>{entities,themes}</detected-new>` (les inédits
  repérés). Elle n'utilise **aucun outil** et **n'écrit aucun fichier**.
- **Projection déterministe** (`ingestOne` → `projectResource`,
  `web/lib/wiki-project.ts`) : avant projection, `source_file` est forcé au nom réel du
  fichier et les **déclarations du sidecar sont réinjectées** dans le frontmatter
  (`forceDeclaredLinks`) — le downstream devient déterministe quelle que soit la
  fidélité de recopie de l'IA. `projectResource` reconstruit alors, sans aucun appel
  modèle, **toutes les vues dérivées + les 7 relations du graphe + le manifeste** à
  partir de la seule page ressource. `buildCandidateOps` range les détectés-inconnus
  (ni connus, ni déclarés) en candidates. Tout est appliqué en un lot via `applyFileOps`
  (écriture locale atomique, scopée `wiki/`).
- **Coût** : lu sur l'en-tête gateway `x-litellm-response-cost` quand il est présent,
  sinon **estimé** au barème Sonnet 4.5. Total du run + détail par fichier persistés
  dans l'état et le journal.
- **Vérification** : après la boucle, `runWikiVerify()` lance `npm run wiki:verify`
  (spawn `scripts/wiki-verify.ts`) qui recontrôle la cohérence
  liens/entités/graphe/manifeste (voir [entities.md](entities.md) §6). **Non bloquant** :
  la queue du rapport est stockée dans l'état (`logTail`), rien n'est annulé. C'est le
  filet du moteur.
- **État** : `<DATA_ROOT>/.data/ingest-state.json` (`status: idle|running|done|error`,
  `pending`, `slug`, `costUsd`, `perFile`, `error`, `logTail`) + journal détaillé
  `<DATA_ROOT>/.data/ingest.log`. Lu par `GET /api/ingest-status` (voir
  [platform.md](platform.md) §4). Un run non abouti passe en `error` ; la relance
  manuelle (ou le prochain upload) le rejoue — la détection par manifeste est idempotente.

Le corps est désormais **verbatim** (recopie de la source) : il ne devrait plus varier
d'un run à l'autre hormis la mise en forme markdown. Tout ce qui touche la **structure**
— vues dérivées, graphe, manifeste, candidates — est en revanche **entièrement
déterministe** (`web/lib/wiki-project.ts`),
cadré par le mandat de complétude du prompt et le filet `wiki:verify`. Les décisions
candidates et les suppressions le sont aussi (moteur `web/lib/wiki-mutate.ts`, cf.
[entities.md](entities.md) §7).
