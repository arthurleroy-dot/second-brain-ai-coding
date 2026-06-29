# CLAUDE.md — Agent mainteneur du wiki AI Coding

Tu maintiens un **wiki collaboratif sur l'AI Coding**. À partir des fichiers déposés dans `/raw`, tu construis et enrichis un wiki structuré dans `/wiki`.

## Arborescence du wiki

```
/wiki/
├── by-type/        ← MAISON PHYSIQUE : 1 fichier complet par ressource
│   ├── articles/ meeting-notes/ interviews/ presentations/
│   ├── transcripts/ personal-notes/ unknown/
│   └── <type>/index.md + <type>/[slug].md
├── by-author/      ← POINTEURS uniquement (index de liens)
│   └── [auteur]/index.md   (+ unknown/)
├── by-date/        ← POINTEURS uniquement (index de liens)
│   └── [YYYY]/[YYYY-MM]/index.md   (+ [YYYY]/unknown/, + unknown/)
├── by-topic/       ← pages thématiques de synthèse (transversales)
│   └── agentic-coding.md finops-ia.md outils-et-marche.md
│       transformation-organisationnelle.md securite-et-risques.md
│       context-engineering.md
├── index.md        ← index général (4 axes)
└── log.md          ← journal des runs
```

**Règle fondamentale** : le contenu complet d'une ressource vit **uniquement** dans `by-type/[type]/[slug].md`. `by-author/` et `by-date/` ne contiennent que des `index.md` listant des liens vers `by-type/`.

## Standard de métadonnées

Fichier texte `/raw` (`.md`, `.txt`) → frontmatter YAML en tête :
```yaml
---
type: article | meeting_note | interview | presentation | transcript | personal_note
author: "Nom ou organisation"   # vide ou "unknown" si inconnu
date: "YYYY-MM-DD"               # vide si inconnue ; "YYYY" si seule l'année est connue
url: "https://..."               # vide si absent
deposited_by: "Prénom"           # membre de l'équipe ; vide si inconnu
topics: [agentic-coding, finops-ia]
needs_review: false              # true si une info manque ou est imprécise
processed: false
---
```

Fichier binaire `/raw` (PDF, PPTX…) → sidecar `[nom-exact].meta.md` à côté, avec les mêmes champs + `source_file:` et une section `## Notes extraites automatiquement`. **Ne supprime jamais** le binaire ni ses marqueurs : ils servent de trace des sources.

Métadonnée manquante : `type`→`unknown`, `author`→`unknown`, `date` absente → pas de classement par date. Jamais de valeur inventée ; marque `needs_review: true`.

## Workflow de traitement (par fichier de `/raw`)

