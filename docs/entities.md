# Système d'entités (liens)

Un mécanisme **générique** pour relier des ressources (ou des sections précises)
à des entités nommées récurrentes. Les « outils » (n8n, Claude Code, Databricks,
Supabase…) et les « clients » ne sont que des **types d'entités** parmi d'autres :
le champ `entity_type` est libre et extensible par les utilisateurs.

Objectif : que le graphe relie « quelles ressources parlent de tel outil / tel
client », sans polluer le graphe avec des doublons (`n8n` vs `N8N` vs `n8n.io`).

---

## 1. Registre : `wiki/entities/<slug>.md`

Une page par entité. Frontmatter = identité ; corps = vue dérivée (mentions).

```yaml
---
type: entity
entity_type: tool             # tool | client | ... (libre)
slug: n8n                     # immuable
label: "n8n"
aliases: [n8n.io, "n8n workflow"]   # écritures alternatives reconnues automatiquement
---
```

```markdown
## Mentions

### [[../resources/<slug>|Titre de la ressource]]
`date · source_type — Auteur`
- [[../resources/<slug>#section|Section]] — contexte de la mention en 1 ligne
```

Seed initial (`entity_type: tool`) : `n8n`, `claude-code`, `databricks`, `supabase`.

---

## 2. Déclaration des liens à l'upload (sidecar `links:`)

L'uploadeur peut déclarer des liens **typés** dans le sidecar `.meta.md`, via un
bloc `links:` dont chaque clé est un `entity_type` :

```yaml
links:
  tool: [n8n, claude-code]
  client: [acme-corp]
entities_granularity:        # granularité PAR type (map) — un type absent ⇒ auto
  tool: chunk
```

Le formulaire d'upload s'auto-étend : il lit les `entity_type` déjà présents dans
le registre (endpoint `/api/entities`) et propose leurs entités en autocomplétion ;
un nouveau type de lien peut être créé à la volée. Le type déclaré est
**autoritaire pour une entité nouvelle** (il dit à l'agent avec quel `entity_type`
la créer).

Rétro-compat : un ancien sidecar avec `entities: [n8n]` (liste plate, sans type)
reste accepté — l'agent traite ces noms comme « type non spécifié » (§4).

---

## 3. Granularité d'un lien

Deux niveaux, selon la précision voulue :

- **Ressource → entité** : `entities: [n8n]` dans le **frontmatter** de la
  ressource. La ressource entière est reliée.
- **Chunk → entité** : ligne `` `entities: [n8n]` `` sous le heading de la
  section, à côté de `topics:`. Seule cette section est reliée.

> Dans les fiches `resources/`, les liens restent une **liste plate de slugs**
> (`entities: [...]`) — le type de chaque entité vit dans son fichier de registre
> `wiki/entities/<slug>.md`, jamais répété dans chaque ressource.

Comment la granularité est décidée :
- déclarée par l'utilisateur à l'upload via `entities_granularity` du sidecar — une
  **map `entity_type → resource|chunk`** (un type absent ⇒ `auto`). Un scalaire
  `resource|chunk` (ancien format) reste accepté et s'applique à tous les types déclarés ;
- sinon `auto` : l'agent choisit `chunk` si l'entité n'est citée que dans une ou
  deux sections précises, `resource` si elle est transverse au document.

---

## 4. Confiance graduée (création vs candidate)

À l'ingestion, le traitement dépend de ce qui a été déclaré :

1. **Entité + type déclarés explicitement** (bloc `links:` du sidecar) → l'agent
   **crée et lie directement** l'entité avec ce `entity_type`, même nouvelle
   (on fait confiance au choix humain). **Jamais de candidate pour une entité
   déclarée.** Si le nom correspond à une entité existante du **même** type → il s'y
   relie (dédoublonnage). S'il correspond à une entité existante d'un **autre** type,
   l'agent crée quand même l'entité déclarée sous un **slug distinct déterministe**
   (suffixe du type, ex. `databricks-tool`) — pas de candidate.
