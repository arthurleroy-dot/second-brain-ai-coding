# Spécification du wiki

Formats de fichiers et règles de structure du wiki. Lis ce document avant toute
opération d'ingestion, de requête ou de lint. Le pipeline d'ingestion lui-même
est décrit dans [ingestion.md](ingestion.md) ; le système d'entités dans
[entities.md](entities.md).

---

## 1. Architecture en 3 couches

```
/raw/                          ← Couche 1 : sources immuables (JAMAIS modifiées par l'agent)
  README.md                    ← règles de dépôt (ne pas toucher)
  <source>                     ← fichier de contenu brut (.md, .txt, .pdf, .pptx, .docx)
  <source>.meta.md             ← sidecar de métadonnées (frontmatter saisi à l'upload)

/wiki/                         ← Couches 2 & 3 (SEULE zone d'écriture de l'agent)
  resources/                   ← Couche 2 : CANONIQUE — une page par source brute
    <slug>.md                  ← contenu intégral, verbatim + annoté par chunk
  themes/                      ← Couche 3 : vue dérivée — liens vers chunks
    <slug-theme>.md
  authors/                     ← Couche 3 : vue dérivée — table
    <slug-auteur>.md
  entities/                    ← Couche 3 : registre des liens (outils, clients, …)
    <slug>.md                  ← voir entities.md
    _candidates.json           ← file des candidates (contrat lu par la plateforme)
  by-date/                     ← Couche 3 : vue dérivée — index temporel
    <YYYY>/<YYYY>.md
    <YYYY>/<YYYY-MM>/<YYYY-MM>.md
  index.md                     ← catalogue général
  graph.json                   ← export machine-readable
  types.md                     ← index par type (article, report-pdf, etc.)
  origin/                      ← vue dérivée — une page par origine (nœud Obsidian)
    interne.md
    externe.md
  log.md                       ← journal append-only
  _ingested.json               ← manifeste : quels fichiers /raw ont déjà été ingérés
```

**Règle cardinale :** `resources/*.md` est la source de vérité du contenu.
Toutes les autres pages sous `wiki/` sont des **vues dérivées** générées depuis
les ressources. Ne jamais écrire de contenu original dans themes/, authors/,
entities/, by-date/, types.md, origin/.

**Frontières d'écriture :** l'ingestion n'écrit **que** dans `wiki/` (l'IA ne produit
que la page ressource ; c'est le moteur déterministe qui écrit les vues). Jamais dans
`raw/` (immuable), jamais dans `web/`. Le marqueur « déjà traité » vit dans
`wiki/_ingested.json`, pas dans un frontmatter de `raw/`.

---

## 2. Format des ressources (`/wiki/resources/<slug>.md`)

### 2.1 Frontmatter

```yaml
---
slug: <slug-stable>           # dérivé du titre, minuscules+tirets, max 60 chars, immuable
title: "Titre complet"
author: "Nom Auteur / Organisation"
date: "2026-04"               # AAAA | AAAA-MM | AAAA-MM-JJ
source_type: article          # slug kebab — REGISTRE OUVERT & ÉDITABLE (wiki/types.json) ; graine par défaut : article | report-pdf | personal-notes | meeting-notes | interview | presentation | transcript | unknown ; ajout/renommage/suppression via /upload (tant que 0 ressource ne porte le type) ; tout slug reste un source_type valide
origin: externe               # interne | externe — déterminé par heuristique (voir §5)
topics: [finops-ia, agentic-coding]   # union de tous les topics de sections
entities: [n8n]               # entités liées au niveau ressource (optionnel — voir entities.md)
url: "https://..."
source_file: "<nom exact dans /raw>"   # nom du fichier de CONTENU (pas le .meta.md)
---
```

### 2.2 Blockquote de navigation (Obsidian)

Immédiatement sous le frontmatter, une ligne blockquote de wikilinks vers les
vues dérivées, pour la navigation dans Obsidian :

```markdown
> Par [[../authors/<slug-auteur>|Auteur]] · [[../by-date/2026/2026|2026]] · Thèmes : [[../themes/finops-ia|FinOps IA]]
```

### 2.3 Chunk annotation

Chaque section `##` ou `###` porte, immédiatement après le heading, une ligne
`topics:` et (si pertinent) une ligne `entities:` :

```markdown
## Titre de section
`topics: [finops-ia, agentic-coding]`
`entities: [claude-code, n8n]`

Contenu de la section...
```

