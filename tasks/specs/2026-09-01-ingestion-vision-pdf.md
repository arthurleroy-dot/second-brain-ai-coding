# Ingestion vision des PDF (schémas, tableaux, timelines) + affichage image dans le chat + rattrapage page par page

## Contexte

**Problème.** L'ingestion actuelle ne capte que la **couche texte** des documents
(`unpdf` pour les PDF, balises `<a:t>` pour les PPTX). Aucune vision. Conséquence :
schémas, diagrammes, courbes, tableaux-images, timelines/Gantt sont **perdus** ; et
un PDF **scanné** ou une page **100 % image** (couche texte vide) fait **planter**
l'ingestion via le garde-fou « Aucun texte extractible » (`web/lib/ingest-local.ts:365`).

**Demande d'origine.** Corriger ce trou pour les **PDF** en ajoutant une lecture
visuelle **bon marché** (modèle vision **Haiku**), sans trahir la règle cardinale
« verbatim » (#6 de `CLAUDE.md`). Trois exigences produit sont ressorties de la
conception :
1. Capter les visuels d'un PDF **page par page** (aiguillage automatique, sans
   cocher de case globale ; le coût/temps doit rester minimal).
2. Quand on interroge le **chat**, l'**image** concernée doit pouvoir **apparaître
   dans la réponse** (ex. « montre-moi l'organigramme de Carrefour » → l'image
   réapparaît).
3. Pouvoir **rattraper page par page** (pas tout le PDF) quand une transcription
   est mauvaise ou qu'une page visuelle a été ratée par l'aiguillage, depuis la
   vue de comparaison **PDF (gauche) / transcription (droite)** qui existe déjà.

**Périmètre : PDF uniquement (v1).** Le PPTX est explicitement reporté (voir
§ Hors périmètre).

---

## Plan

### 0. Principe : deux étapes, deux modèles

