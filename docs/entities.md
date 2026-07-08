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
     `wiki/entities/_candidates.md` (l'agent peut **proposer** un `entity_type`,
     l'humain confirme).
3. **Rien déclaré** → l'agent ne lie que les entités **déjà connues** détectées
   dans le texte ; toute nouvelle entité va en candidate.

Avant toute création, vérifier qu'aucune entité existante ne correspond
(dédoublonnage `n8n` vs `n8n.io`). Ce canal candidate est **distinct** de
`needs_review` (réservé à l'ambiguïté d'origin, wiki-spec.md §5).

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

## 5. Graphe (`graph.json`)

- **Node** : `{"id": "entity:<slug>", "type": "entity", "entity_type": "tool", "label": "n8n"}`.
  Le namespace d'ID est toujours `entity:` (jamais `tool:` / `client:`) → l'ID
  reste stable si l'humain reclasse le type ; le typage vit dans `entity_type`.
- **Edge** : `{"source": "resource:<slug>", "target": "entity:<slug>", "relation": "mentions", "sections": ["heading-slug", …]}`.
  Un seul edge par paire (ressource, entité). Pour un lien niveau ressource,
  le champ `sections` est absent ; pour un lien niveau chunk, il liste les
  headings concernés. Cela évite l'explosion du nombre d'edges.