La ligne `entities:` est optionnelle et n'apparaît que sur les sections qui
mentionnent effectivement une entité du registre (voir [entities.md](entities.md)).

#### 2.3 bis Bloc figure (passe vision PDF)

Une figure d'un PDF (schéma, tableau-image, courbe, timeline, organigramme) que
l'extraction texte ne capte pas est représentée par un **bloc figure** = une section
`##` normale (indexée comme les autres), au format suivant :

```markdown
## {Titre court de la figure}
`topics: [slug…]`
`entities: [slug…]`

{Phrase de légende terminée par un point.} *(Figure — description machine, page {N} de la source, non-verbatim.)*

![{Titre}](/api/raw-image/{fichier}?page={N})

**Texte littéral :** « {label1} » · « {label2} » · …

{Représentation selon le type : tableau markdown | liste de phases | « A → B → C » | axes+forme}
```

- La **1ʳᵉ ligne de prose** DOIT être la légende terminée par un point (→ `takeaway` propre).
- La ligne `![…](/api/raw-image/{fichier}?page={N})` est l'**ancre de page** du rattrapage
  (§ rattrapage) ; `{fichier}` = `source_file` exact.
- La passe vision (Haiku) émet le bloc **sans** annotations `topics:`/`entities:` ; c'est
  l'IA d'ingestion qui les ajoute (elle a le registre), comme pour toute section.

#### 2.3 ter Bloc formule (maths reconstruites)

Une **formule mathématique** de la source (équation, matrice, vecteur, somme, fraction,
exposant/indice) — **y compris dessinée en caractères** (crochets Unicode `⎡ ⎣ ⎢ ⎤ ⎦`,
ASCII-art, ou Unicode « cassé » d'un copier-coller web) — est **transcrite en LaTeX** dans
un **bloc formule** au format EXACT (display math + marqueur de reconstruction dessous) :

```markdown
$$
A = \begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}
\qquad
A^\top = \begin{bmatrix} 1 & 4 \\ 2 & 5 \\ 3 & 6 \end{bmatrix}
$$
*(Formule reconstruite — non-verbatim.)*
```

- Ouverture `$$` et fermeture `$$` **chacune sur sa propre ligne** ; le LaTeX entre les deux.
- **Display `$$…$$` seulement** — jamais de simple `$…$` inline (désactivé côté rendu pour ne
  pas confondre avec les prix en dollars, cf. `Markdown.tsx` : `singleDollarTextMath: false`).
- La ligne suivante = le **marqueur** littéral `*(Formule reconstruite — non-verbatim.)*`
  (em dash `—`) : il signale la transcription non-verbatim (honnêteté, règle 6) ET sert
  d'**ancre** à la révision (index d'apparition, cf. `web/lib/formula-block.ts`). Il n'est
  PAS retiré à l'affichage (`stripChunkAnnotations` ne le touche pas).
- **Trois paliers (comme le bloc figure)** : littéral (symboles/nombres/indices/exposants
  exacts) ; structurel (dimensions, ordre des termes) ; sens — **INTERDIT** (ne pas
  interpréter, calculer, compléter ni « corriger » une formule qui semble fausse).
- C'est la **seconde et dernière dérogation** au strict verbatim (après le bloc figure),
  autorisée **parce qu'elle est explicitement marquée**. La source brute reste dans `raw/`.

**Code (mise en forme, pas une dérogation).** Le code de la source (extrait de programme,
commande, config, pseudo-code) est encadré en **bloc de code markdown** ```` ```langage ````
(langage si évident, sinon ```` ``` ```` nu), **recopié mot pour mot** (indentation comprise)
— du **pur verbatim**, au même titre qu'un tableau. Le code inline court reste en
`` `inline-code` ``. Rendu coloré par `rehype-highlight` (cf. `Markdown.tsx`).

### 2.4 Contenu

- **Intégral et fidèle** : reproduire toute l'information, chaque chiffre, chaque
  exemple, chaque citation nommée. **Verbatim : recopie mot pour mot, même langue.**
  Reformulation/résumé/traduction/ajout interdits ; seuls le nettoyage des scories
  d'extraction, la mise en markdown (**y compris les blocs de code ```` ```langage ````,
  §2.3 ter**), **le bloc figure marqué « description machine » (§2.3 bis)** et **le bloc
  formule marqué « reconstruite » (§2.3 ter)** sont permis. Le `page=N` d'un bloc figure
  est la SEULE référence de page conservée (le reste des numéros de page = scorie à retirer).
