# CLAUDE.md — Wiki "AI Coding Second Brain"

Tu es l'agent responsable de la maintenance de ce wiki. Ce fichier est ta seule
source de vérité. Lis-le en entier avant toute opération d'ingestion, de requête
ou de lint. Mets-le à jour si de nouvelles conventions émergent.

---

## 1. Architecture en 3 couches

```
/raw/                          ← Couche 1 : sources immuables
  README.md                    ← règles de dépôt (ne pas toucher)
  *.md / *.pdf.meta.md         ← sources brutes (frontmatter only pour PDFs)

/wiki/                         ← Couche 2 & 3
  resources/                   ← Couche 2 : CANONIQUE — une page par source brute
    <slug>.md                  ← contenu intégral, paraphrasé + annoté par chunk
  themes/                      ← Couche 3 : vue dérivée — liens vers chunks
    <slug-theme>.md
  authors/                     ← Couche 3 : vue dérivée — table
    <slug-auteur>.md
  by-date/                     ← Couche 3 : vue dérivée — index temporel
    <YYYY>/
      index.md
      <YYYY-MM>/
        index.md
  index.md                     ← catalogue général
  graph.json                   ← export machine-readable
  types.md                     ← index par type (article, report-pdf, etc.)
  origin.md                    ← index par origine (interne/externe)
  log.md                       ← journal append-only
  _archive/                    ← archives des reconstructions passées
```

**Règle cardinale :** `resources/*.md` est la source de vérité du contenu.
Toutes les autres pages sous `wiki/` sont des **vues dérivées** générées depuis
les ressources. Ne jamais écrire de contenu original dans themes/, authors/,
by-date/, types.md, origin.md.

---

## 2. Format des ressources (`/wiki/resources/<slug>.md`)

### 2.1 Frontmatter

```yaml
---
slug: <slug-stable>           # dérivé du titre, minuscules+tirets, max 60 chars, immuable
title: "Titre complet"
author: "Nom Auteur / Organisation"
date: "2026-04"               # AAAA | AAAA-MM | AAAA-MM-JJ
source_type: article          # article | report-pdf | tweet | interview | presentation | meeting-notes | transcript | personal-notes
origin: externe               # interne | externe — déterminé par heuristique (voir §5)
topics: [finops-ia, agentic-coding]   # union de tous les topics de sections
url: "https://..."
source_file: "<nom exact dans /raw>"
needs_review: false           # true uniquement si origin non déductible (voir §5)
---
```

### 2.2 Chunk annotation

Chaque section `##` ou `###` porte une ligne `topics:` immédiatement après le heading :

```markdown
## Titre de section
`topics: [finops-ia, agentic-coding]`

Contenu de la section...
```

### 2.3 Contenu

- **Intégral et fidèle** : reproduire toute l'information, chaque chiffre, chaque
  exemple, chaque citation nommée. Paraphrase acceptable, raccourcissement non.
- Pas de résumé court : une source longue → une page longue.
- Fins de page : section `## Liens` avec wikilinks vers themes/ et authors/.

---

## 3. Format des vues dérivées

### themes/<slug>.md
**Pas de synthèse.** Seulement des liens vers les chunks des ressources qui
couvrent ce thème, groupés par ressource.

```markdown
---
type: theme
slug: finops-ia
label: FinOps IA
resource_count: N
last_updated: "AAAA-MM-JJ"
---

## [[resources/<slug>|Titre de la ressource]]
`date · source_type · origin — Auteur`

- [[resources/<slug>#section-heading|Titre de section]] — take-away en 1 ligne
```

### authors/<slug>.md
Table des ressources de cet auteur/organisation.

```markdown
---
type: author
slug: mckinsey
label: McKinsey
resource_count: N
---

| Ressource | Date | Type | Origin | Topics |
|-----------|------|------|--------|--------|
| [[resources/<slug>\|Titre]] | 2026-05 | report-pdf | externe | agentic-coding, ... |
```

### by-date/<YYYY>/<YYYY-MM>/index.md
Table des ressources publiées ce mois-là. Idem pour `<YYYY>/index.md` (liste
les mois + ressources sans date précise).

### graph.json

Types d'edges réels du graphe :

| Edge | Source → Target | Signification |
|------|------------------|----------------|
| `written_by` | resource → author | Cette ressource a été écrite par cet auteur |
| `has_type` | resource → source_type | Type de contenu de cette ressource |
| `has_origin` | resource → origin | Origine interne ou externe |
| `belongs_to_theme` | resource → theme | Cette ressource aborde ce thème |
| `published_on` | resource → date | Date de publication |
| `year_of` | date (mois) → date (année) | Hiérarchie temporelle |

