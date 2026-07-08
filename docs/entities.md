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

## 2. Granularité d'un lien

Deux niveaux, selon la précision voulue :

- **Ressource → entité** : `entities: [n8n]` dans le **frontmatter** de la
  ressource. La ressource entière est reliée.
- **Chunk → entité** : ligne `` `entities: [n8n]` `` sous le heading de la
  section, à côté de `topics:`. Seule cette section est reliée.

Comment la granularité est décidée :
- déclarée par l'utilisateur à l'upload via `entities_granularity` du sidecar
  (`resource` | `chunk`) ;
- sinon `auto` : l'agent choisit `chunk` si l'entité n'est citée que dans une ou
  deux sections précises, `resource` si elle est transverse au document.

---

## 3. Garde-fou hybride (alias connu vs inconnu)

À l'ingestion, pour chaque mention potentielle d'entité détectée dans le contenu :

- **Écriture reconnue** (match insensible à la casse et aux accents sur `label`
  ou `aliases` d'une entité existante) → **lien créé automatiquement**.
- **Écriture inconnue** → **ne pas créer l'entité**. Ajouter une entrée dans
  `wiki/entities/_candidates.md` (sas de décision humaine).

Ce canal est **distinct** de `needs_review` (réservé à l'ambiguïté d'origin,
wiki-spec.md §5). Une entité candidate ne met jamais `needs_review: true`.

### Format de `wiki/entities/_candidates.md`

```markdown
# Entités candidates

Sas de décision humaine. Pour chaque entrée, coche UNE case puis relance
l'ingestion (`workflow_dispatch`) : l'agent applique les décisions cochées et
purge les entrées traitées.

## n8n.io
- Vu dans : [[../resources/<slug>#section]] ("…contexte de la mention…")
- Ressemble à : [[n8n]] ?
- Décision : ☐ fusionner comme alias de `n8n` · ☐ créer l'entité (entity_type: ?) · ☐ rejeter
```

Application des décisions par l'agent au run suivant :
- **fusionner comme alias** → ajouter l'écriture aux `aliases` de l'entité cible,
  créer les liens rétroactivement, purger l'entrée.
- **créer l'entité** → créer `wiki/entities/<slug>.md` (l'humain aura précisé
  `entity_type`), créer les liens, purger l'entrée.
- **rejeter** → purger l'entrée, ne rien lier.

---

## 4. Graphe (`graph.json`)

- **Node** : `{"id": "entity:<slug>", "type": "entity", "entity_type": "tool", "label": "n8n"}`.
  Le namespace d'ID est toujours `entity:` (jamais `tool:` / `client:`) → l'ID
  reste stable si l'humain reclasse le type ; le typage vit dans `entity_type`.
- **Edge** : `{"source": "resource:<slug>", "target": "entity:<slug>", "relation": "mentions", "sections": ["heading-slug", …]}`.
  Un seul edge par paire (ressource, entité). Pour un lien niveau ressource,
  le champ `sections` est absent ; pour un lien niveau chunk, il liste les
  headings concernés. Cela évite l'explosion du nombre d'edges.