- Pas de résumé court : une source longue → une page longue.

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
aliases: [finops ia, ai finops]   # écritures alternatives reconnues (optionnel)
resource_count: N
last_updated: "AAAA-MM-JJ"
---

## [[resources/<slug>|Titre de la ressource]]
`date · source_type · origin — Auteur`

- [[resources/<slug>#section-heading|Titre de section]] — take-away en 1 ligne
```

Le champ `aliases:` (optionnel) recense les écritures alternatives d'un thème ; il
est alimenté par la fusion d'un thème candidat (décision `merge_alias`, page
`/themes`) pour qu'une variante déjà arbitrée ne redevienne pas une candidate.

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

### by-date/<YYYY>/<YYYY-MM>/<YYYY-MM>.md
Table des ressources publiées ce mois-là. Idem pour `<YYYY>/<YYYY>.md` (liste
les mois + ressources sans date précise). Les fichiers portent le nom de la
période (et non `index.md`) pour un affichage lisible dans le graphe Obsidian.

### entities/<slug>.md
Registre + vue dérivée des mentions. Voir [entities.md](entities.md).

### graph.json

Types de nodes : `resource`, `author`, `theme`, `entity`, `source_type`,
`origin`, `date`.

Types d'edges :

| Edge | Source → Target | Signification |
|------|------------------|----------------|
| `written_by` | resource → author | Cette ressource a été écrite par cet auteur |
| `has_type` | resource → source_type | Type de contenu de cette ressource |
| `has_origin` | resource → origin | Origine interne ou externe |
| `belongs_to_theme` | resource → theme | Cette ressource aborde ce thème |
| `mentions` | resource → entity | Cette ressource mentionne cette entité (voir entities.md) |
| `published_on` | resource → date | Date de publication |
| `year_of` | date (mois) → date (année) | Hiérarchie temporelle |

```json
{
  "generated": "AAAA-MM-JJ",
  "nodes": [
    {"id": "resource:<slug>", "type": "resource", "label": "..."},
    {"id": "theme:<slug>", "type": "theme", "label": "..."},
    {"id": "author:<slug>", "type": "author", "label": "..."},
    {"id": "entity:<slug>", "type": "entity", "entity_type": "tool", "label": "..."},
    {"id": "type:article", "type": "source_type", "label": "Article"},
    {"id": "origin:externe", "type": "origin", "label": "Externe"},
    {"id": "origin:interne", "type": "origin", "label": "Interne"},
    {"id": "date:2026", "type": "date", "label": "2026", "granularity": "year"},
    {"id": "date:2026-04", "type": "date", "label": "2026-04", "granularity": "month", "year": "2026"}
  ],
  "edges": [
    {"source": "resource:<slug>", "target": "author:<slug>", "relation": "written_by"},
    {"source": "resource:<slug>", "target": "type:article", "relation": "has_type"},
    {"source": "resource:<slug>", "target": "origin:externe", "relation": "has_origin"},
    {"source": "resource:<slug>", "target": "theme:<slug>", "relation": "belongs_to_theme"},
    {"source": "resource:<slug>", "target": "entity:n8n", "relation": "mentions", "sections": ["heading-slug"]},
    {"source": "resource:<slug>", "target": "date:2026-04", "relation": "published_on"},
    {"source": "date:2026-04", "target": "date:2026", "relation": "year_of"}
  ]
}
```
Ne pas ajouter d'arête `has_origin` si `origin` est inconnu pour une ressource.
Toujours matérialiser les **deux** nœuds `origin:interne` et `origin:externe`
(même à 0 ressource) et leurs pages `origin/interne.md` + `origin/externe.md` :
les deux origines doivent apparaître comme des nœuds distincts dans le graphe
d'Obsidian, chaque page reliant ses ressources par wikilink (miroir de `themes/`).
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

## 5. Origine, date et type — remplissage déterministe

Depuis le chantier 2026-07-28, **l'IA ne décide plus l'origine** ; l'origine, la date
et le type sont garantis par un **moteur déterministe** (les `force*` de
`ingest-local.ts`, appliqués au dépôt LIVE avant projection). Plus aucune fiche ne sort
de l'ingestion avec une origine ou une date vide.

- **Origine (BINAIRE, `interne`|`externe`) — 100 % déterministe.** Cascade `forceOrigin`
  (le 1er qui s'applique gagne) : (1) origine **déclarée** au dépôt (clé `origin:` du
  sidecar) — prioritaire, **même en contradiction avec le type** ; (2) sinon origine du
  **type** final, via le registre `wiki/types.json` (map slug→origine — chaque type porte
  une origine par défaut, cf. graine `BUILTIN_TYPE_ORIGIN` dans `web/lib/ui.ts`) ;
  (3) filet edge (type hors map) → `externe`. L'origine écrite par l'IA est ignorée.
  Pour un document exceptionnel (ex. un article réellement interne), **déclarer** l'origine
  au dépôt.
- **Type — « Auto » par défaut.** Le menu de dépôt démarre sur **« Auto (déduit par
  l'IA) »** (plus de défaut `article` trompeur). En Auto, aucun `type:` n'est écrit au
  sidecar → l'IA **déduit** le type parmi les « Types de ressource connus » ; repli
  déterministe `unknown` (`forceType`) si elle n'en produit aucun d'exploitable.
- **Date — extraite du document, sinon mois courant.** Cascade `forceDate` :
  (1) date **déclarée** au dépôt ; (2) sinon date **extraite** par l'IA de l'en-tête /
  chapô / métadonnées du document ; (3) sinon **mois courant** (`AAAA-MM`).

Changer l'origine par défaut d'un type (via `/upload` → « Gérer les types ») **ne
reclasse pas** les ressources déjà ingérées — seulement les futurs dépôts.

---

## 6. Thèmes courants (à utiliser en priorité)

`finops-ia` · `agentic-coding` · `transformation-organisationnelle` ·
`outils-et-marche` · `securite-et-risques` · `context-engineering`

Relier en priorité à l'un de ces thèmes existants. **La création d'un thème est
gardée**, exactement comme celle d'une entité (cf. [entities.md](entities.md) §4) :

- **Thème déclaré à l'upload** (`themes:` du sidecar) → l'agent le crée/relie
  DIRECTEMENT, même nouveau (confiance au choix humain). Pas de dimension `type`.
- **Thème détecté** dans le contenu et inédit (aucun thème existant ne colle) →
  l'agent NE le crée PAS : il pose une candidate dans `wiki/themes/_candidates.json`
  (mêmes champs que les entités, **sans** `suggested_types`/`entity_type`), que
  l'humain arbitre depuis la page `/themes` (**fusionner / créer / rejeter**).
- Avant toute création : dédoublonnage sur `label`+`aliases` normalisés.

`themes_granularity` (sidecar, sinon `auto`) est un indice grossier resource/chunk
— l'IA choisit les sections exactes à l'ingestion.

---

## 7. Workflow de requête (lecture par paliers)

1. Lire `wiki/index.md` → repérer les pages pertinentes.
2. Lire les pages `themes/`, `authors/` ou `entities/` concernées (souvent suffisant).
3. Si détail manquant : ouvrir les pages `resources/` liées.
4. Si vérification fine nécessaire (chiffre exact, citation) : ouvrir `/raw`.

Citer en référençant les pages du wiki, pas le fichier brut.

---

## 8. Workflow de lint (sur demande)

Vérifier et rapporter :
- Ressources sans lien vers un thème/auteur (orphelines).
- Thèmes avec une seule source ou aucune depuis > 6 mois.
- Entités en attente dans `entities/_candidates.json` ou thèmes en attente dans
  `themes/_candidates.json` (ou `wiki:verify` en erreur).
- `graph.json` désynchronisé avec les pages `.md`.
- `_ingested.json` désynchronisé : fichier `/raw` sans entrée, ou entrée pointant
  vers une ressource inexistante, ou `source_file` d'une ressource absent du manifeste.
- Concepts récurrents sans page de thème dédiée.

Ajouter une entrée `lint` dans `log.md`.

---

## 9. Ce que tu ne dois jamais faire

- Écrire, renommer ou réorganiser quoi que ce soit sous `/raw` (immuable). _Seule
  exception :_ la **suppression** d'une ressource via la plateforme retire son
  fichier brut — chemin déterministe dédié (`web/lib/wiki-mutate.ts`), pas l'agent.
- Écrire du contenu original dans themes/, authors/, entities/, by-date/, types.md, origin/.
- Déduire `origin` depuis le nom de l'auteur, l'URL ou le contenu.
- Raccourcir le contenu d'une ressource pour "faire court" — la fidélité prime.
- Créer un nouveau slug différent de celui déjà assigné à une ressource existante.
- Créer silencieusement une entité inconnue — la mettre en candidate (voir entities.md).