```json
{
  "generated": "AAAA-MM-JJ",
  "nodes": [
    {"id": "resource:<slug>", "type": "resource", "label": "..."},
    {"id": "theme:<slug>", "type": "theme", "label": "..."},
    {"id": "author:<slug>", "type": "author", "label": "..."},
    {"id": "type:article", "type": "source_type", "label": "Article"},
    {"id": "origin:externe", "type": "origin", "label": "Externe"},
    {"id": "date:2026", "type": "date", "label": "2026", "granularity": "year"},
    {"id": "date:2026-04", "type": "date", "label": "2026-04", "granularity": "month", "year": "2026"}
  ],
  "edges": [
    {"source": "resource:<slug>", "target": "author:<slug>", "relation": "written_by"},
    {"source": "resource:<slug>", "target": "type:article", "relation": "has_type"},
    {"source": "resource:<slug>", "target": "origin:externe", "relation": "has_origin"},
    {"source": "resource:<slug>", "target": "theme:<slug>", "relation": "belongs_to_theme"},
    {"source": "resource:<slug>", "target": "date:2026-04", "relation": "published_on"},
    {"source": "date:2026-04", "target": "date:2026", "relation": "year_of"}
  ]
}
```
Ne pas ajouter d'arête `has_origin` si `origin` est inconnu pour une ressource.
Une date `AAAA-MM-JJ` se normalise au niveau mois pour l'edge `published_on` (cible `date:AAAA-MM`).
Mettre à jour (ajouter nodes+edges) à chaque ingestion — ne pas régénérer de zéro.

---

## 4. Règles de slug

- Dérivé du **titre** (pas du nom de fichier `/raw`).
- Minuscules, tirets, sans accents, max ~60 caractères.
- **Immuable** une fois assigné — renommer casse les wikilinks.
- Exemples : `ai-finops-2026-runtime-cost-governance-cant-wait`,
  `rewiring-software-delivery-agentic-era`.

---

## 5. Heuristique origin

| Indice dans la source | → origin |
|-----------------------|----------|
| meeting-notes, personal-notes, transcript interne | `interne` |
| article signé d'un tiers, rapport PDF d'un cabinet, tweet public, interview | `externe` |
| ambiguïté impossible à lever sans l'humain | `""` + `needs_review: true` |

**Ne jamais déduire origin depuis le nom de l'auteur ou le contenu.**
Si incertain : laisser vide, `needs_review: true`, noter dans le résumé de run.

**Règle `needs_review` (déclencheur unique) :**

Le seul déclencheur :
- Origin non déductible : l'heuristique §5 ne permet pas de trancher entre interne et externe

Ce qui ne déclenche PAS needs_review :
- Date année-seule (ex : "2026")
- URL manquante
- source_file manquant
- Topics absents (l'agent les déduit toujours depuis le contenu)
- Doublon suspect (cas trop rare et géré autrement)

Le flag tombe à false dès que l'humain a tranché sur l'origin.

---

## 6. Thèmes courants (à utiliser en priorité)

`finops-ia` · `agentic-coding` · `transformation-organisationnelle` ·
`outils-et-marche` · `securite-et-risques` · `context-engineering`

Créer un nouveau thème seulement si le contenu ne rentre vraiment dans aucun
des six existants.

---

## 7. Workflow d'ingestion (par fichier `/raw`)

1. Lire le fichier en entier.
2. Déterminer : type, auteur, date, topics, url, origin (heuristique §5).
3. Créer `/wiki/resources/<slug>.md` avec contenu intégral et chunk annotations.
4. Pour chaque topic : mettre à jour `/wiki/themes/<topic>.md` (ajouter l'entrée
   ressource + liens vers sections concernées).
5. Créer ou mettre à jour `/wiki/authors/<slug-auteur>.md` (ajouter ligne dans table).
6. Ajouter entrées dans `types.md`, `origin.md`, `by-date/`.
7. Mettre à jour `index.md`.
8. Ajouter entrée dans `log.md`.
9. Ajouter nodes/edges dans `graph.json`.
10. Passer `processed: true` dans le frontmatter du fichier `/raw`.

Traiter tout le lot sans demander validation à chaque fichier.
Résumé final : nb ressources créées, tensions détectées, `needs_review` à résoudre.

---

## 8. Workflow de requête (lecture par paliers)

1. Lire `wiki/index.md` → repérer les pages pertinentes.
2. Lire les pages `themes/` ou `authors/` concernées (souvent suffisant).
3. Si détail manquant : ouvrir les pages `resources/` liées.
4. Si vérification fine nécessaire (chiffre exact, citation) : ouvrir `/raw`.

Citer en référençant les pages du wiki, pas le fichier brut.

---

## 9. Workflow de lint (sur demande)

Vérifier et rapporter :
- Ressources sans lien vers un thème/auteur (orphelines).
- Thèmes avec une seule source ou aucune depuis > 6 mois.
- Ressources avec `needs_review: true` non résolu.
- `graph.json` désynchronisé avec les pages `.md`.
- Concepts récurrents sans page de thème dédiée.

Ajouter une entrée `lint` dans `log.md`.

---

## 10. Ce que tu ne dois jamais faire

- Réorganiser `/raw`.
- Écrire du contenu original dans themes/, authors/, by-date/, types.md, origin.md.
- Déduire `origin` depuis le nom de l'auteur, l'URL ou le contenu.
- Raccourcir le contenu d'une ressource pour "faire court" — la fidélité prime.
- Créer un nouveau slug différent de celui déjà assigné à une ressource existante.
