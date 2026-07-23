# Critères de détection des candidats (thèmes / entités) + ouverture des types d'entités

## Contexte

À l'ingestion d'une source, un **unique appel IA** produit la page ressource
canonique **plus** un bloc `<detected-new>` listant les thèmes/entités **inédits**
repérés. Un moteur déterministe (`web/lib/ingest-local.ts` → `buildCandidateOps`)
transforme ces inédits en *candidats* rangés dans
`wiki/entities/_candidates.json` et `wiki/themes/_candidates.json`, arbitrés
ensuite par l'humain sur les pages `/entities` et `/themes` (fusionner / créer /
rejeter). Architecture inchangée : **l'IA propose, l'humain décide.**

Deux problèmes motivent ce chantier :

1. **La détection est peu cadrée.** Le prompt `prompts/ingest-prompt.md` ne
   définit pas ce qui mérite d'être proposé, ni la frontière entité vs thème.
   Surtout, rien n'empêche l'IA de proposer un thème qui est en réalité un
   **synonyme / sous-cas / reformulation** d'un thème existant — ex. proposer
   « coût des tokens » alors que le thème `finops-ia` existe déjà. Résultat : des
   doublons sémantiques polluent la file d'attente.

2. **Les types d'entités sont bridés.** Aujourd'hui l'IA ne peut proposer un
   `entity_type` (le type d'une entité : `tool`, `client`…) que **parmi les types
   déjà présents** dans le registre. Un `entity_type` inédit proposé est **jeté**
   par le code, alors même que la décision finale revient à l'humain. Ça la brime
   inutilement (une personne, une entreprise, un protocole… ne peuvent pas être
   qualifiés).

**Demande d'origine de l'utilisateur** (Arthur, non-développeur, décide du QUOI) :
donner à l'IA des **critères** pour mieux détecter les nouveaux candidats
(thèmes/entités) — sans restreindre l'architecture —, ajouter un **filet
anti-doublon** qui compare aux thèmes/entités déjà existants, et **autoriser** l'IA
à proposer de nouveaux types de liens (la page `/entities` permettra de trancher).

**Cadrage retenu = « option A » (légère) :** on NE modifie PAS la liste des
registres injectée dans le prompt système (elle existe déjà :
`renderRegistrySnapshot`, `web/lib/ingest-local.ts` lignes ~207-220, format
`slug — label (alias : …)`). Le volet anti-doublon est une **consigne** qui
réutilise cette liste existante ; la compréhension sémantique s'appuie sur
`label` + `aliases` et se renforce au fil des arbitrages (chaque fusion humaine
ajoute un alias → le filtre déterministe par forme attrape ensuite le doublon).

---

## Plan

### 1. Prompt — `prompts/ingest-prompt.md` (le gros du travail)

Trois modifications, avec les textes exacts.

**1.a — Insérer une nouvelle section « Critères de détection »** *entre* la
section `## Liens — règle stricte` (se termine actuellement à la puce
« Tout thème/entité **réellement inédit**… ») et la section
`## Bloc \`<detected-new>\` (JSON)`. Texte à insérer :

```markdown
## Critères de détection (entités / thèmes)

Applique ces critères AVANT de reporter un inédit dans `<detected-new>`.

**Entité** = toute chose NOMMÉE et identifiable (un nom propre récurrent). Le
critère décisif est le TEST, pas l'appartenance à une catégorie :
« voudrait-on une page *toutes les ressources qui parlent de X* ? » → oui = entité.
Les types ne sont donnés qu'en illustration NON limitative — outil, modèle,
entreprise, personne, protocole… *cette liste n'est pas exhaustive : détecte tout
nom propre qui passe le test*. Ne reporte PAS les termes génériques du domaine
(IA, LLM, agent, prompt, code, développeur, productivité…) : ce ne sont pas des
entités.

**Thème** = un SUJET / concept transversal (nom commun), pas une chose nommée.
Test : « est-ce un angle qu'on voudrait suivre dans le temps, à travers plusieurs
sources ? » → oui = thème. Ne reporte PAS l'anecdotique (vu une fois, sans portée)
ni une simple reformulation d'un thème existant.

**Frontière entité ↔ thème** : nom propre → entité ; concept ou catégorie → thème.
- `Cursor`, `Anthropic`, `GPT-5`, `MCP` → entités.
- « agentic coding », « revue de code par IA », « les assistants de code » (catégorie) → thèmes.

**Anti-doublon (obligatoire).** Un thème/entité n'est « inédit » que s'il n'est NI
un synonyme, NI une traduction, NI un sous-cas, NI une reformulation d'une entrée
des registres connus (fournis dans le message système). S'il correspond — même
sous d'autres mots — à une entrée existante : RELIE à l'existant, ne le reporte
PAS dans `<detected-new>`. Exemple : « coût des tokens » relève de `finops-ia`
(s'il figure aux registres) → relier, ne pas proposer.
```

**1.b — Modifier la dernière puce de `## Liens — règle stricte`** pour renvoyer à
la définition stricte d'« inédit ».

Texte ACTUEL (à remplacer) :
```markdown
- Tout thème/entité **réellement inédit** (ni connu ni déclaré) → **NE le relie pas** ;
  reporte-le dans `<detected-new>`.
```
Texte CIBLE :
```markdown
- Tout thème/entité **réellement inédit** → **NE le relie pas** ; reporte-le dans
  `<detected-new>`. « Inédit » est défini strictement à la section « Critères de
  détection » ci-dessous (ni connu, ni déclaré, ni synonyme/reformulation d'une
  entrée connue).
```

**1.c — Ouvrir les types d'entités** dans la section `## Bloc \`<detected-new>\` (JSON)`.

Texte ACTUEL (à remplacer) :
```markdown
- entité : `{"name": "Cursor", "entity_type": "tool"|null, "section": "<slug-heading>"|null, "context": "extrait ≤1 ligne"}`
  — `entity_type` proposé **uniquement** parmi les types du registre, sinon `null` ;
  `section` = slug du heading où c'est vu (ou `null` si transverse).
```
Texte CIBLE :
```markdown
- entité : `{"name": "Cursor", "entity_type": "<type>"|null, "section": "<slug-heading>"|null, "context": "extrait ≤1 ligne"}`
  — propose le `entity_type` le plus juste : **réutilise un type existant du
  registre s'il convient, n'en propose un nouveau que s'il est vraiment différent** ;
  `null` si incertain. `section` = slug du heading où c'est vu (ou `null` si transverse).
```

### 2. Code — `web/lib/ingest-local.ts` : `buildCandidateOps`

Dans `buildCandidateOps` (fonction commençant ligne ~622), la ligne qui filtre le
type proposé (actuellement ~ligne 650) **jette** tout type hors registre :

Ligne ACTUELLE :
```js
      const types = d?.entity_type && reg.entityTypes.has(String(d.entity_type)) ? [String(d.entity_type)] : [];
```
Lignes CIBLES (accepter un type inédit, normalisé en slug pour rester cohérent
avec la façon dont les `entity_type` sont stockés/comparés) :
```js
      const t = d?.entity_type ? slugify(String(d.entity_type)) : '';
      const types = t ? [t] : [];
```

- `slugify` est **déjà importé** (`web/lib/ingest-local.ts` ligne 11 :
  `import { slugify } from '@/lib/wiki-parser';`).
- Rien d'autre à toucher : `mergeCandidate` (lignes ~587-619) range déjà
  `suggested_types` (avec dédoublonnage `includes`) et pose la `decision`
  entité-forme dès que le tableau `withTypes` est passé (un tableau vide `[]`
  restant *truthy*, la `decision` garde son champ `entity_type` comme avant).

### 3. Vérificateur — `web/scripts/wiki-verify.ts`

L'alerte `invented-type` (« candidate suggère un type inconnu du registre »)
devient **fausse** : un type inédit est désormais attendu et légitime. Trois
suppressions :

**3.a — Le check** (lignes ~333-339). Supprimer la boucle :
```js
      for (const t of arr(c?.suggested_types))
        if (!registryTypes.has(t))
          add(
            'invented-type',
            'warn',
            `candidate « ${c?.name} » suggère un type inconnu du registre : ${t}`,
          );
```

**3.b — La déclaration orpheline.** `registryTypes` (ligne ~193 :
`const registryTypes = new Set(entities.map((e) => e.entity_type));`) n'est
utilisée QUE par ce check (confirmé par `grep`). La supprimer aussi, sinon
variable inutilisée (erreur lint/TS `noUnusedLocals`).

**3.c — La ligne de doc** en tête de fichier (ligne 11) :
```
 *   - invented-type      : type suggéré d'une candidate hors des types connus
```
La supprimer.

> ⚠ Vérifier que `arr(...)` (utilisé dans la boucle supprimée) reste employé
> ailleurs dans le fichier — c'est le cas ; ne pas le retirer.

### 4. Docs — mise en cohérence

**4.a — `docs/entities.md` §4**, lignes 105-106. Texte ACTUEL :
```
     `wiki/entities/_candidates.json` (l'agent peut **proposer** un `entity_type`
     — TOUJOURS parmi les types déjà présents dans le registre — l'humain confirme).
```
Texte CIBLE (refléter l'ouverture) :
```
     `wiki/entities/_candidates.json` (l'agent peut **proposer** un `entity_type`,
     y compris un type inédit — il réutilise un type existant s'il convient ;
     l'humain tranche sur `/entities`).
```

**4.b — `docs/entities.md` §6**, ligne 189. Supprimer la puce :
```
- `invented-type` — type suggéré d'une candidate hors des types connus ;
```

### 5. Tests (preuve déterministe) — `web/lib/__tests__/ingest-local.test.ts`

Le fichier importe les fonctions via un helper `load()` et met en place un wiki
temporaire `tmp` ; il expose un harnais `runVerify()` (ligne ~339) lançant
`scripts/wiki-verify.ts --json` avec `WIKI_ROOT=<tmp>/wiki`. Un exemple de
registre construit *inline* existe déjà (test `resolveDeclarations`, lignes
~176-195), et une fixture `DETECTED_NEW` avec `entity_type: 'tool'` (type connu)
existe ligne ~334.

Ajouter :

- **Un test unitaire ciblé sur `buildCandidateOps`** prouvant qu'un `entity_type`
  **inédit** survit désormais dans `suggested_types` (avant : `[]`) :
  - registre inline sans le type visé, ex.
    `{ entities: [], themes: [], entityTypes: new Set(['tool']) }` ;
  - `detected = { entities: [{ name: 'Acme Corp', entity_type: 'entreprise', section: null, context: '…' }], themes: [] }` ;
  - appeler `buildCandidateOps(detected, 'demo', reg, [], [], '2026-07-23')` ;
  - récupérer l'op `path === 'wiki/entities/_candidates.json'`, `JSON.parse` son
    `content`, et asserter
    `doc.candidates[0].suggested_types` **deepEqual** `['entreprise']`.
  - NB : `buildCandidateOps` lit l'éventuel `_candidates.json` existant via
    `readRepoFile` (tolère l'absence → repart d'un doc vide) ; en l'absence de
    fichier dans le wiki de test, la candidate est créée de zéro.

- **Une assertion `wiki:verify`** : après avoir écrit dans le wiki de test un
  `entities/_candidates.json` contenant une candidate à `suggested_types`
  inédit (ex. `['entreprise']`), la sortie JSON de `runVerify()` ne contient
  **aucune** issue de catégorie `invented-type`
  (`issues.every((i) => i.category !== 'invented-type')`, en s'alignant sur le
  nom de champ réel des issues émises par `wiki-verify.ts`).

---

## Décisions

- **Option A (légère) plutôt que B (enrichie).** Écarté : ajouter une description
  d'une ligne par thème dans le snapshot des registres pour améliorer la
  compréhension sémantique. Raison : alourdit le prompt (snapshot ~2× sur la
  partie thèmes) et impose de stocker ces descriptions ; le couple
  `label + aliases` + la capitalisation par arbitrage suffit pour démarrer. À
  reconsidérer seulement si des doublons persistent en usage réel.

- **Exemples de types « non limitatifs » plutôt que liste fermée.** Arbitrage
  explicite : une liste fermée d'exemples (« outil, produit, modèle, entreprise,
  personne, client ») biaiserait le modèle à ne détecter QUE ces catégories
  (biais d'ancrage des LLM sur les listes closes → sous-détection d'un protocole,
  benchmark, dataset, événement…). Choix : mettre le **test fonctionnel** comme
  critère décisif, présenter les types en **illustration marquée « non
  exhaustive »**, et garder des **contre-exemples** pour borner la sur-détection.
  Écarté : supprimer complètement les exemples (→ sur-détection : chaque nom
  propre cité en passant deviendrait candidat).

- **Anti-doublon = consigne IA + capitalisation par aliases**, PAS filtre
  déterministe. Écarté : détecter la synonymie sémantique par code. Raison :
  impossible sur des chaînes différentes (« coût des tokens » ≠ « finops-ia » en
  surface) ; seul le jugement du modèle voit le synonyme. Le déterministe
  (`normalizeForm` + `aliases`) n'attrape que les variantes d'écriture. Honnêteté
  assumée : **aucune garantie à 100 %** qu'un doublon ne passe la première fois ;
  mais chaque fusion humaine ajoute un alias → doublon impossible ensuite.

- **Types d'entités ouverts** avec garde-fou anti-prolifération. Choix : autoriser
  un `entity_type` inédit (prompt + code + verify), avec la consigne « réutilise un
  type existant s'il convient ». Raison : la décision revient à l'humain sur
  `/entities` (changer le type, créer, rattacher à une entité existante), donc le
  risque est faible et le gain de qualification réel. Le garde-fou évite
  `entreprise`/`société`/`organisation` en triple.

- **Type proposé normalisé en `slugify`.** Choix : stocker le `suggested_type`
  sous forme de slug (cohérent avec les `entity_type` du registre, qui sont des
  slugs). Effet secondaire utile : deux variantes d'un même type proposé
  (« Entreprise » / « entreprise ») fusionnent via le dédoublonnage de
  `mergeCandidate`.

## Hors périmètre

- **Pas d'option B** (descriptions de thèmes dans le snapshot des registres).
- **Pas de modification de la liste injectée** (`renderRegistrySnapshot`) : elle
  reste `slug — label (alias : …)`. Le volet anti-doublon ne fait que **consigner
  un usage** de cette liste existante — aucune donnée ajoutée.
- **Pas de détection déterministe de synonymie.**
- **Pas de calcul des « proches »** (`suggested_aliases`) sur les pages
  d'arbitrage (option initialement évoquée, écartée).
- **Aucun changement d'architecture** : l'IA propose, l'humain arbitre ; le moteur
  déterministe et l'unique appel IA restent inchangés.
- **Pas de refonte du coût** : l'ajout est ~+300-500 tokens fixes et cachables
  dans le prompt statique ; le coût d'ingestion (~0,12 $/ressource) ne doit pas
  bouger significativement.

## Todo

- [x] **1.a** Insérer la section `## Critères de détection (entités / thèmes)`
  dans `prompts/ingest-prompt.md`, entre `## Liens — règle stricte` et
  `## Bloc \`<detected-new>\` (JSON)` (texte exact fourni au Plan §1.a).
  *Vérif :* la section est présente, avec le test fonctionnel, la mention « liste
  non exhaustive », les contre-exemples et le paragraphe « Anti-doublon ».
- [x] **1.b** Remplacer la dernière puce de `## Liens — règle stricte` (texte
  exact fourni §1.b). *Vérif :* la puce renvoie à « Critères de détection » et ne
  contredit plus la définition d'« inédit ».
- [x] **1.c** Remplacer la ligne « entité » du bloc `<detected-new>` pour ouvrir
  le type (texte exact §1.c). *Vérif :* le prompt ne dit plus « uniquement parmi
  les types du registre » ; il dit « réutilise un type existant… n'en propose un
  nouveau que si vraiment différent ».
- [x] **2** Modifier `buildCandidateOps` dans `web/lib/ingest-local.ts` (ligne
  ~650) selon §2 (via `slugify`). *Vérif :* `npm --prefix web run typecheck`
  (ou build) passe ; le nouveau test unitaire (§5) est vert.
- [x] **3** Retirer le check `invented-type`, la déclaration orpheline
  `registryTypes` et la ligne de doc dans `web/scripts/wiki-verify.ts` (§3.a/b/c).
  *Vérif :* `grep -n "invented-type\|registryTypes" web/scripts/wiki-verify.ts`
  ne renvoie **rien** ; `npm --prefix web run typecheck` passe (pas de variable
  inutilisée).
- [x] **4** Mettre à jour `docs/entities.md` §4 (ligne 105-106) et §6 (ligne 189)
  selon §4. *Vérif :* `grep -n "invented-type\|TOUJOURS parmi les types"
  docs/entities.md` ne renvoie **rien**.
- [x] **5** Ajouter les deux tests dans
  `web/lib/__tests__/ingest-local.test.ts` (§5). *Vérif :*
  `npm --prefix web run test` — le fichier passe, dont l'assertion
  `suggested_types deepEqual ['entreprise']` et l'absence d'issue `invented-type`.
- [x] **6** Lancer la suite complète + le lint wiki. *Vérif :*
  `npm --prefix web run test` **et** `npm --prefix web run wiki:verify`
  (sur le wiki courant) → 0 régression, plus aucune alerte `invented-type`.
- [ ] **7** *(Démonstration bout-en-bout — volet prompt, non testable de façon
  déterministe.)* Si une **clé IA est configurée** (`/reglages`, cf.
  `docs/platform.md` §6) : déposer une source de test citant (a) un doublon
  sémantique évident d'un thème existant (ex. « coût des tokens » avec `finops-ia`
  au registre) et (b) une entité d'un type inédit (une personne ou une
  entreprise), lancer l'ingestion (`POST /api/ingest` ou fin d'upload), puis
  démontrer via l'état/journal (`GET /api/ingest-status`,
  `<DATA_ROOT>/.data/ingest.log`) et les pages `/themes` / `/entities` :
  le doublon **n'apparaît PAS** en candidat thème ; l'entité inédite **apparaît**
  en candidat avec son type proposé ; le `costUsd` reste de l'ordre de
  ~0,12 $/ressource. *À défaut de clé :* la preuve déterministe repose sur les
  tests unitaires du §5 (le comportement anti-doublon côté prompt ne peut pas être
  unit-testé et est validé par inspection + run réel ultérieur).