2. **Nom déclaré sans type** (ancien `entities:` plat) ou **détecté dans le
   contenu** :
   - écriture reconnue (match casse/accents sur `label`/`aliases` d'une entité
     existante) → **lien automatique** ;
   - écriture inconnue → **ne pas créer** : entrée dans
     `wiki/entities/_candidates.json` (l'agent peut **proposer** un `entity_type`
     — TOUJOURS parmi les types déjà présents dans le registre — l'humain confirme).
3. **Rien déclaré** → l'agent ne lie que les entités **déjà connues** détectées
   dans le texte ; toute nouvelle entité va en candidate.

**Mandat de complétude :** toute mention (label/alias) d'une entité connue dans le
texte DOIT être reliée — c'est ce que `wiki:verify` recontrôle (§6). Avant toute
création, vérifier qu'aucune entité existante ne correspond (dédoublonnage `n8n`
vs `n8n.io`). Ce canal candidate est **distinct** de `needs_review` (réservé à
l'ambiguïté d'origin, wiki-spec.md §5).

### Contrat `wiki/entities/_candidates.json`

Fichier **machine-lisible** lu par la plateforme (page `/entities`, section « en
attente »). L'agent l'écrit ; l'humain décide depuis la page (ou en éditant le
JSON). Une entrée :

```json
{
  "name": "Cursor",
  "normalized": "cursor",
  "variants": ["Cursor"],
  "note": null,
  "seen_in": [{ "resource": "<slug>", "section": "<heading-slug|null>", "context": "…extrait…" }],
  "suggested_aliases": [{ "slug": "<entité-proche>", "label": "…", "score": 0.42 }],
  "suggested_types": ["tool"],
  "status": "pending",
  "decision": { "target_slug": null, "entity_type": null, "slug": null },
  "updated_at": "AAAA-MM-JJ"
}
```

- `normalized` = clé d'identité (dédoublonne les variantes d'une même candidate).
- `suggested_types` ⊆ types du registre ; `suggested_aliases` = entités proches
  (« ressemble à »), triées par `score` décroissant.

Décisions (posées via la page → `status` ≠ `pending`), appliquées et purgées
**DÉTERMINISTIQUEMENT et IMMÉDIATEMENT** par la plateforme (moteur TypeScript
`web/lib/wiki-mutate.ts`, appelé par la route `/api/candidates/resolve` → écriture
locale atomique via `applyFileOps`). Plus aucune dépendance à l'agent d'ingestion
(cf. §7) :
- `merge_alias` → ajoute le nom aux `aliases` de `decision.target_slug`, relie
  rétroactivement les ressources de `seen_in`, supprime l'entrée.
- `create` → crée `wiki/entities/<decision.slug>.md` (`entity_type =
  decision.entity_type`), relie rétroactivement, supprime l'entrée.
- `reject` → supprime l'entrée, ne relie rien.

Le moteur relie **exactement** les ressources listées dans `seen_in` (déterminisme).
Si une mention en prose n'y figurait pas, `wiki:verify` la signale (`missed-link`,
non bloquant) — c'est la complétude qui incombe à la détection, pas au moteur.

### Parallèle : thèmes candidats (`wiki/themes/_candidates.json`)

Le **même mécanisme** s'applique aux **thèmes**, avec la dimension `type` retirée
(un thème n'a pas de `entity_type`). Contrat identique **sans** `suggested_types` ;
`decision` = `{ target_slug, slug }`. Déclaration à l'upload via `themes:` (liste
plate, autoritaire) + `themes_granularity` (indice grossier). Arbitrage humain sur
la page `/themes` (**fusionner / créer / rejeter**), registre = `wiki/themes/<slug>.md`
(`label`, `aliases` optionnel). Format thème détaillé : [wiki-spec.md](wiki-spec.md) §3 et §6.

---

## 5. Graphe (`graph.json`)

- **Node** : `{"id": "entity:<slug>", "type": "entity", "entity_type": "tool", "label": "n8n"}`.
  Le namespace d'ID est toujours `entity:` (jamais `tool:` / `client:`) → l'ID
  reste stable si l'humain reclasse le type ; le typage vit dans `entity_type`.
