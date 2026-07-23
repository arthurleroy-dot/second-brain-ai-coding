# Ingestion en mode « verbatim nettoyé »

## Contexte

Le moteur d'ingestion (`web/lib/ingest-local.ts`) fait **UN appel IA par ressource** qui produit
la page ressource canonique `wiki/resources/<slug>.md` ; un moteur déterministe
(`web/lib/wiki-project.ts`) reconstruit ensuite toutes les vues dérivées. Le prompt système
statique est `prompts/ingest-prompt.md`.

Aujourd'hui, ce prompt impose à l'IA de **paraphraser** la source (« contenu intégral
paraphrasé », « paraphrasés mais non raccourcis »). C'est aussi une règle du projet
(CLAUDE.md règle cardinale 6, `docs/wiki-spec.md` §2.4). **Problème constaté par l'utilisateur :**
sur une source courte, la consigne « reproduire toute l'information, non raccourcie » pousse le
modèle à **inventer du contenu**. Exemple réel : `raw/note-2.txt` contenait exactement deux
lignes —

```
Finops c'est le financement des tokens

COntexte engineering
```

— et l'ingestion a produit deux paragraphes de prose (« Le FinOps dans le contexte de
l'intelligence artificielle concerne directement le financement et la gestion des coûts liés à
la consommation de tokens… ») **absents de la source**. C'est un problème de **confiance** : on
ne distingue plus ce que la source disait de ce que l'IA a brodé.

**Demande de l'utilisateur (Arthur) :** que l'IA **recopie le texte de la source mot pour mot**
et se contente de le mettre en markdown. Pas de reformulation, pas d'expansion, pas de résumé,
**pas de traduction — même langue que la source**. Pour **tous** les types de ressources
(PDF, notes perso, rapport, article, etc.).