---

## Bilan

**Fait (conforme au plan, textes exacts appliqués) :**

- **1.a/1.b/1.c — prompt** (`prompts/ingest-prompt.md`) : section « Critères de
  détection (entités / thèmes) » insérée entre `## Liens — règle stricte` et
  `## Bloc <detected-new>` ; dernière puce de « Liens » renvoyée à la définition
  stricte d'« inédit » ; ligne « entité » du bloc `<detected-new>` ouverte
  (`entity_type` libre, consigne « réutilise un type existant s'il convient »).
  Vérif : `grep` des 4 marqueurs (test fonctionnel, « liste non exhaustive »,
  contre-exemples, « Anti-doublon ») + du renvoi + de la nouvelle formulation = OK ;
  l'ancien « uniquement parmi les types du registre » a disparu.
- **2 — code** (`web/lib/ingest-local.ts`, `buildCandidateOps`) : le type proposé
  est désormais `slugify(entity_type)` au lieu d'être filtré au registre. Vérif :
  `tsc --noEmit` = 0 erreur ; test unitaire `suggested_types deepEqual ['entreprise']`
  vert.
- **3 — vérificateur** (`web/scripts/wiki-verify.ts`) : check `invented-type`,
  variable orpheline `registryTypes` et ligne de doc supprimés ; `arr(…)` conservé
  (encore utilisé 6×). Vérif : `grep -n "invented-type\|registryTypes"` = rien ;
  `tsc --noEmit` = 0 erreur (pas de variable inutilisée).
- **4 — docs** (`docs/entities.md` §4 et §6) : §4 reflète l'ouverture des types ;
  puce `invented-type` retirée du §6. Vérif : `grep` de `invented-type` / « TOUJOURS
  parmi les types » = rien.
- **5 — tests** (`web/lib/__tests__/ingest-local.test.ts`) : deux tests ajoutés,
  tous deux verts — (a) `buildCandidateOps` : un `entity_type` inédit (« entreprise »)
  survit slugifié dans `suggested_types` ; (b) `wiki:verify` : une candidate à type
  inédit ne produit **aucune** issue `invented-type`.
- **6 — vérif globale** : `tsc --noEmit` OK ; `wiki:verify` sur le wiki réel **ne
  produit plus aucune alerte `invented-type`** (objectif du chantier atteint).

**Déviations / points signalés (aucun changement de périmètre) :**

- **Pas de script `typecheck`** dans `web/package.json` : la spec citait
  `npm run typecheck`. Utilisé `npx tsc --noEmit` à la place (équivalent, EXIT=0) —
  aucune modif de `package.json` de ma part.
- **Arbre de travail partagé avec une AUTRE session** (chantier « entités frontmatter
  graphe », spec `tasks/specs/2026-07-23-entites-frontmatter-graphe.md` non suivie) :
  au démarrage, `ingest-local.ts`, `wiki-verify.ts`, `ingest-local.test.ts`,
  `wiki-mutate.ts`, `wiki-project.ts`, `package.json`, `wiki-project.test.ts`
  portaient DÉJÀ des modifications non commitées de ce chantier (ajout de
  `rollupSectionEntities`, du check `graph-unlabeled-node`, etc.). **Mes changements
  sont propres et isolables** (2 lignes dans `ingest-local.ts`, 3 suppressions dans
  `wiki-verify.ts`, 2 tests) mais **cohabitent dans les mêmes fichiers** que ceux de
  l'autre chantier → un commit « en bloc » emporterait du travail qui n'est pas le
  mien. Conséquence pour l'étape commit ci-dessous.
- **1 test en échec, pré-existant et data-dépendant** (hors de mon scope) :
  `wiki-tools.test.ts` « list_wiki_folder(resources) renvoie les 13 fiches » attend
  `13` mais le wiki réel en compte `17` (nouvelles sources ajoutées par d'autres
  commits). Mon diff ne touche ni `wiki-tools`, ni `wiki/resources/` → échec présent
  aussi sur `main`. Idem pour les erreurs `wiki:verify` `graph-unlabeled-node`
  (n8n/supabase/databricks) et `missed-link` (ChatGPT) : elles proviennent du check
  ajouté par l'AUTRE chantier appliqué aux données réelles, pas de mon changement.
- **7 — démo bout-en-bout : NON exécutée** (aucune clé IA configurée dans cette
  session ; volet prompt non testable de façon déterministe). Conformément à la spec,
  la preuve repose sur les tests unitaires du §5 ; le comportement anti-doublon côté
  prompt reste à valider par un run réel ultérieur quand une clé sera disponible.

---

**Fichier créé :** `tasks/specs/2026-07-23-criteres-detection-candidats.md`

**Commande à taper dans une nouvelle session :**
`/implement @tasks/specs/2026-07-23-criteres-detection-candidats.md`