Le poste coûteux est l'envoi d'**images** (tokens image). On le confie au modèle le
**moins cher** (Haiku), et le reste du raisonnement (mise en forme, annotations,
détection d'entités/thèmes) reste **texte seul** sur le modèle d'ingestion habituel.

- **Étape A — passe vision (Haiku, images).** Pour chaque page d'un PDF : extraction
  de la couche texte (locale, gratuite) → **aiguillage par page** (3 signaux
  gratuits) → sur les pages jugées « visuelles », **rendu PNG** de la page +
  **appel Haiku** qui renvoie un fragment markdown (OCR verbatim du texte non
  extrait, et/ou **bloc figure** décrivant les visuels). Assemblage d'un document
  texte page-ordonné (texte extrait + fragments Haiku).
- **Étape B — ingestion habituelle (inchangée), texte seul.** Le document assemblé
  passe dans l'appel d'ingestion existant (`callModel`), qui produit la page
  ressource canonique et détecte entités/thèmes exactement comme aujourd'hui. La
  vision n'agit **que** sur la string `raw` en amont ; tout le pipeline aval reste
  identique.

### Références code auditées (ancrages exacts — ne pas re-auditer)

**Pipeline `web/lib/ingest-local.ts` :**
- `runIngestion` (~L1122) → boucle par fichier (~L1173) : `extractSourceText` (L1178)
  → sidecar/déclarations (L1180-1182) → `buildUserMessage` (L1183) → `callModel`
  (L1186) → coût (L1187-1194) → `forceType`/`forceOrigin`/`forceDate` (L1199-1201,
  **hors** `ingestOne`) → `ingestOne` (L1202) → `applyFileOps` (L1212) ; final
  `rebuildDerivedIndexes` (L1227).
- `extractSourceText` (L338-370). PDF (L346-349) :
  `const pdf = await getDocumentProxy(new Uint8Array(buf)); ({ text } = await extractText(pdf, { mergePages: true }));`
  → **une seule string**. La surcharge `extractText(pdf, { mergePages: false })`
  renvoie `{ text: string[], totalPages }` (une entrée **par page**) — typings
  `web/node_modules/unpdf/dist/index.d.ts` L127-138. Le `PDFDocumentProxy` (`pdf`)
  est déjà en main.
- Garde-fou « texte vide » : `throw` L365-367 (« Aucun texte extractible… »). Second
  garde `if (!raw.trim()) throw` dans la boucle L1179 (« Extraction vide pour… »).
- `callModel` (L490-513) : `messages: [{ role:'user', content: user }]` où **`user`
  est une string** (retour de `buildUserMessage` L1092-1117, un `parts.join('\n\n')`) ;
  `system: [{ type:'text', text:system, cache_control:{type:'ephemeral'} }]` (L499) ;
  `stream: true` (L502) ; `model: getModel()` (L497). **Aucune image envoyée
  aujourd'hui.**
- `parseGeneration` (L457-472) : extrait `<resource>…</resource>` → `markdown` ;
  `<detected-new>{entities,themes}</detected-new>` → JSON toléré.
- `estimateCost` (L449-455) + `RATE = { input:3, output:15, cacheWrite:3.75, cacheRead:0.3 }`
  (L447, **barème Sonnet codé en dur**). Coût : `x-litellm-response-cost` (L510-511)
  → `gatewayCost` (null si absent) ; `cost = gen.gatewayCost ?? estimateCost(gen.usage)`
  (L1187) ; `perFile.push({ file, costUsd })` (L1189). Phase temps réel :
  `phase('extract', lbl('Extraction du texte'), file)` (L1177).
- `ingestOne` (L977) est **isolé** (part du markdown déjà généré) ; appelé par
  `runIngestion` + tests **seulement**. Les scripts de backfill n'appellent ni
  `ingestOne` ni `extractSourceText` ni `callModel`. → **La passe vision s'insère
  entièrement dans la boucle `runIngestion`, entre L1178 et L1183, sans toucher
  `ingestOne` ni le backfill.**

**Client IA `web/lib/claude.ts` :**
- `getAnthropic()` (L15-28) : client **agnostique au modèle** (mémorisé par clé+URL).
  On peut appeler `getAnthropic().messages.create({ model: <VISION_MODEL>, … })` en
  court-circuitant `getModel()`. SDK `@anthropic-ai/sdk@0.112.3` (`web/package.json`
  L18) : supporte les blocs image `{ type:'image', source:{ type:'base64',
  media_type:'image/png', data:<base64 sans retours-ligne> } }` placés **avant** le
  bloc texte. `getModel()` (L30) = `getAiSettings().model` ; défaut app =
  `claude-sonnet-4-5` (`web/lib/ai-settings.ts` L24). Auth/gateway : `docs/platform.md` §6.

**Rendu PDF→PNG :**
- `unpdf@1.6.2` (`web/package.json` L29) exporte
  `renderPageAsImage(data | PDFDocumentProxy, pageNumber, { scale?, width?, height?, toDataURL?, canvasImport? }): Promise<ArrayBuffer>`
  (PNG ; `Promise<string>` data-URL si `toDataURL:true`) — typings
  `web/node_modules/unpdf/dist/index.d.mts` ~L200-217. pdfjs est embarqué dans unpdf.
- **Dépendance manquante à AJOUTER : `@napi-rs/canvas`** (peer optionnelle d'unpdf,
  **non installée**). Sans elle, `renderPageAsImage` jette « @napi-rs/canvas module
  is not registered/resolved ». Version `^0.1.69`+ (unpdf teste `^0.1.97`). N-API
  pré-compilé (pas de `node-gyp`, pas de lib système, ABI-stable → Electron sans
  `electron-rebuild`).

**Format de ressource + moteur déterministe :**
- Frontmatter (ordre, `docs/wiki-spec.md` §2.1 L57-69) : `slug, title, author, date,
  source_type, origin, topics: [slug…], entities: [slug…]?, url, source_file`.
  Convention : `topics:` du frontmatter = **union des topics de toutes les sections**
  (pilote `themes/` et les arêtes `belongs_to_theme`).
- Blockquote de nav sous le frontmatter : `> Par [[../authors/<slug>|Auteur]] · … · Thèmes : [[../themes/<slug>|Label]] · …`
  (motif `^>\s*Par\s+`).
- **Section = heading `##` ou `###`** (motif `^#{2,3}\s+(.+)$`). Annotations
  immédiatement sous le heading, chacune = un inline-code backtické qui, `trim()`é,
  vaut **exactement** :
  ```
  `topics: [finops-ia, agentic-coding]`
  `entities: [claude-code, n8n]`
  ```
  Regex consommateurs (tous concordants) : `web/lib/wiki-parser.ts:66,78` ;
  `web/lib/wiki-mutate.ts:356` ; `web/lib/wiki-project.ts:158,163` ;
  `web/scripts/wiki-verify.ts:113,123`. Valeurs = **slugs** (split `,`, `trim`, vides
  filtrés).
- `collectSections` (`web/lib/wiki-project.ts:125-173`) :
  `Section { title, anchor, topics[], entities[], takeaway }`. `anchor =
  headingSlug(titre)` (`web/lib/wiki-mutate.ts:59`). `takeaway = firstSentence(prose)`
  = **1ʳᵉ phrase** (jusqu'au 1ᵉʳ `.!?`, ≤300 car) des lignes qui ne sont ni heading,
  ni annotation, ni blockquote de nav (L169). Annotation rattachée à une section
  **seulement si elle suit un heading** (`if (!cur) continue`, L156).
- `parseResource` (`web/lib/wiki-parser.ts:92-114`) / `parseResourceMeta`
  (`web/lib/wiki-mutate.ts:367-381`) : `topics = union(frontmatter, chunks)` ;
  `entities = union(frontmatter, chunks)` (`extractChunkTopics` L106, `extractChunkEntities`
  L96).
- `projectResource` (`web/lib/wiki-project.ts:348-527`) dérive : `themes/<t>.md`
  (frontmatter topics, bullets = sections filtrées, avec ancre + takeaway) ;
  `entities/<e>.md` (union `meta.entities`, bullets sections + ancre) ; `graph.json`
  `belongs_to_theme` (frontmatter) et `mentions` (union, `sections:[ancres]`) ;
  `index.md`/`by-date/` via `ResourceCard` (`web/lib/wiki-index.ts`,
  `rebuildDerivedIndexes` `web/lib/ingest-local.ts:1042`).
- **VERDICT MOTEUR : un bloc figure = une section `##` normale portant `topics:`/
  `entities:` + un corps (tableau markdown / description) traverse parser + projecteur
  SANS aucune modification.** Il devient bullet dans `themes/` (topics remontés au
  frontmatter) et `entities/` (avec son ancre), arête `mentions` avec l'ancre, entrée
  `index`/`by-date`. Tableau markdown déjà autorisé (`prompts/ingest-prompt.md` L72).
- `wiki:verify` (`web/scripts/wiki-verify.ts`) : `unknown-entity`/`unknown-theme`
  ERROR (L282-284/303-305) si un slug est absent du registre ; `graph-missing-*`
  ERROR (L375-447, cohérent par construction) ; `missed-link`/`missed-theme-link`
  WARN. Ne vérifie **pas** le contenu des sections. → Un bloc figure bien annoté
  (slugs connus) passe verify.

**Chat + UI :**
- Chat = agent LLM navigant le markdown (`web/lib/chat-agent.ts`), **pas** de
  recherche vectorielle. Deux outils : `read_wiki_page(path)` (contenu **intégral**,
  tronqué `MAX_PAGE_CHARS=30000` ; **refuse tout non-`.md`** : `if (!p.endsWith('.md'))`
  L72) et `list_wiki_folder(path)`. **`/raw` inaccessible à l'agent** (L9). Prompt
  système L362-430.
- Rendu : réponses chat via `web/components/chat/Message.tsx`
  (`<ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>`
  L79-85,143-146). Corps ressource + pages thèmes via
  `web/components/sources/FullContentProse.tsx` (même stack), utilisé par
  `web/app/sources/[id]/page.tsx:132` et `web/app/wiki/[slug]/page.tsx:48`.
  **`![alt](src)` → vraie `<img>`** (défaut react-markdown, aucune surcharge `img`,
  `<img>` natif → aucune config `next/image`). **`<img>` HTML brut → SUPPRIMÉ** (pas
  de `rehype-raw`). `web/lib/wiki-md.ts` (`stripChunkAnnotations`/
  `resourceBodyForDisplay`) retire annotations + nav, **ne touche pas** aux images
  markdown.
- `web/app/api/raw/[...file]/route.ts` : GET, `force-dynamic`, `path.basename`
  anti-traversal (L31), lit `RAW_ROOT` (`web/lib/wiki-fs.ts:10` =
  `process.env.RAW_ROOT ?? DATA_ROOT/raw`), Content-Type par extension. Fiche
  ressource embarque déjà le PDF via `<iframe src="/api/raw/<file>">`
  (`web/app/sources/[id]/page.tsx:109-111`).
- **Fiche ressource, layout PDF** (`web/app/sources/[id]/page.tsx:97-124`) : `flex`,
  **gauche `w-[60%]`** = `<iframe>` PDF, **droite `w-[40%]`** = `Meta` + titre +
  `<FullContentProse content={display} />`. C'est LA vue de comparaison du rattrapage.
- Upload : `web/components/upload/UploadForm.tsx` → `web/app/api/upload/route.ts`,
  `buildSidecar()` (L104-149) écrit `raw/<source>.meta.md` (une ligne par champ non
  vide), puis `void runIngestion()` en arrière-plan (L228).
- Progression : `web/lib/ingest-events.ts` (`phase`) → `web/app/api/ingest-stream/route.ts`
  (NDJSON `{type:'step', id, phase, label, file?}` · `delta` · `done` · `error`) →
  `web/lib/ingest-view-store.ts` → `web/components/upload/IngestStatus.tsx`.

### A. Étape A — extraction par page + aiguillage + vision Haiku

**A.1 Extraction par page.** Dans `extractSourceText` (PDF), passer à
`extractText(pdf, { mergePages: false })` pour obtenir `text: string[]` (indexé
page-1) et `totalPages`. Conserver le `PDFDocumentProxy` (`pdf`) pour le rendu et
l'aiguillage. `extractSourceText` doit exposer, pour un PDF, non plus une seule
string mais **par page** (nouvelle fonction interne, ex. `extractPdfPerPage(file):
Promise<{ pages: string[]; pdf: PDFDocumentProxy }>`) ; l'ancien comportement
(string unique) reste pour `.docx`/`.pptx`/`.md`/`.txt`.

**A.2 Aiguillage par page (3 signaux gratuits, aucun appel IA).** Nouvelle fonction
`classifyPageForVision(pdf, pageText, pageNumber): boolean`. Utilise l'API pdf.js du
`PDFDocumentProxy` (`await pdf.getPage(n)`, `page.getTextContent()`,
`page.getOperatorList()`, `page.getViewport({scale:1})`). Route vers la vision si
**au moins un** signal est vrai :
1. **Couche texte quasi-vide** : `pageText.trim().length < TEXT_MIN` (valeur de départ
   **20** caractères — à calibrer).
2. **Grosse image matricielle** : présence d'au moins une opération image
   (`OPS.paintImageXObject`/`paintJpegXObject`/`paintInlineImageXObject`) dont la
   surface dessinée (déduite du transform courant) couvre **> IMG_AREA_FRAC** de la
   surface de la page (valeur de départ **0.4**).
3. **Motif « schéma/diagramme »** : beaucoup de fragments texte **courts** (nombre
   d'items `getTextContent` élevé, longueur moyenne faible → étiquettes éparses) **ET**
   beaucoup d'opérations de tracé vectoriel (`OPS.stroke`/`fill`/`constructPath`… au-
   dessus de **PATH_MIN**, départ **40**), avec densité de prose faible.

Les seuils `TEXT_MIN`, `IMG_AREA_FRAC`, `PATH_MIN` sont des **constantes à calibrer**
sur les PDF de test (§ Todo). Signaux 1 et 2 fiables ; signal 3 heuristique (peut
manquer un schéma « né numérique » → rattrapé par le rattrapage manuel, §D).

**A.3 Rendu PNG.** Fonction partagée `web/lib/pdf-render.ts` →
`renderPdfPageToPng(pdfOrBytes, pageNumber, scale=2): Promise<Buffer>` via
`renderPageAsImage`. Réutilisée par la route d'image (§C) et la passe vision. Viser
un bord long ≲ 1568 px (au-delà, Anthropic redimensionne ; ~1600 tokens/image). Cette
fonction **charge `@napi-rs/canvas`** (dépendance ajoutée).

**A.4 Appel Haiku (helper vision dédié, NON-streaming).** Nouveau module
`web/lib/vision-ingest.ts`. Fonction `visionTranscribePage({ pngBase64, pageText,
pageNumber, sourceFile }): Promise<string>` (retourne un **fragment markdown**).
- Appel : `getAnthropic().messages.create({ model: <VISION_MODEL>, max_tokens: ~2000,
  messages: [{ role:'user', content: [ { type:'image', source:{ type:'base64',
  media_type:'image/png', data: pngBase64 } }, { type:'text', text: <consigne> } ] }] })`
  **sans `stream`** (pour un en-tête coût fiable) et **sans** le `system` caché de
  `callModel` (ne PAS réutiliser `callModel`).
- `<VISION_MODEL>` = nouveau réglage `visionModel` dans `web/lib/ai-settings.ts`,
  **défaut `claude-haiku-4-5`**. Permet de basculer sur Sonnet (escalade) ou si la
  gateway ne route pas Haiku.
- **Prompt Haiku** (nouveau `prompts/vision-figure-prompt.md`), règles strictes :
  - On fournit à Haiku le **texte déjà extrait de la page** (`pageText`). Consigne :
    « Transcris tout texte VISIBLE sur l'image qui n'est PAS déjà présent dans le
    texte fourni (ex. page scannée) — verbatim, mot pour mot. Pour les paragraphes
    de prose déjà fournis, NE les re-transcris PAS. »
  - Pour chaque élément **visuel non-textuel** (schéma, tableau-image, courbe,
    timeline/Gantt), produire **un bloc figure** au format §B, en respectant les
    paliers :
    - **Palier littéral (verbatim)** : recopier toutes les étiquettes/cellules/axes
      mot pour mot.
    - **Palier structurel (borné, factuel)** : décrire la structure objectivement
      présente (« A → B → C », colonnes d'un tableau, ordre temporel d'une timeline).
    - **INTERDIT (palier sens)** : toute interprétation de signification (« ceci
      montre que… », « architecture scalable… »).
  - Choisir le **`type`** de chaque figure : `table` | `timeline` | `chart` |
    `diagram`, qui pilote la représentation (tableau markdown | liste de phases |
    axes+forme | relations).
  - Si la page ne contient **aucun** visuel exploitable et aucun texte à OCRiser →
    renvoyer une chaîne vide.
- **Robustesse** : un échec de l'appel vision (erreur réseau, modèle non routé par la
  gateway, timeout) **ne doit jamais** faire échouer l'ingestion du document. On
  logue un warning, la page reste en texte seul, on continue. (Mitige le risque
  gateway/Haiku.)

**A.5 Assemblage.** Pour chaque page dans l'ordre : `pageText[p]` (peut être vide),
puis, si `p` routée vision, `"\n\n" + fragmentHaiku[p]`. Concaténer toutes les pages
→ nouvelle string `raw` remise à `buildUserMessage` (L1183). Si, **après** la passe
vision, `raw.trim()` est toujours vide → conserver l'erreur « Aucun texte
extractible » (le document est irrécupérable, on le signale au lieu d'une page vide).

**A.6 Intégration boucle.** Dans `runIngestion` (entre L1178 et L1183) : si le
fichier est un `.pdf`, remplacer l'appel simple par extraction par page → aiguillage
→ vision (pages routées) → assemblage. Émettre une phase `phase('vision', lbl('Lecture
des visuels'), file)` (sur le modèle de `phase('extract', …)` L1177) pour le fil
temps réel. Le garde-fou L365 et L1179 devient un **aiguillage** (router au lieu de
`throw`) — ne plus jeter tant que la vision n'a pas été tentée.

### B. Format du bloc figure (contrat)

Un bloc figure = **une section `##`**. Haiku l'émet **sans** les annotations
`topics:`/`entities:` (c'est l'Étape B qui les ajoute, elle a le registre). Gabarit :

```markdown
## {Titre court de la figure}

{Phrase de légende décrivant la figure, terminée par un point.} *(Figure — description machine, page {N} de la source, non-verbatim.)*

![{Titre court}](/api/raw-image/{fichier}?page={N})

**Texte littéral :** « {label1} » · « {label2} » · …

{Représentation selon `type` :
- table    → un vrai tableau markdown (cellules verbatim)
- timeline → liste ordonnée « {phase} : {début} → {fin} » (ou petit tableau)
- diagram  → **Structure :** {relations, ex. « Client → MCP Server → Azure OpenAI ; MCP Server → Key Vault »}
- chart    → **Axes/séries :** {axes + valeurs lisibles} + **Forme :** {description bornée}}
```

Contraintes vérifiées contre le moteur :
- La **1ʳᵉ ligne de prose** (juste après le heading) DOIT être la **phrase de légende
  terminée par un point** → garantit un `takeaway` propre (`firstSentence` s'arrête
  au point). Le marqueur `*(Figure — … non-verbatim.)*` suit sur la même ligne.
- La ligne `![…](/api/raw-image/{fichier}?page={N})` est l'**ancre de page** utilisée
  par le rattrapage (§D) : un bloc figure est identifié par la section `##` dont le
  corps contient `/api/raw-image/{fichier}?page={N}`. `{fichier}` = nom exact du
  fichier de `raw/` (== `source_file`).
- Le marqueur « description machine, non-verbatim » satisfait l'amendement de la
  règle #6 (§F) : la figure est **explicitement** signalée comme non-verbatim.

### C. Route de rendu d'image à la demande

Nouveau `web/app/api/raw-image/[...file]/route.ts`, calqué sur
`web/app/api/raw/[...file]/route.ts` :
- `GET`, `export const dynamic = 'force-dynamic'`.
- `name = path.basename(...)` (anti-traversal), lit `RAW_ROOT`.
- Query `?page=N` (défaut 1), option `?scale=` (défaut 2).
- `getDocumentProxy(new Uint8Array(bytes))` → `renderPdfPageToPng(pdf, page, scale)`
  → renvoie les octets en `Content-Type: image/png`, `Cache-Control: private, max-age=3600`.
- Rendu **à la demande**, rien de stocké (`raw/` reste l'unique vérité). Le corps du
  bloc figure pointe `![](/api/raw-image/{fichier}?page={N})` → le **navigateur** va
  chercher l'image (indépendamment de l'agent chat, qui n'accède pas à `/raw`).

### D. Rattrapage page par page (vue fiche ressource)

**Backend.** Nouveau `web/app/api/resource/[slug]/revise-figures/route.ts` :
- `POST { pages: number[] }`.
- Charge `wiki/resources/<slug>.md` → `source_file` (frontmatter) → `raw/<source_file>`.
- Pour chaque page demandée : `renderPdfPageToPng` + `visionTranscribePage` → nouveau
  fragment/bloc figure.
- **Greffe chirurgicale** dans le `.md` (nouveau helper, dans `web/lib/wiki-mutate.ts`
  ou `web/lib/figure-block.ts`) : pour la page `N`, **remplacer** la section `##`
  existante dont le corps contient `/api/raw-image/<source_file>?page=N` ; si absente,
  **insérer** à la position page-ordonnée. Ne toucher à rien d'autre.
- Re-projeter : `projectResource` sur le `.md` mis à jour + `applyFileOps` (scope
  `wiki/`), puis `rebuildDerivedIndexes` si nécessaire. Tracer le coût (Haiku, N pages
  seulement).
- **Seules les pages demandées** sont rendues + envoyées à Haiku → ciblé, rapide, à
  quelques centimes.

**Frontend.** Dans `web/app/sources/[id]/page.tsx`, panneau droit (`w-[40%]`) : un
petit composant client (nouveau, ex. `web/components/sources/ReviseFigures.tsx`) avec
un champ de **numéros de page** (ex. « 7, 12, 30 ») + bouton « Re-traiter ces pages
en vision » → `POST` vers l'endpoint → état de chargement → rafraîchit la transcription.
L'utilisateur repère les numéros en scrollant le PDF à gauche (l'`<iframe>` affiche les
numéros de page) et compare gauche/droite pour décider quoi re-traiter.

### E. Affichage de la figure dans la réponse du chat

Quatre conditions (trois déjà acquises, une à ajouter) :
1. **Trouvable** : la légende + `topics:`/`entities:` de la figure remontent au
   frontmatter/vues → l'agent localise la ressource. (Acquis, §A/B.)
2. **Image embarquée** : le bloc figure contient `![…](/api/raw-image/{fichier}?page=N)`
   dans le `.md` canonique. `read_wiki_page` renvoie le contenu **intégral** → l'agent
   voit ce lien. (Format §B.)
3. **Rendu** : `Message.tsx` rend déjà `![](url)` en `<img>`. (Acquis.)
4. **À AJOUTER** : consigne dans le prompt système du chat (`web/lib/chat-agent.ts`
   L362-430) : « Quand une figure/image du wiki aide à répondre (ex. un organigramme,
   un schéma), **réémets sa ligne markdown image `![…](…)`** dans ta réponse pour
   qu'elle s'affiche. »

L'agent recopie le lien texte ; le **navigateur** récupère l'image via `/api/raw-image`.
Réserves : dépend du prompt (fiable mais pas 100 %) ; en streaming l'image s'affiche
une fois son bloc terminé (imperceptible sur une réponse achevée).

### F. Amendement de la règle « verbatim » et docs

Le bloc figure (description machine) **et** son `page:` sortent du cadre actuel des
« repères structurels autorisés » et contredisent la consigne « retirer les numéros
de page ». À amender pour ajouter le bloc figure marqué + sa référence de page à la
liste blanche :
- `CLAUDE.md` règle #6.
- `docs/wiki-spec.md` §2.3 et §2.4.
- `prompts/ingest-prompt.md` (section « Format de sortie » ~L61-86, « Ligne rouge »
  ~L73-86) : décrire le bloc figure, autoriser sa reproduction verbatim, exempter sa
  référence de page du nettoyage.
- `docs/ingestion.md` §4 : documenter la passe vision (deux étapes, Haiku, aiguillage).

### G. Étape B — additions au prompt d'ingestion

`prompts/ingest-prompt.md` : instruire l'IA d'ingestion à traiter les **blocs figure
pré-formés** présents dans le texte assemblé — les **reproduire verbatim** (ne pas
reformuler la légende, les étiquettes, la structure, ni altérer la ligne image) et à
leur **ajouter les lignes d'annotation `topics:`/`entities:`** sous leur heading,
comme pour toute section (détection d'entités/thèmes inchangée). Un bloc figure est
reconnaissable à son heading `##` suivi d'une légende marquée « description machine,
non-verbatim » et d'une ligne `![…](/api/raw-image/…)`.

### H. Coût & modèle

- `web/lib/ingest-local.ts` : paramétrer le coût par modèle. Ajouter
  `RATE_HAIKU = { input:1, output:5, cacheWrite:1.25, cacheRead:0.10 }` et une
  fonction `estimateCostFor(model, usage)` (ou `RATE` indexé par modèle). Les tokens
  image sont déjà dans `usage.input_tokens`. Sommer le coût vision dans `totalCost` et
  l'entrée `perFile` du fichier (ou un champ `visionCostUsd`). Appel vision
  **non-streaming** pour que `x-litellm-response-cost` soit fiable.
- Ordre de grandeur : ~0,0016 $ d'entrée par page (Haiku, ~1600 tokens image) ; deck
  ~14 pages ≈ 0,05 $. Négligeable.

### I. Dépendance & packaging Electron (risque principal)

- Ajouter `@napi-rs/canvas` (`^0.1.69`+) à `web/package.json`.
- **Electron** : le binaire natif `.node` doit être **désasarisé** (`asarUnpack` dans
  la config electron-builder — localiser la config : bloc `build` de `package.json`
  racine/`web`, ou `electron-builder.yml`).
- **CI multiplateforme (Mac + Windows)** : npm n'installe par défaut que le binaire de
  la plateforme courante. Le job qui empaquette pour l'autre OS doit **forcer** les
  `optionalDependencies` de `@napi-rs/canvas` de la plateforme cible
  (`@napi-rs/canvas-darwin-arm64`, `@napi-rs/canvas-darwin-x64`,
  `@napi-rs/canvas-win32-x64-msvc`…). Localiser le workflow GitHub Actions de
  distribution (cf. commits récents « build CI Mac/Windows » et `tasks/lessons.md`).

---

## Décisions

- **Deux étapes, vision sur Haiku (pas sur le modèle d'ingestion).** Alternative
  écartée : envoyer les images au modèle d'ingestion (Sonnet/config). Raison : les
  tokens image sont le poste coûteux ; les isoler sur Haiku (1$/5$ vs 3$/15$) minimise
  le coût sans dégrader l'ingestion texte. Haiku peut se tromper sur un schéma très
  dense, mais les pixels restent dans `raw/` (vérité) et le rattrapage corrige →
  risque borné.
- **Aiguillage automatique PAR PAGE (3 signaux), PAS de case globale.** Alternatives
  écartées : (a) case « source visuelle » au dépôt forçant tout le document — rejetée
  car sur un PDF de 100 pages, forcer la vision partout est lent et inutile (l'enjeu
  est de distinguer page par page) ; (b) vision systématique sur toutes les pages —
  rejetée (coût/lenteur, contraire à l'objectif « coût minimal »). Signaux 1 (couche
  texte quasi-vide) et 2 (grosse image) fiables ; signal 3 (motif schéma) heuristique,
  ses ratés sont rattrapés manuellement.
- **Modèle vision = `claude-haiku-4-5`, réglable (`visionModel`).** Raison : le moins
  cher avec vision ; réglable pour escalade Sonnet ou si la gateway ne route pas Haiku.
- **Bloc figure = section `##` normale annotée** (pas de nœuds de graphe « figure »
  ni de facette « type » de premier plan en v1). Alternative écartée : faire des
  champs `type`/`caption`/`page` des dimensions requêtables (nécessiterait d'étendre
  `collectSections`, le graphe, `wiki-verify`, `wiki-spec`, `ResourceCard`). Raison :
  la section annotée est indexée comme le reste **sans toucher au moteur** ; le `type`
  reste un libellé qui pilote la mise en forme (tableau/liste/description).
- **Ancre de page = l'URL image du bloc** (`/api/raw-image/<fichier>?page=N`), pas un
  marqueur HTML séparé. Raison : robuste (l'IA reproduit une ligne image visible et
  signifiante) et sans dépendre de la préservation d'un commentaire HTML.
- **Rendu d'image à la demande** (route `/api/raw-image`), pas de PNG pré-généré sous
  `wiki/`. Raison : rien à stocker, `raw/` reste l'unique vérité ; mise en cache HTTP
  suffisante en v1.
- **Rattrapage par SÉLECTEUR DE PAGES** (v1), sur la fiche ressource existante
  (PDF gauche / transcription droite). Alternative reportée : bouton « re-traiter »
  inline par figure + vignettes cliquables (v2). Raison : le sélecteur de pages couvre
  les deux cas (figure ratée / page sautée) avec un minimum de code.
- **Blocs figure reproduits verbatim par l'IA d'ingestion (Étape B), annotés par
  elle.** Alternative reportée : greffe déterministe des blocs après l'appel
  d'ingestion (économiserait les tokens de sortie et garantirait la fidélité). Raison :
  la reproduction verbatim réutilise le comportement existant sans nouvelle plomberie ;
  l'annotation entités/thèmes reste centralisée (Étape B a le registre) ; coût de
  sortie supplémentaire modeste.
- **Amendement explicite de la règle #6.** Raison : sans cela, le bloc figure et son
  `page:` violent la règle cardinale verbatim et la consigne « retirer les numéros de
  page ». Décision d'architecte assumée par l'utilisateur (propriétaire du wiki).
- **Passe vision tolérante aux pannes.** Un échec d'appel Haiku laisse la page en
  texte seul sans faire échouer le document. Raison : mitige le risque gateway/Haiku
  et garde l'ingestion robuste.

---

## Hors périmètre

- **PPTX.** Reporté v2 : `jszip` ne donne que le texte ; « voir » une diapo exige un
  rendu plus lourd (conversion PPTX→PDF via LibreOffice headless, ou rendu OOXML).
- **Détection de zones/figures multiples dans une même page** (region detection). v1 :
  **une page routée = un rendu de page entière = un fragment Haiku** (Haiku lit toute
  la page). Une page à plusieurs schémas produit un seul bloc figure décrivant l'
  ensemble.
- **Champs figure de premier plan** (nœud `figure:` dans le graphe, facette « type »,
  index des figures, vérification dédiée dans `wiki-verify`).
- **Vignettes de pages cliquables + bouton « re-traiter » inline par figure** (v2 du
  rattrapage).
- **PNG pré-générés/cachés sur disque** (v1 = rendu à la demande + cache HTTP).
- **Greffe déterministe des blocs figure après l'appel d'ingestion** (optimisation
  coût/fidélité reportée).
- **Exposition du réglage `visionModel` dans l'UI `/reglages`** (le réglage existe
  avec défaut Haiku ; l'exposer visuellement est optionnel/reporté).
- **`.docx`** vision (mammoth donne déjà du texte structuré ; pas de trou identifié).

---

## Todo

- [x] **0. Vérifier l'accès Haiku + images sur la config réelle.** Script ponctuel :
  `getAnthropic().messages.create({ model:'claude-haiku-4-5', max_tokens:100,
  messages:[{role:'user', content:[{type:'image', source:{type:'base64', media_type:'image/png', data:<petit PNG>}}, {type:'text', text:'Décris.'}]}] })`.
  **Vérif** : réponse texte non vide. Si erreur « model not found » → documenter la
  route à ajouter dans la gateway, ou basculer `visionModel`/passer en Anthropic direct.
- [x] **1. Ajouter `@napi-rs/canvas`** à `web/package.json` (`npm --prefix web i @napi-rs/canvas`).
  **Vérif** : `node -e` qui appelle `renderPageAsImage` d'unpdf sur la page 1 d'un PDF
  de `raw/` (ex. `raw/Proposition Commerciale Erget - Build.pdf`) et écrit un PNG ;
  ouvrir le PNG → la page 1 est visible.
- [x] **2. `web/lib/pdf-render.ts` → `renderPdfPageToPng(pdfOrBytes, page, scale=2)`.**
  **Vérif** : test unitaire — le buffer retourné commence par la signature PNG
  (`89 50 4E 47`) et fait > 0 octet.
- [x] **3. Route `web/app/api/raw-image/[...file]/route.ts`.**
  **Vérif** : `npm --prefix web run dev` puis ouvrir
  `/api/raw-image/Proposition%20Commerciale%20Erget%20-%20Build.pdf?page=3` → l'image
  de la page 3 s'affiche (`Content-Type: image/png`).
- [x] **4. Extraction PDF par page** (`extractText(pdf,{mergePages:false})`, exposer
  `{ pages, pdf }`). **Vérif** : la suite `web/lib/__tests__/ingest-local.test.ts`
  passe (`npm --prefix web test`) ; un log confirme `pages.length === totalPages` sur
  le PDF Erget.
- [x] **5. Aiguillage `classifyPageForVision` (3 signaux) + constantes calibrables.**
  **Vérif** : sur le PDF Erget (majoritairement diagrammes) → la plupart des pages sont
  routées vision ; sur une ressource `.md`/texte → aucune ; idéalement tester un PDF
  scanné (couche texte vide) → toutes routées. Logguer, pour chaque page, quel signal
  a déclenché.
- [x] **6. `web/lib/vision-ingest.ts` + `prompts/vision-figure-prompt.md` +
  réglage `visionModel` (défaut `claude-haiku-4-5`) dans `web/lib/ai-settings.ts`.**
  Appel Haiku **non-streaming**, image + `pageText` en contexte, sortie fragment
  markdown (OCR verbatim du non-extrait + blocs figure §B). Tolérance aux pannes
  (warning + page en texte seul). **Vérif** : `visionTranscribePage` sur une page-
  schéma d'Erget → renvoie un bloc figure conforme au gabarit §B (heading, légende
  finissant par un point, ligne `![](/api/raw-image/…?page=N)`, « Texte littéral »,
  représentation selon type) ; l'`usage` est retourné et le coût calculé au barème
  Haiku.
- [x] **7. Coût par modèle** (`RATE_HAIKU` + `estimateCostFor(model, usage)`), somme
  du coût vision dans `perFile`/`totalCost`. **Vérif** : test unitaire —
  `estimateCostFor('claude-haiku-4-5', {input_tokens:1_000_000})` = 1.0 ;
  `estimateCostFor('claude-sonnet-4-5', …)` inchangé.
- [x] **8. Intégration boucle `runIngestion`** (extraction par page → aiguillage →
  vision → assemblage ; garde-fou L365/L1179 → aiguillage, plus de `throw` prématuré ;
  phase `vision`). **Vérif** : ingérer le PDF Erget de bout en bout (via
  `POST /api/ingest` ou dépôt) sans crash ; la page `wiki/resources/<slug>.md` produite
  contient des blocs figure avec lignes `![](/api/raw-image/…)` ; l'état d'ingestion
  reporte un coût > 0 incluant la vision. Comparer avec `main` (aujourd'hui : crash ou
  page quasi vide).
- [x] **9. Amendement règle #6 + docs** (`CLAUDE.md` #6, `docs/wiki-spec.md` §2.3/§2.4,
  `docs/ingestion.md` §4, `prompts/ingest-prompt.md`). **Vérif** : relecture — le bloc
  figure marqué « description machine » et sa référence de page sont explicitement
  autorisés ; plus de contradiction avec « retirer les numéros de page ».
- [x] **10. Additions prompt d'ingestion (Étape B)** : reproduire les blocs figure
  verbatim + les annoter `topics:`/`entities:`. **Vérif** : re-ingérer Erget → les
  sections figure portent des annotations `topics:`/`entities:` ; `npm --prefix web run
  wiki:verify` (ou `scripts/wiki-verify.ts`) passe (pas d'`unknown-entity`/`unknown-theme`,
  pas de `graph-missing-*`).
- [x] **11. Consigne image dans le prompt du chat** (`web/lib/chat-agent.ts` L362-430).
  **Vérif** : dans le chat (`npm --prefix web run dev`), poser une question sur une
  figure d'Erget (ex. l'architecture ou le planning) → la réponse contient une ligne
  `![](/api/raw-image/…?page=N)` **et** l'image s'affiche réellement dans la bulle de
  réponse.
- [x] **12. Endpoint rattrapage `web/app/api/resource/[slug]/revise-figures/route.ts`**
  + helper de greffe chirurgicale (remplacer/insérer le bloc figure par ancre de page)
  + re-projection. **Vérif** : `POST { pages:[N] }` sur une ressource Erget →
  `wiki/resources/<slug>.md` voit **uniquement** le bloc de la page N remplacé, les
  autres inchangés ; les vues dérivées sont recohérentes (`wiki:verify` passe) ; coût
  ≈ 1 page.
- [x] **13. UI rattrapage** `web/components/sources/ReviseFigures.tsx` intégré au
  panneau droit de `web/app/sources/[id]/page.tsx`. **Vérif** : sur la fiche d'une
  ressource Erget, saisir un numéro de page, cliquer « Re-traiter » → la transcription
  (droite) se met à jour ; comparaison PDF (gauche) / transcription (droite)
  fonctionnelle.
- [x] **14. Packaging Electron** (`asarUnpack` de `@napi-rs/canvas` + binaires des
  deux plateformes dans le workflow CI). **Vérif** : builds `.dmg` **et** `.exe`
  produits par la CI ; au lancement de l'app packagée sur macOS **et** Windows, la
  route `/api/raw-image` rend bien une page (le binaire natif est chargé) — c'est le
  point de risque, à prouver sur les deux OS.
- [x] **15. Boucle d'amélioration** : consigner dans `tasks/lessons.md` tout écart
  constaté (seuils d'aiguillage recalibrés, config gateway Haiku, galères packaging
  natif).

---

## Bilan (2026-09-01)

### Fait (tous les todos)
- **Rendu** : `web/lib/pdf-render.ts` (`openPdf`/`renderPdfPageToPng`, canvas natif), route
  `web/app/api/raw-image/[...file]/route.ts`, dépendance `@napi-rs/canvas`.
- **Passe vision** : `web/lib/vision-ingest.ts` (extraction par page, `classifyPageForVision`
  à 3 signaux, `visionTranscribePage`, `runVisionPass`), prompt `prompts/vision-figure-prompt.md`,
  réglage `visionModel` (défaut `claude-haiku-4-5`) dans `ai-settings.ts`/`claude.ts`.
- **Coût** : `RATE_HAIKU` + `estimateCostFor(model, usage)` (`estimateCost` intact) ; coût vision
  cumulé dans `perFile`/`totalCost`.
- **Intégration** : boucle `runIngestion` branchée (PDF → vision → assemblage → `callModel`) ;
  garde-fou « texte vide » déplacé APRÈS la vision.
- **Docs/prompts** : règle #6 (CLAUDE.md), `wiki-spec §2.3 bis/§2.4`, `ingestion.md §4`,
  Étape B dans `ingest-prompt.md`, consigne image dans `chat-agent.ts`.
- **Rattrapage** : helper pur `web/lib/figure-block.ts`, endpoint
  `web/app/api/resource/[slug]/revise-figures/route.ts`, UI `components/sources/ReviseFigures.tsx`
  intégrée à la fiche.
- **Packaging** : copie du scope `@napi-rs` dans `copy-standalone-assets.js` + garde-fou
  `after-pack.js` + externalisation `next.config.js`.

### Preuves exécutées
- Rendu page 1 Erget (visuel OK), tests `pdf-render` (signature PNG), route `raw-image` **live**
  sur le dev server (200 `image/png`), aiguillage 13/14 pages Erget, **vrai appel Haiku** →
  bloc figure conforme §B (~0,5 ¢), **vrai appel modèle d'ingestion** → figure reproduite verbatim
  + annotée, test `estimateCostFor`, tests `figure-block` (greffe), UI `ReviseFigures` **rendue**
  dans le HTML de la fiche, **rattrapage page 3 Erget de bout en bout sur copie isolée** (bloc
  greffé, 5/5 sections préservées, `wiki:verify` 0 erreur, $0,006). Global : **0 erreur tsc, 241 tests**.

### Écarts au plan (assumés)
- **Todo 8 (E2E)** : l'ingestion live des 14 pages via `runIngestion` n'a **pas** été lancée
  (Arthur a choisi la preuve isolée moins coûteuse). La boucle est prouvée pièce par pièce
  (aiguillage + assemblage + Étape B + coût) et compile/teste ; le rattrapage isolé exerce la
  MÊME chaîne aval (rendu→Haiku→figure→greffe→projection→verify). **Reste à faire quand voulu** :
  déclencher une vraie ingestion vision (deck complet ≈ 0,05 $ vision + rédaction).
- **Todo 11 (chat)** : la consigne image est ajoutée ; les 3 autres conditions sont acquises
  (lien dans la fiche, rendu `![]()`→`<img>` par react-markdown, image servie par `/api/raw-image`
  prouvée). L'affichage réel dans une bulle dépend du comportement de l'agent (fiable, pas 100 %) —
  non exercé en live (coûterait + exige une figure déjà ingérée).
- **Todo 14 (packaging)** : mécanisme de copie du binaire natif **prouvé** (macOS) ; le build
  `.dmg`/`.exe` sur les **deux** OS reste **CI-only** (Windows indisponible ici ; interdiction de
  détruire le `.next` du dev concurrent). Garde-fou `after-pack` échoue si le binaire manque.
  **Écart spec** : `asarUnpack` **non utilisé** — inutile ici car le serveur Next tourne depuis
  `Resources/standalone/` (process Node séparé), pas depuis l'asar ; le natif vit dans
  `standalone/node_modules`.
- **Choix d'implémentation** : (a) la ligne image du bloc figure est **fournie** verbatim à Haiku
  (URL construite côté code) plutôt que laissée à sa charge → ancre robuste ; (b) l'endpoint
  rattrapage re-projette **sans phase « retract »** (le frontmatter ne change pas) → plus simple
  que le PATCH, correct.

### Suivi — retours d'usage (2026-09-01, après test réel d'Arthur)
- **Image chat par défaut** : la consigne chat était trop timide (l'agent n'affichait la figure
  qu'après « montre-moi la photo »). Rendue **impérative** dans `chat-agent.ts` (« dès qu'une
  section exploitée contient une ligne image, tu DOIS l'inclure »).
- **Rattrapage par CASES À COCHER SUR LES PAGES** (la v2 « hors périmètre » avancée, sur retour
  d'Arthur) : le visualiseur PDF natif (`<iframe>`) est **remplacé** par une colonne d'images de
  pages (`/api/raw-image?page=N`), une case posée sur chaque page (clic = coche), point orange si
  figure déjà présente, bouton « Re-traiter » collant. `GET` de l'endpoint = `{ totalPages,
  figurePages }`. Compromis : plus de zoom/sélection-texte natifs (bouton « Télécharger » conservé).
  Bouton inline par figure reste hors périmètre.