**Note sur le coût (pour cadrer les attentes, pas un objectif) :** le coût d'un appel se paie au
**token de sortie émis** (barème Sonnet : sortie facturée 5× l'entrée). Conséquence : le verbatim
rend les **notes moins chères** (fin du remplissage inventé → sortie plus courte) mais laisse les
**gros PDF à ~coût égal** (on ré-émet le même volume de texte, verbatim ou paraphrase). Le gain
principal de ce chantier est la **fidélité**, pas le budget.

## Plan

> Contenu intégral du plan validé, tel quel.

### Décisions produit validées avec Arthur

1. **Fidélité = « exact, nettoyé »** : mots/chiffres/phrases/langue identiques à la source ;
   on retire uniquement les scories d'extraction (n° de page, en-têtes/pieds répétés) et on
   recolle les mots coupés en fin de ligne. Aucune reformulation.
2. **Navigation fine conservée** : on garde les repères invisibles par section (annotations
   `topics:`/`entities:` sous chaque titre) — le lecteur voit du verbatim pur (ces repères
   sont masqués à l'affichage via `stripChunkAnnotations`), mais les pages Thèmes/Entités
   continuent de pointer vers le **passage précis**.

### Principe : ce qui change vs ce qui ne bouge pas

**Change** — la doctrine de rédaction du CORPS : « paraphrase intégrale » → « verbatim
nettoyé ». C'est essentiellement une réécriture de prompt + de docs, plus deux retouches code.

**Ne bouge PAS** (à préserver tel quel) :
- Le frontmatter (schéma inchangé : `slug`, `title`, `author`, `date`, `source_type`,
  `origin`, `topics`, `entities`, `url`, `source_file`, `needs_review`).
- Le blockquote de navigation en tête de fiche.
- Les annotations de chunk `topics:`/`entities:` sous chaque titre (choix « navigation fine »).
- Le bloc `<detected-new>` et les règles de liens (registres connus/déclarés).
- Tout le moteur déterministe (`web/lib/wiki-project.ts`, `wiki-mutate.ts`) : il extrait déjà
  le « take-away » comme **première phrase de la prose de section** (`firstSentence`,
  `wiki-project.ts:104-111`, `:143`, `:390`) — avec du verbatim, ce sera la 1re phrase du
  texte source, ce qui reste pertinent. Aucun changement moteur nécessaire.

**Ligne rouge à graver dans le prompt** : le « nettoyage » autorisé se limite à retirer les
scories non-contenu (n° de page, en-têtes/pieds répétés) et à recoller les mots coupés. Il ne
doit JAMAIS servir de prétexte à réordonner, corriger ou reformuler des mots de contenu. Cette
frontière doit être formulée sans ambiguïté, sinon le modèle « améliorera » le texte.

### Fichiers à modifier

#### 1. `prompts/ingest-prompt.md` — LE fichier central (instruction réellement suivie)

Fichier de 98 lignes. Structure actuelle pertinente :
- Lignes 46-57 : `## Corps de la ressource` (point 1 = blockquote nav lignes 48-51 ; point 2 =
  « contenu **intégral paraphrasé** » + annotations lignes 52-55 ; point 3 = « Texte brut →
  markdown propre » lignes 56-57).
- Lignes 95-98 : `## Fidélité` (« Fidélité > brièveté : reproduis TOUS les chiffres, exemples,
  citations de la source, paraphrasés mais non raccourcis. Une section = un `##`/`###`. »).

Modifications :
- **Ligne 52** : « Le contenu **intégral paraphrasé**, découpé en sections `##`/`###` » →
  « Le contenu **intégral, recopié mot pour mot (verbatim), dans la langue d'origine**,
  découpé en sections `##`/`###` ». Conserver l'exigence d'annotation qui suit (lignes 53-55).
- **Lignes 56-57** : reformuler « **Texte brut → markdown propre** : structure une source non
  formatée (titres, paragraphes, listes) en préservant TOUTE l'information » en : mets en forme
  (titres, paragraphes, listes, tableaux) le **texte source exact** ; recolle les mots coupés
  en fin de ligne ; retire les scories d'extraction (n° de page, en-têtes/pieds répétés) ;
  **n'ajoute, ne reformule, ne résume, ne traduis, ne corrige RIEN d'autre**.
- **Lignes 95-98 (`## Fidélité`)** : remplacer « paraphrasés mais non raccourcis » par une règle
  **verbatim absolue** : recopie le texte source mot pour mot, même langue ; tous les chiffres,
  phrases et citations à l'identique ; tu mets en markdown, tu ne réécris pas ; interdits
  explicites : reformuler, résumer, compléter, traduire, inventer une phrase absente. Conserver
  « Une section = un `##`/`###`. ».
- **Intro (lignes 1-7)** : ajouter une phrase cadre « Règle absolue : verbatim — tu transcris,
  tu ne rédiges pas », pour que le modèle traite ça comme une contrainte dure.
- Préciser que blockquote de navigation + annotations `topics:`/`entities:` sont les **seuls**
  ajouts structurels autorisés ; tout le reste du corps = texte source.

#### 2. `CLAUDE.md` — règle cardinale n°6 (lignes 48-49)

Texte actuel : « **Fidélité > brièveté** : une ressource reproduit toute l'information de la
source (chiffres, exemples, citations), paraphrasée mais non raccourcie. »
Remplacer par la doctrine verbatim : la ressource reproduit le texte de la source **mot pour
mot**, même langue ; l'IA met en markdown, ne reformule/résume/traduit/ajoute jamais ; seuls
ajouts = repères structurels (blockquote nav, annotations `topics:`/`entities:`).

#### 3. `docs/wiki-spec.md`

- **Ligne 20** (arbre d'architecture) : « `<slug>.md` ← contenu intégral, paraphrasé + annoté
  par chunk » → « …**verbatim** + annoté par chunk ».
- **Lignes 100-101** (§2.4 Contenu) : « **Intégral et fidèle** : reproduire toute l'information,
  chaque chiffre, chaque exemple, chaque citation nommée. Paraphrase acceptable, raccourcissement
  non. » → remplacer la 2e phrase par « **Verbatim : recopie mot pour mot, même langue.**
  Reformulation/résumé/traduction/ajout interdits ; seuls le nettoyage des scories d'extraction
  et la mise en markdown sont permis. »
- **Ligne 102** (« Pas de résumé court : une source longue → une page longue. ») : **conserver**
  (déjà aligné avec le verbatim).

#### 4. `docs/ingestion.md`

- **Lignes 117-120** (étape 4, création de la page ressource) : reformuler « fidélité intégrale :
  on met en forme, on ne raccourcit pas » en « **verbatim** : on met en forme le texte exact, on
  ne reformule ni ne raccourcit ».
- **Lignes 199-201** : « Le **texte paraphrasé** peut varier d'un run à l'autre (le LLM n'est pas
  déterministe sur la prose). » → le corps est désormais **verbatim** (recopie de la source), il
  ne devrait plus varier d'un run à l'autre hormis la mise en forme markdown ; tout ce qui touche
  la structure reste **entièrement déterministe** (`web/lib/wiki-project.ts`).

#### 5. `web/lib/ingest-local.ts` — plafond de sortie

- Dans `callModel` (appel `getAnthropic().messages.create`, ~ligne 398) : `max_tokens: 16000` →
  **`32000`**. Le verbatim ne peut pas compresser : une source longue doit tenir en un seul
  appel. Raising ne coûte rien de plus sur les docs normaux (facturation au token **réellement
  émis**) ; il évite juste la troncature des longs.

#### 6. `web/app/sources/[id]/page.tsx` — cosmétique

- **Ligne 92** : commentaire « `// PDF : visualiseur à gauche, contenu paraphrasé + métadonnées à
  droite.` » → remplacer « contenu paraphrasé » par « contenu (verbatim) » (exactitude ; aucun
  impact fonctionnel).

### Risques & limites connues (à documenter, non bloquants)

- **`wiki-verify` — warnings `missed-link`/`missed-theme-link` possiblement plus nombreux** : le
  verbatim contient plus d'occurrences littérales de noms connus ; chaque mention non reliée
  déclenche un `warn` (`web/scripts/wiki-verify.ts:271-306`). **Non bloquant** dans le flux
  d'ingestion : `runWikiVerify` (`ingest-local.ts:135-151`) lance le script **sans `--strict`** ;
  sévérité `warn`. Seul `--strict` (manuel/CI) sortirait en code 1 (`wiki-verify.ts:524-526`) —
  or ce projet est local-first, sans CI. Le mandat de complétude tient toujours (l'IA doit
  annoter les entités connues qu'elle voit), donc ce n'est pas un flot de faux positifs.
  **À surveiller, pas à neutraliser d'avance.**
- **Sources très longues** : au-delà du plafond de sortie (32 000 tokens ≈ ~120 000 car.), la
  transcription serait tronquée. De plus le chat tronque la lecture d'une fiche à 30 000 car.
  (`web/lib/chat-agent.ts:12,85-91`). Limite connue, à revisiter si un très gros document
  apparaît.
- **Take-aways un peu plus bruts** : la puce d'une ligne des vues Thèmes/Entités devient la 1re
  phrase du texte verbatim (au lieu d'une phrase paraphrasée soignée). Acceptable.

### Vérification (preuve que ça marche)

1. **Tests unitaires** : `cd web && npm test` — doit rester vert. Les tests
   `lib/__tests__/wiki-project.test.ts` / `wiki-mutate.test.ts` tournent sur fixtures avec
   `##`+prose et restent valides ; on prouve qu'on n'a rien cassé du moteur.
2. **Bout en bout — une note (même langue + zéro invention)** : déposer un fichier de test neuf
   `raw/test-verbatim-en.txt` avec un texte **anglais** court et distinctif (2-3 phrases), lancer
   l'ingestion, puis ouvrir `wiki/resources/<slug>.md` et la page `/sources/<slug>` :
   - le corps reproduit le texte **mot pour mot** (diff = 0 sur les mots de contenu) ;
   - il reste **en anglais** (preuve du « pas de traduction ») ;
   - **aucune** phrase ajoutée (contraste direct avec l'ancien comportement sur `note-2.txt`) ;
   - blockquote de navigation + annotations présents ; rendu correct dans la page source.
3. **Bout en bout — un PDF (nettoyage sans reformulation)** : déposer un petit PDF de test,
   ingérer, vérifier que le corps ne contient **ni n° de page ni en-têtes répétés**, que les mots
   coupés sont recollés, et qu'**aucune phrase n'a été reformulée** (échantillonner quelques
   passages contre le PDF original).
4. **Coût** : lire `.data/ingest.log` — confirmer que la note verbatim émet **beaucoup moins** de
   tokens de sortie qu'avant (donc moins chère), preuve mesurée de la fin du remplissage.

> Note d'exécution : `raw/` est immuable et le manifeste `wiki/_ingested.json` marque « déjà
> ingéré » — utiliser des **fichiers de test neufs** pour la vérif (ne pas ré-ingérer une source
> existante). Ces fichiers de test seront supprimés après validation via la suppression
> déterministe de la plateforme (retire raw + fiche + entrée manifeste dans le même lot).

## Décisions

- **Verbatim plutôt que paraphrase.** Retenu : recopie mot pour mot. Écarté : garder la
  paraphrase. Raison : la paraphrase produit de la **fabrication** (note de 2 lignes gonflée en
  paragraphes inventés), ce qui est un problème de confiance, pas seulement de coût.
- **Fidélité « exact, nettoyé » plutôt que « littéral brut ».** Retenu : mots/chiffres/phrases/
  langue identiques, mais on retire les scories d'extraction (n° de page, en-têtes/pieds
  répétés) et on recolle les mots coupés en fin de ligne. Écarté : « littéral brut » (garder
  absolument tout, y compris n° de page, en-têtes et coupures de ligne). Raison : le littéral
  brut donne un rendu brouillon et illisible ; le nettoyage des scories n'altère aucun mot de
  contenu. **Conséquence pour l'implémentation :** la frontière du « nettoyage » doit être
  formulée sans ambiguïté dans le prompt (retirer scories + recoller mots coupés UNIQUEMENT ;
  jamais réordonner/corriger/reformuler du contenu).
- **Navigation fine par section plutôt que simple par ressource.** Retenu : conserver les
  annotations `topics:`/`entities:` par section (repères invisibles tissés dans le fichier,
  masqués à l'affichage). Écarté : corps 100 % pur avec liens seulement au niveau ressource.
  Raison : la navigation fine (page Thème/Entité → passage précis) est une valeur clé du wiki ;
  les annotations ne modifient pas le texte source (le lecteur voit du verbatim pur). Ce choix
  implique que **le moteur déterministe reste inchangé** et que **le prompt garde** l'exigence
  d'annotation par section.
- **Plafond de sortie 16000 → 32000.** Retenu : 32000. Écartés : laisser 16000 (tronquerait le
  verbatim des sources longues) ; monter au max modèle 64000 (non retenu — 32000 est un
  compromis sûr, et les très gros documents restent une limite connue de toute façon). Raison :
  le verbatim ne peut pas compresser ; monter le plafond ne coûte rien sur les docs normaux
  (facturation au token émis).
- **Ne pas affaiblir `wiki-verify` d'avance.** Retenu : laisser les contrôles
  `missed-link`/`missed-theme-link` tels quels. Écarté : les exempter/rétrograder préventivement.
  Raison : non bloquants dans le flux (verify lancé sans `--strict`), et le mandat de complétude
  reste pertinent. À revisiter seulement si le bruit devient réel.

## Hors périmètre

- **Extraction PowerPoint (.pptx) et Word (.docx).** `extractSourceText`
  (`web/lib/ingest-local.ts:322-333`) ne gère que `.md` / `.txt` / `.pdf` et **lève une erreur**
  pour toute autre extension, alors que le formulaire d'upload (`web/components/upload/UploadForm.tsx`,
  `ACCEPT_UPLOAD = '.pdf,.pptx,.docx,.txt,.md'`) les accepte. Le mode verbatim **ne change rien**
  tant que l'extraction pptx/docx n'est pas ajoutée — **chantier séparé** (voir amorce ci-dessous).
- **Troncature du chat à 30 000 caractères** (`web/lib/chat-agent.ts`) : non traitée ici.
- **Suppression/affaiblissement des contrôles `wiki-verify`** : non fait (cf. Décisions).
- **Modification du moteur déterministe** (`wiki-project.ts` / `wiki-mutate.ts`) : aucun
  changement — il est déjà compatible verbatim.

### Amorce de contexte pour une session future (extraction .pptx / .docx)

> Paragraphe prêt à coller au démarrage d'une **autre session Claude Code** dédiée à ce chantier.

Le wiki « AI Coding Second Brain » ingère des sources déposées dans `raw/` : un moteur local
(`web/lib/ingest-local.ts`) extrait le texte, puis un unique appel IA le met en markdown
**verbatim** (recopie mot pour mot, sans reformuler — cf.
`tasks/specs/2026-07-23-ingestion-verbatim.md`). Problème à résoudre dans cette session : le
formulaire d'upload accepte déjà `.pptx` et `.docx` (`ACCEPT_UPLOAD` dans
`web/components/upload/UploadForm.tsx`), **mais** la fonction d'extraction
`extractSourceText` (`web/lib/ingest-local.ts:322-333`) ne sait lire que `.md`, `.txt` et
`.pdf` (via `unpdf`, en local) et **lève une erreur** sur tout autre format — donc déposer un
PowerPoint ou un Word échoue silencieusement à l'ingestion. Objectif : **ajouter l'extraction
de texte locale et déterministe pour PowerPoint (.pptx) et Word (.docx)**, dans le même esprit
que le PDF (extraction hors-ligne, gratuite, aucun texte envoyé ailleurs que dans l'unique appel
IA existant), pour que ces formats produisent un texte brut que la couche verbatim mettra
ensuite en markdown sans le réécrire. Contraintes du projet : `raw/` est immuable ; la seule
voie d'écriture est `applyFileOps` (chemins sous `wiki/` ou `raw/` uniquement) ; rester
local-first (pas de service externe). Cadrer d'abord le choix des bibliothèques d'extraction
(.pptx / .docx) et leur fidélité, puis suivre le workflow spec → implémentation habituel.

## Todo

- [x] **Réécrire `prompts/ingest-prompt.md` en mode verbatim.** Remplacer ligne 52 (« intégral
  paraphrasé » → « intégral, recopié mot pour mot (verbatim), dans la langue d'origine »),
  reformuler lignes 56-57 (mise en markdown du texte exact + nettoyage scories + recollage mots
  coupés + interdits explicites), réécrire lignes 95-98 (`## Fidélité`) en règle verbatim
  absolue, ajouter la phrase cadre dans l'intro, préciser que blockquote nav + annotations sont
  les seuls ajouts autorisés. **Vérif :** relire le fichier ; plus aucune occurrence de
  « paraphras* » comme consigne active ; la ligne rouge « nettoyage ≠ reformulation » est
  présente et non ambiguë.
- [x] **Mettre à jour la doctrine dans `CLAUDE.md` (règle 6), `docs/wiki-spec.md` (lignes 20,
  100-101), `docs/ingestion.md` (lignes 117-120, 199-201).** **Vérif :** `grep -rn "paraphras"
  CLAUDE.md docs/` ne renvoie plus de règle imposant la paraphrase (les mentions restantes sont
  neutralisées/historiques) ; la doctrine verbatim est énoncée dans les 4 emplacements.
- [x] **Monter `max_tokens` de 16000 à 32000 dans `web/lib/ingest-local.ts`** (fonction
  `callModel`). **Vérif :** `grep -n "max_tokens" web/lib/ingest-local.ts` affiche `32000`.
- [x] **Corriger le commentaire cosmétique `web/app/sources/[id]/page.tsx:92`** (« contenu
  paraphrasé » → « contenu (verbatim) »). **Vérif :** le commentaire ne contient plus
  « paraphrasé ».
- [x] **Lancer les tests unitaires** : `cd web && npm test`. **Vérif :** tous verts (aucune
  régression du moteur déterministe). — Moteur déterministe (`wiki-project`/`wiki-mutate`) +
  `ingest-local` : **49/49 verts**. Suite complète : 125/126 ; l'unique échec
  (`list_wiki_folder(resources) renvoie les 13 fiches`) est un **compte codé en dur** cassé par
  16 fiches réelles (dont 3 ingérées par une autre session, non commitées) — externe à ce
  chantier, motif déjà consigné dans `tasks/lessons.md` (2026-07-20/21). Non imputable à mes
  changements (prompt/docs/`max_tokens`/commentaire ne créent aucune ressource).
- [x] **E2E note anglaise** : créer `raw/test-verbatim-en.txt` (2-3 phrases anglaises
  distinctives, ex. sur un sujet neutre), déclencher l'ingestion, ouvrir `wiki/resources/<slug>.md`.
  **Vérif :** corps = texte source mot pour mot ; toujours en anglais ; zéro phrase ajoutée ;
  blockquote nav + annotations `topics:`/`entities:` présents ; page `/sources/<slug>` rend le
  corps correctement. — **PROUVÉ** (harnais isolé, vrai appel IA) : note anglaise sur la tortue
  d'Aldabra → corps `===` source (comparaison stricte `true`), resté en anglais, 0 phrase ajoutée,
  blockquote nav présent. `out=249` tokens (~$0,0136). Corps sans `##` car note d'un seul
  paragraphe (pas de section inventée) → pas d'annotation de chunk, cohérent avec le verbatim.
- [x] **E2E PDF** : déposer un petit PDF de test, ingérer. **Vérif :** corps sans n° de page ni
  en-têtes/pieds répétés ; mots coupés en fin de ligne recollés ; aucun passage reformulé
  (échantillonner ≥3 passages contre le PDF original). — **PROUVÉ** : PDF 2 pages généré (Chrome
  headless) avec en-tête répété, « Page 1/2 »/« Page 2/2 » et un mot coupé « organi- zation »
  (vérifiés dans la sortie `unpdf`). Après ingestion : n° de page **retirés**, en-tête
  **dédupliqué** (1 occurrence), « organi- zation » **recollé** en « organization », les 5 phrases
  de corps reproduites **mot pour mot** (5/5). Nuance mineure honnête : l'en-tête promu en titre a
  été mis en casse de titre (« Strictly Confidential » au lieu de « STRICTLY CONFIDENTIAL ») —
  cosmétique, sur un élément d'en-tête, pas sur le corps.
- [x] **Contrôle coût** : lire `.data/ingest.log`. **Vérif :** la note verbatim émet nettement
  moins de tokens `out=` qu'une paraphrase équivalente (preuve chiffrée de la fin du remplissage).
  — **PROUVÉ (fidélité) ; nuancé (budget)** : ré-ingestion du contenu **exact** de `note-2.txt`
  (8 mots) en verbatim → corps = **8 mots**, coquille source « COntexte » **préservée**. L'ancienne
  sortie paraphrase (`finops-c-est-le-financement-des-tokens.md`) sur la même source = **78 mots
  inventés** (×10, « COntexte » corrigé en français propre). La **fin du remplissage est mesurée**
  (8 vs 78 mots de corps). NB honnête : sur une note minuscule l'`out=` total ne chute que
  modérément (280 vs ~390 estimé) car le frontmatter/nav est un overhead fixe qui domine — cohérent
  avec le cadrage de la spec (« le gain principal est la fidélité, pas le budget »). Le gain budget
  croît avec le volume de remplissage supprimé.
- [x] **Nettoyer les fichiers de test** via la suppression déterministe de la plateforme (retire
  `raw/<fichier>` + sidecar + fiche `wiki/resources/<slug>.md` + entrée manifeste dans le même
  lot). **Vérif :** `raw/test-*` et leurs fiches n'existent plus ; `wiki/_ingested.json` ne les
  référence plus ; `npm run wiki:verify` sans nouvelle erreur. — **FAIT autrement (voir Bilan)** :
  les E2E ayant tourné dans un `DATA_ROOT` **isolé** (jamais le vrai wiki), aucune suppression
  plateforme n'était nécessaire. Nettoyage effectif : dossier scratch supprimé + 2 fichiers de
  harnais retirés de `web/` (`verbatim-harness.ts`, `extract-probe.ts`). Vérifié : `raw/test-*`
  et fiches de test **absents du vrai repo**, manifeste ne les référence pas, `npm run wiki:verify`
  **vert**, `git status` = uniquement les 6 fichiers voulus.

## Bilan

### Ce qui a été fait (conforme au plan)

- **Prompt (`prompts/ingest-prompt.md`)** réécrit en verbatim : phrase cadre « RÈGLE ABSOLUE —
  VERBATIM » dans l'intro, point 2 du corps (« intégral, recopié mot pour mot, dans la langue
  d'origine »), point 3 (mise en forme du texte exact + nettoyage scories + recollage mots coupés
  + interdits explicites), section « Fidélité — verbatim absolu », ligne rouge « nettoyage ≠
  reformulation », mention des seuls ajouts structurels autorisés. Zéro consigne `paraphras*`
  active restante.
- **Doctrine** alignée dans `CLAUDE.md` (règle cardinale 6), `docs/wiki-spec.md` (arbre L20 +
  §2.4 Contenu) et `docs/ingestion.md` (étape 4 + note « varie d'un run à l'autre »). `grep -rn
  "paraphras" CLAUDE.md docs/` = 0.
- **`max_tokens` 16000 → 32000** dans `web/lib/ingest-local.ts` (`callModel`).
- **Commentaire cosmétique** `web/app/sources/[id]/page.tsx:92` corrigé (« paraphrasé » →
  « (verbatim) »).
- **Preuves E2E** (note anglaise, PDF, coût) réalisées avec un **vrai appel IA** et le **vrai
  prompt mis à jour**, résultats détaillés dans la todo ci-dessus.

### Ce qui a dévié du plan, et pourquoi

1. **E2E lancés dans un `DATA_ROOT` isolé (scratch), pas sur le vrai wiki.** La spec prévoyait de
   déposer les fichiers de test dans le **vrai** `raw/`, d'ingérer sur le **vrai** wiki, puis de
   nettoyer via la suppression déterministe de la plateforme. **Obstacle non prévu :** une **autre
   session Claude tournait** en parallèle (son serveur Next vivant sur le port 3000, `CLAUDE_EFFORT`
   dans l'env) et le working tree portait déjà des mutations concurrentes (3 fiches ressources
   ajoutées, 16 sources au manifeste). Muter le wiki partagé dans ces conditions est précisément le
   piège documenté dans `tasks/lessons.md` (2026-07-21 « dépôt partagé » et 2026-07-22 « instance
   isolée + état simulé »). **Décision (relève du COMMENT) :** monter un harnais isolé
   (`DATA_ROOT`/`WIKI_ROOT`/`RAW_ROOT` → scratch, copie du wiki réel + de la clé
   `ai-settings.json`), y déposer un seul fichier test et appeler `runIngestion()`. Le prompt étant
   lu depuis `REFERENCE_ROOT` (= repo réel), le **vrai** prompt verbatim est exercé ; le vrai appel
   IA prouve le comportement réel ; **zéro risque** pour le wiki partagé et **aucune collision**.
   Conséquence : le nettoyage « plateforme » (todo 9) devient sans objet (le vrai wiki n'a jamais
   été touché) — nettoyage réel = suppression du scratch + des 2 fichiers de harnais.
2. **PDF de test généré via Chrome headless** (aucune lib de création PDF dans le projet ;
   `unpdf` ne fait que l'extraction). Le PDF 2 pages contient les scories voulues, confirmées dans
   la sortie `unpdf` avant ingestion.

### Réserves honnêtes

- **Test unitaire `list_wiki_folder(resources)` rouge** : compte codé en dur (13) cassé par l'état
  réel du wiki (16 fiches, dont 3 d'une autre session). **Externe à ce chantier**, non corrigé
  ici (ce n'est pas mon périmètre et le fichier appartient à l'état d'une autre session). Le moteur
  déterministe reste 49/49 vert.
- **Casse d'en-tête** : sur le PDF, l'en-tête répété promu en titre a été mis en casse de titre
  (cosmétique, élément d'en-tête, pas de corps). À surveiller si un cas réel montrait une
  reformulation de **contenu** — non observé ici.
- **Gain budget modéré sur petites notes** (overhead frontmatter fixe) : le bénéfice mesuré est la
  **fidélité** (fin de la fabrication), conforme au cadrage de la spec.
