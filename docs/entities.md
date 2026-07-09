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
entities_granularity: auto   # auto | resource | chunk
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
- déclarée par l'utilisateur à l'upload via `entities_granularity` du sidecar
  (`resource` | `chunk`) ;
- sinon `auto` : l'agent choisit `chunk` si l'entité n'est citée que dans une ou
  deux sections précises, `resource` si elle est transverse au document.

---

## 4. Confiance graduée (création vs candidate)

À l'ingestion, le traitement dépend de ce qui a été déclaré :

1. **Entité + type déclarés explicitement** (bloc `links:` du sidecar) → l'agent
   **crée et lie directement** l'entité avec ce `entity_type`, même nouvelle
   (on fait confiance au choix humain). **Sauf** si le nom correspond à une entité
   existante d'un **autre** type (conflit) → alors candidate.
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

Décisions (posées via la page → `status` ≠ `pending`), appliquées et purgées par
l'agent au run suivant :
- `merge_alias` → ajoute le nom aux `aliases` de `decision.target_slug`, relie
  rétroactivement, supprime l'entrée.
- `create` → crée `wiki/entities/<decision.slug>.md` (`entity_type =
  decision.entity_type`), relie rétroactivement, supprime l'entrée.
- `reject` → supprime l'entrée, ne relie rien.

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
- `graph-missing-node` / `graph-missing-edge` — lien absent de `graph.json` ;
- `manifest-missing` — `source_file` d'une ressource absent de `_ingested.json`.

Par défaut : rapport + `exit 0` (avertit sans casser). `--strict` : `exit 1` s'il
reste un problème. `--json` : sortie machine (comptage pour la comparaison).
L'Action lance le vérificateur après l'agent (mode non bloquant) — le rapport
apparaît dans les logs.