1. **Déjà traité ?** Texte avec `processed: true`, ou binaire dont le sidecar `.meta.md` (ou l'ancien marqueur `.processed`) indique `processed: true` → **ignorer**.
2. **Binaire sans sidecar** → crée `[nom].meta.md` (titre/auteur/date extraits ; incertain → vide + `needs_review: true`).
3. **Extrais** les métadonnées et les concepts clés.
4. **Détermine le classement** avec fallback (`unknown` si besoin).
5. **Crée les dossiers manquants** toi-même (`by-type/[type]/`, `by-author/[auteur]/`, `by-date/[YYYY]/[YYYY-MM]/`).
6. **Crée la fiche** `by-type/[type]/[slug].md` (slug = nom du fichier source en minuscules-tirets) avec le template ci-dessous.
7. **Mets à jour les index** : `by-type/[type]/index.md`, `by-author/[auteur]/index.md`, `by-date/[YYYY]/[YYYY-MM]/index.md` (si date connue). Réévalue les compteurs « N ressource(s) ».
8. **Enrichis les pages `by-topic/`** concernées avec les nouveaux concepts.
9. **Marque comme traité** : texte → `processed: true` dans le frontmatter ; binaire → `processed: true` dans le sidecar.
10. **Mets à jour** `wiki/index.md` et `wiki/log.md`.

## Granularité

1 fiche = **1 source déposée dans `/raw`**. Les citations externes contenues dans une source (Gartner, Stanford HAI…) restent des citations, pas des fiches autonomes. 1 page `by-topic/` = **un thème stable** : plusieurs sources enrichissent la même page thématique.

## Règles d'or

- **Ne supprime JAMAIS** d'information existante dans `/wiki` : tu enrichis uniquement.
- Le contenu complet vit dans `by-type/` ; `by-author/` et `by-date/` ne contiennent que des liens.
- Reporte les **sources avec URL et date** dès qu'elles sont disponibles.
- Métadonnée manquante → `unknown` / champ vide + `needs_review: true`. Jamais de valeur inventée.
- **Contributeurs** : distingue l'**auteur de la source** (créateur du contenu) du **membre de l'équipe** qui a déposé le fichier (`deposited_by`).
- **Cross-références** : relie les pages avec `[[nom-de-la-page]]` (les slugs `by-topic/` existants : `agentic-coding`, `finops-ia`, `outils-et-marche`, `transformation-organisationnelle`, `securite-et-risques`, `context-engineering`).
- **Log** : à chaque run, ajoute dans `wiki/log.md` une entrée commençant par `## [YYYY-MM-DD]` (fichiers traités, fiches et pages créées/enrichies).

## Réponse aux questions en langage naturel

Route selon l'axe : auteur → `by-author/[auteur]/index.md` ; date/mois → `by-date/[YYYY]/[YYYY-MM]/index.md` ; type → `by-type/[type]/index.md` ; thème → `by-topic/*.md`. Combine les axes si besoin (« McKinsey sur le FinOps » = `by-author/mckinsey/` ∩ `by-topic/finops-ia.md`). Cite toujours : titre, auteur, type, date (ou « date inconnue »), lien vers la fiche.

## Format d'un fichier de ressource individuel

Chaque ressource dans `by-type/[type]/[slug].md` suit ce template :

```markdown
---
slug: [slug-unique]
type: [type]
author: "[auteur]"
date: "[YYYY-MM-DD ou vide]"
url: "[url ou vide]"
deposited_by: "[prénom ou vide]"
topics: [liste]
source_file: "[chemin vers /raw]"
needs_review: false
---

# [Titre de la ressource]

## Résumé
[3 à 5 lignes donnant le contexte général du document — qui l'a écrit, pourquoi, quel est son propos central]

## Contenu complet
[Retranscription quasi intégrale du document source.
Règles strictes :
- Ne résume PAS, ne condense PAS
- Retranscris tous les arguments, sections, sous-sections dans leur ordre d'apparition
- Inclus tous les chiffres, statistiques, pourcentages, dates mentionnés
- Inclus toutes les citations et formulations notables entre guillemets
- Inclus les tableaux, listes, frameworks, modèles décrits dans le document
- Inclus les conclusions et recommandations
- Si le document est structuré en parties, reproduis cette structure avec les mêmes titres
- L'objectif est que n'importe quelle question sur un détail du document
  puisse trouver sa réponse ici sans avoir à ouvrir le fichier source]

## Concepts clés
[Liste exhaustive des concepts, frameworks, termes techniques et idées principales
présents dans le document — extraits du contenu complet ci-dessus]

## Citations et formulations notables
[Les phrases marquantes, définitions précises, ou formulations importantes
du document original, entre guillemets avec indication de la section d'origine]

## Données et chiffres clés
[Tous les chiffres, statistiques, pourcentages, dates, et données quantitatives
mentionnés dans le document, avec leur contexte]

## Liens connexes
- Topics : [[topic-1]] [[topic-2]]
- Auteur : [lien vers by-author/[auteur]/index.md]
- Date : [lien vers by-date/[YYYY]/[YYYY-MM]/index.md]
```

Les `index.md` de `by-type/`, `by-author/`, `by-date/` sont des tableaux (`> N ressource(s)` + colonnes Titre/Auteur ou Type/Date/Topics/Fichier).

## Commandes

Le dossier `.claude/commands` (skills `process-raw`, `lint`, `save-answer`) contient des actions manuelles. Quand on te demande d'exécuter une commande, lis le fichier correspondant et applique ses instructions.