- **Edge** : `{"source": "resource:<slug>", "target": "entity:<slug>", "relation": "mentions", "sections": ["heading-slug", …]}`.
  Un seul edge par paire (ressource, entité). Pour un lien niveau ressource,
  le champ `sections` est absent ; pour un lien niveau chunk, il liste les
  headings concernés. Cela évite l'explosion du nombre d'edges.

---

## 6. Vérificateur déterministe (`wiki:verify`)

`web/scripts/wiki-verify.ts` (lancé par `npm --prefix web run wiki:verify`) balaye
les ressources et le registre et signale, **sans rien modifier**, ce qu'un moteur
d'ingestion a pu rater. C'est à la fois le **filet de sécurité** du moteur LLM et la
**métrique** qui départage les deux moteurs (LLM vs TypeScript). Catégories :

- `missed-link` — entité connue citée dans la prose mais non reliée (le lien raté) ;
- `unknown-entity` — ressource reliée à un slug d'entité absent du registre ;
- `duplicate-entity` — deux entités partagent une forme (label/alias) ;
- `candidate-collision` — une candidate correspond déjà à une entité existante ;
- `invented-type` — type suggéré d'une candidate hors des types connus ;
- `graph-missing-node` / `graph-missing-edge` — lien absent de `graph.json` (couvre
  désormais `mentions`, `has_origin`, `belongs_to_theme`, `written_by`, `has_type`,
  `published_on`) ;
- `graph-orphan-node` / `graph-orphan-edge` — `resource:<slug>` du graphe sans
  fichier ressource (rattrape une suppression incomplète) ;
- `manifest-missing` — `source_file` d'une ressource absent de `_ingested.json` ;
- `manifest-orphan` — entrée `_ingested.json` pointant une ressource supprimée.

Par défaut : rapport + `exit 0` (avertit sans casser). `--strict` : `exit 1` s'il
reste un problème. `--json` : sortie machine (comptage). Le moteur d'ingestion
local (`web/lib/ingest-local.ts`) lance le vérificateur après l'agent (mode non
bloquant) — la queue du rapport est conservée dans l'état d'ingestion (`logTail`)
et le journal `<DATA_ROOT>/.data/ingest.log`.

---

## 7. Moteur déterministe de mutation (`web/lib/wiki-mutate.ts`)

Les décisions sur candidates (§4) **et** la suppression de ressources sont faites
par un **moteur TypeScript pur, déterministe** (zéro LLM), appliqué **in-process**
par la plateforme en écriture locale atomique. C'est « l'inverse de l'ingestion » :
édition chirurgicale des vues dérivées + graphe + manifeste.

- **Fonctions pures** : `applyEntityDecision`, `applyThemeDecision`, `deleteResource`
  reçoivent le contenu des fichiers pertinents et renvoient une liste d'opérations
  `FileOp = { path, content } | { path, delete: true }`. Aucune I/O → testées par
  `web/lib/__tests__/wiki-mutate.test.ts` (`npm --prefix web run test`).
- **Application** : `applyFileOps` (`web/lib/wiki-fs.ts`) exécute la liste de
  `FileOp` en **écriture locale atomique par fichier** (temp + `rename` ; les
  suppressions `{ path, delete: true }` ignorent `ENOENT`), avec le garde-fou
  « chemins sous `wiki/` ou `raw/` uniquement ». Les routes lisent l'état à jour
  via `readRepoFile`, appellent le moteur, écrivent tout d'un coup.
- **Routes** : `/api/candidates/resolve`, `/api/theme-candidates/resolve` (décisions),
  `DELETE /api/sources/[slug]` (suppression). Application immédiate, aucun réseau.
- **Suppression** — l'ordre inverse des 12 étapes d'ingestion : retire la ressource
  canonique, ses blocs/lignes dans themes/authors/origin/by-date/entities/index/types,
  ses nodes/edges du graphe, l'entrée manifeste, **et** les fichiers bruts
  (`raw/<source>` + sidecar). La clé manifeste étant purgée dans le même lot, la
  source ne peut pas être ré-ingérée. Orphelins : les **facettes dérivées** tombées
  à 0 (author, date, type) sont supprimées ; les **registres** (theme, entity) et
  l'enum origin sont conservés.
- **Filet** : `wiki:verify` (§6, étendu aux orphelins) reste le garde-fou de cohérence.
