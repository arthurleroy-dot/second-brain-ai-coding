# Ingestion Word (.docx) et PowerPoint (.pptx)

## Contexte

**Demande d'origine (utilisateur) :** « Dans mon projet, on ne peut pas mettre de
Word ni de PowerPoint, alors que la page d'upload dit que c'est possible. Ça ne
marche pas. »

**Diagnostic établi (investigation 3 agents + lecture code) :** l'app a deux
portes que tout fichier déposé doit franchir.

1. **Porte d'entrée (upload)** — `web/app/api/upload/route.ts:9` :
   `const ACCEPTED_EXT = ['.md', '.txt', '.pdf', '.pptx', '.docx'];` (+ UI qui
   annonce les 5 formats dans `web/components/upload/UploadForm.tsx:328` et
   `UploadView.tsx`). Les 5 formats passent cette porte, sont écrits dans `raw/`
   avec leur sidecar `.meta.md`.
2. **Porte de lecture (extraction texte à l'ingestion)** —
   `web/lib/ingest-local.ts:323-334`, fonction `extractSourceText`. Elle ne gère
   que `.md`, `.txt`, `.pdf`. Pour toute autre extension elle **lève une
   exception** (`ingest-local.ts:333`).

**Conséquence réelle et vérifiée :** un `.docx`/`.pptx` déposé est détecté « à
traiter » (`detectPending()` ne filtre PAS par extension —
`ingest-local.ts:112-131`), puis `extractSourceText` lève
« Extension non prise en charge (md/txt/pdf seulement) ». L'erreur est attrapée
par le `try/catch` par-fichier (autour de `ingest-local.ts:950`), le fichier est
marqué en erreur, **jamais ingéré**, jamais ajouté au manifeste `_ingested.json`
→ **re-tenté et re-échoué à chaque run**. Le PDF, lui, marche déjà (via `unpdf` ;
8 PDF sont ingérés dans `raw/`). C'est une **fausse promesse** de l'UI pour Word
et PowerPoint.

**Décision de périmètre (validée par l'utilisateur) :** rendre **Word (.docx) ET
PowerPoint (.pptx)** réellement ingérables. L'utilisateur a confirmé avoir testé
un Word et un PowerPoint (pas un PDF).

**Contrainte d'architecture :** app **local-first / Electron** (voir
`CLAUDE.md` + `tasks/specs/2026-07-20-refonte-local-first-electron.md`). Toute
brique doit tourner **en local, sans cloud**, et être **100 % JavaScript** (aucun
binaire natif) pour survivre à l'empaquetage `.dmg`/`.exe`.

## Plan

**Objectif :** rendre `.docx` et `.pptx` réellement ingérables en ajoutant leur
extraction texte, sans toucher au reste du pipeline.

**1. Une seule zone de code fonctionnelle à modifier.** Tout se joue dans
`extractSourceText` (`web/lib/ingest-local.ts:323-334`). On y ajoute deux
branches (`.docx`, `.pptx`) + un garde-fou « texte vide ». Le reste (upload,
écriture `raw/`, `detectPending`, moteur déterministe `wiki-project.ts`, appel
IA) **ne bouge pas** → risque minimal.

**2. Les briques (locales, gratuites, pur JS) :**

| Format | Brique | Mécanisme |
|--------|--------|-----------|
| **Word `.docx`** | `mammoth` (^1.12.0) | `mammoth.extractRawText({ buffer })` → texte fidèle (paragraphes, titres, listes, tableaux). |
| **PowerPoint `.pptx`** | `jszip` (^3.x) + extraction maison | Un `.pptx` est une archive ZIP OOXML ; on lit `ppt/slides/slideN.xml` **dans l'ordre**, on récupère le texte des `<a:t>` (regroupés par paragraphe `<a:p>`), + les notes `ppt/notesSlides/notesSlideN.xml`. |
| **PDF `.pdf`** | `unpdf` (déjà présent) | **INCHANGÉ**. |
| **`.md` / `.txt`** | `fs.readFile` utf-8 | **INCHANGÉ**. |

**3. Garde-fou « texte vide ».** Après extraction d'un `.pdf`/`.docx`/`.pptx`, si
le texte est vide ou blanc (`!text.trim()`), lever une erreur explicite
(« aucun texte extractible — document scanné/composé d'images ? OCR non géré »)
au lieu de produire une page vide ou de gâcher un appel IA. **NE s'applique PAS**
aux `.md`/`.txt` (comportement actuel préservé à l'identique).

**4. Doc mise à jour.** `docs/ingestion.md` (paragraphe extraction, ~l.163-164,
qui ne cite que md/txt/pdf), le commentaire `ingest-local.ts:321`, et le message
d'erreur `ingest-local.ts:333`. L'UI liste déjà les 5 formats : aucune
modification UI → elle devient enfin honnête.

### Code cible (à implémenter)

Imports à ajouter en tête de `web/lib/ingest-local.ts` (à côté de
`import { extractText, getDocumentProxy } from 'unpdf';`, l.6) :

```ts
import mammoth from 'mammoth';
import JSZip from 'jszip';
```

Remplacement de la fonction `extractSourceText` (`ingest-local.ts:320-334`) :

```ts
// ————————————————————————————————————————————————————————————————
// Extraction texte : md/txt directs ; PDF (unpdf), Word .docx (mammoth) et
// PowerPoint .pptx (jszip + <a:t>) extraits en local, gratuitement. Aucun OCR.

export async function extractSourceText(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const abs = path.join(RAW_ROOT, file);

  // md/txt : lecture directe, aucune garde (un fichier texte vide reste valide).
  if (ext === '.md' || ext === '.txt') return fs.readFile(abs, 'utf-8');

  let text: string;
  if (ext === '.pdf') {
    const buf = await fs.readFile(abs);
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    ({ text } = await extractText(pdf, { mergePages: true }));
  } else if (ext === '.docx') {
    const buf = await fs.readFile(abs);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    text = value;
  } else if (ext === '.pptx') {
    const buf = await fs.readFile(abs);
    text = await extractPptxText(buf);
  } else {
    throw new Error(
      `Extension non prise en charge pour l'extraction texte : ${ext} (md/txt/pdf/docx/pptx seulement).`,
    );
  }

  // Garde-fou : extraction binaire qui ne rend rien = scan/images → OCR requis.
  if (!text.trim()) {
    throw new Error(
      `Aucun texte extractible de « ${file} » (document scanné ou composé d'images ? l'OCR n'est pas géré).`,
    );
  }
  return text;
}

// PowerPoint (.pptx) = archive OOXML. Le texte visible est dans les <a:t> des
// diapos (ppt/slides/slideN.xml), regroupés par paragraphe <a:p> ; les notes de
// l'orateur dans ppt/notesSlides/notesSlideN.xml. On concatène diapo par diapo,
// dans l'ordre numérique, notes de chaque diapo à la suite de son corps.
async function extractPptxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slideNums = Object.keys(zip.files)
    .map((p) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(p))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);

  const chunks: string[] = [];
  for (const n of slideNums) {
    const body = pullDrawingmlText(await zip.file(`ppt/slides/slide${n}.xml`)!.async('string'));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? pullDrawingmlText(await notesFile.async('string')) : '';
    const parts = [body, notes].filter((s) => s.trim().length > 0);
    if (parts.length) chunks.push(parts.join('\n'));
  }
  return chunks.join('\n\n');
}

// Texte DrawingML : on concatène les <a:t> À L'INTÉRIEUR de chaque paragraphe
// <a:p> SANS séparateur (un mot peut être coupé en plusieurs runs par le
// formatage), et on sépare les paragraphes par un saut de ligne.
function pullDrawingmlText(xml: string): string {
  const paras = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((m) => m[0]);
  return paras
    .map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1])).join(''))
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // &amp; en DERNIER pour ne pas re-décoder les autres entités
}
```

**Notes d'implémentation importantes :**
- `fs` dans ce fichier est `fs/promises` (`fs.readFile(abs)` sans encodage rend
  un `Buffer`). `mammoth.extractRawText({ buffer })` et `JSZip.loadAsync()`
  acceptent un `Buffer`.
- Le regex `<a:p\b` grâce au `\b` (frontière de mot) matche `<a:p>` et
  `<a:p ...>` mais **PAS** `<a:pPr>` (propriétés de paragraphe, sans texte).
  Les `<a:p/>` auto-fermants (paragraphes vides) ne matchent pas → ignorés,
  correct.
- `<a:t>` en DrawingML est toujours dans un `<a:r>` (run) dans un `<a:p>` ; les
  cellules de tableau utilisent aussi `<a:p>/<a:t>` → capturées.
- **Types TypeScript :** `jszip` embarque ses types. `mammoth` **n'embarque pas**
  de types officiels — si `tsc`/le build se plaint de « Could not find a
  declaration file for module 'mammoth' », ajouter un shim ambient minimal (ex.
  `web/types/mammoth.d.ts` : `declare module 'mammoth';`) OU installer
  `@types/mammoth` en devDependency si disponible. Ne PAS utiliser `@ts-ignore`
  ligne à ligne.

## Décisions

- **Word → `mammoth`, PAS `officeparser`.** `officeparser@7.4.0` traîne
  `tesseract.js` (moteur OCR WASM, dizaines de Mo + données de langue) **et**
  `pdfjs-dist` (2ᵉ moteur PDF, doublon d'`unpdf`) — poids mort inacceptable dans
  le `.dmg`/`.exe`. `mammoth` est pur JS (deps : `@xmldom/xmldom`, `jszip`,
  `underscore`…), best-in-class pour l'extraction de texte Word. **Vérifié par
  `npm view mammoth dependencies` / `npm view officeparser dependencies`.**
- **PowerPoint → `jszip` + extraction maison, PAS `officeparser` ni un parseur
  XML complet.** Contrôle explicite de l'ordre des diapos et des notes ;
  extraction par regex `<a:t>` regroupés par `<a:p>` = approche standard, robuste
  et sans dépendance lourde. `jszip` est déjà une dépendance transitive de
  `mammoth` (donc déjà dans l'arbre) et embarque ses types.
- **Notes de l'orateur : INCLUSES**, interleavées à la suite du corps de chaque
  diapo. Raison : pour un wiki de veille, les notes portent souvent l'argument
  réel que les puces n'ont pas ; c'est du contenu authentiquement rédigé.
  Facilement désactivable (retirer la lecture de `notesSlideN.xml`).
- **Concaténation par paragraphe (`<a:p>`), pas run par run.** Joindre les `<a:t>`
  d'un même `<a:p>` **sans séparateur** évite de couper un mot que le formatage a
  éclaté en plusieurs runs ; on ne sépare que les paragraphes (saut de ligne).
- **Garde-fou « texte vide » sur `.pdf`/`.docx`/`.pptx` uniquement.** Un texte
  extrait vide signale un scan / des images (pas d'OCR). Sur `.md`/`.txt`, un
  fichier vide est un vrai fichier de l'utilisateur → comportement actuel
  préservé (aucune garde). Bonus : ce garde-fou traite aussi le cas du **PDF
  scanné** (message clair au lieu d'un échec obscur ou d'une page vide).
- **`unpdf` conservé tel quel pour le PDF.** On ne touche pas à ce qui marche.
- **Fixtures de test générées à la volée** (pas de binaire commité), avec un
  **plan B** pour le `.docx` : voir Todo étape 6.
- **`detectPending` inchangé** : il ne filtre déjà pas par extension, donc
  `.docx`/`.pptx` sont déjà détectés « à traiter ». Aucune modification requise.
- **UI inchangée** : `ACCEPTED_EXT` (upload) et les textes annoncent déjà les 5
  formats. La correction rend l'app cohérente sans toucher au frontend.

## Hors périmètre

- **OCR** (lire le texte à l'intérieur d'images ou d'un PDF scanné). Grosse brique
  séparée (moteur type `tesseract.js`, poids + perf). Le garde-fou renvoie un
  message clair à la place ; l'OCR pourra être une feature ultérieure.
- **Fidélité visuelle des PowerPoint** : schémas, flèches, disposition spatiale,
  texte « gravé » dans une image. On extrait le **texte** des zones de texte et
  des notes, pas la mise en page. Limite assumée : une diapo très visuelle donne
  une page pauvre.
- **Images / objets embarqués** dans un `.docx`/`.pptx` (non extraits).
- **Anciens formats binaires** `.doc` / `.ppt` (pré-2007, non-OOXML) : hors
  périmètre. Seuls `.docx`/`.pptx` (OOXML/ZIP) sont visés.
- **Excel `.xlsx`** : non demandé, non ajouté à l'upload.
- **Modification de l'UI, de `detectPending`, du moteur déterministe, du prompt
  d'ingestion** : aucune (le `source_type: presentation` existe déjà dans
  `prompts/ingest-prompt.md` pour un PowerPoint).

## Todo

- [x] **1. Ajouter les dépendances.** Dans `web/`, `npm install mammoth jszip`
  (runtime deps). **Vérif :** `npm ls mammoth jszip` résout sans conflit ; les
  deux apparaissent dans `web/package.json` → `dependencies`. `npm test` (dans
  `web/`) reste **VERT** (aucun import ajouté encore, non-régression).

- [x] **2. Ajouter les imports** `mammoth` et `JSZip` en tête de
  `web/lib/ingest-local.ts`. Résoudre l'éventuel manque de types de `mammoth`
  (shim `declare module 'mammoth';` dans `web/types/` si nécessaire — cf. Notes
  d'implémentation). **Vérif :** `npx tsc --noEmit` (ou `npm run build`) passe
  sans erreur de type/module sur `ingest-local.ts`.

- [x] **3. Implémenter les helpers PPTX** (`extractPptxText`,
  `pullDrawingmlText`, `decodeXmlEntities`) dans `web/lib/ingest-local.ts`, tels
  que spécifiés dans « Code cible ». **Vérif :** compile (`tsc --noEmit`) ;
  validé fonctionnellement par les tests de l'étape 6.

- [x] **4. Étendre `extractSourceText`** avec les branches `.docx` (mammoth) et
  `.pptx` (`extractPptxText`) + le garde-fou « texte vide », en remplaçant la
  fonction actuelle par la version « Code cible ». Mettre à jour le **commentaire**
  (`ingest-local.ts:321`) et le **message d'erreur** (« md/txt/pdf/docx/pptx
  seulement »). **Vérif :** compile ; comportement `.md`/`.txt`/`.pdf` inchangé
  (le test existant `detectPending` et la chaîne complète restent verts).

- [x] **5. Confirmer la non-régression** de la suite existante :
  `cd web && npm test`. **Vérif :** tous les tests actuels de
  `lib/__tests__/ingest-local.test.ts` (et les autres) restent **VERTS**.

- [x] **6. Ajouter les tests unitaires d'extraction** dans
  `web/lib/__tests__/ingest-local.test.ts` (même fichier : `RAW_ROOT` y est déjà
  pointé vers `path.join(tmp,'raw')` AVANT le premier import — les fixtures
  s'écrivent dans `tmp/raw/…` et on appelle `extractSourceText('nom.ext')`).
  Générer les fixtures **à la volée avec `JSZip`** :
  - **`.pptx`** (robuste, on contrôle parseur ET fixture) : zip contenant
    `ppt/slides/slide1.xml`, `ppt/slides/slide2.xml` (+ éventuellement
    `ppt/notesSlides/notesSlide1.xml`), chaque `slide` de la forme minimale :
    ```xml
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
           xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody>
        <a:p><a:r><a:t>MARQUEUR_DIAPO_1</a:t></a:r></a:p>
        <a:p><a:r><a:t>DEUXIEME LIGNE</a:t></a:r></a:p>
      </p:txBody></p:sp></p:spTree></p:cSld>
    </p:sld>
    ```
    Assertions : le texte rendu contient les marqueurs, les diapos sont dans
    l'ordre (slide1 avant slide2), les notes (si présentes) apparaissent, et un
    `<a:t>` avec `&amp;`/`&lt;` est correctement décodé.
  - **`.docx`** (dépend de l'acceptation par `mammoth`) : zip minimal avec
    `[Content_Types].xml`, `_rels/.rels` (Relationship `officeDocument` →
    `word/document.xml`), et `word/document.xml` :
    ```xml
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>MARQUEUR_DOCX_LIGNE_1</w:t></w:r></w:p>
        <w:p><w:r><w:t>MARQUEUR_DOCX_LIGNE_2</w:t></w:r></w:p>
      </w:body>
    </w:document>
    ```
    Assertion : le texte rendu contient les deux marqueurs.
    **PLAN B** si `mammoth` refuse le zip généré à la main (structure OOXML trop
    fragile) : committer un tout petit fichier réel
    `web/lib/__tests__/fixtures/sample.docx` (créé avec un vrai éditeur, contenu
    connu) et le copier dans `tmp/raw/` au lieu de le générer.
  - **Garde-fou** : une fixture `.pptx` sans aucun `<a:t>` (ou `.docx` sans
    texte) doit faire **rejeter** `extractSourceText` avec le message « Aucun
    texte extractible ». Utiliser `assert.rejects(..., /Aucun texte extractible/)`.
  - **Extension non gérée** : `extractSourceText('x.xlsx')` (fixture vide) doit
    rejeter avec `/non prise en charge/`.
  **Vérif :** `cd web && npm test` → tous VERTS, y compris les nouveaux cas.

- [x] **7. Mettre à jour la doc.** Dans `docs/ingestion.md`, réécrire le
  paragraphe d'extraction (~l.163-164, qui ne mentionne que md/txt/pdf) pour
  inclure : Word `.docx` (mammoth), PowerPoint `.pptx` (jszip + `<a:t>`, diapos +
  notes), le garde-fou « texte vide », et la limite « pas d'OCR / pas de fidélité
  visuelle PPT ». Vérifier la cohérence de la liste des formats (l.38 déjà à 5
  formats). **Vérif :** relecture ; la doc ne contredit plus le code (les 5
  formats acceptés = les 5 formats extraits).

- [x] **8. Démonstration bout-en-bout sur de VRAIS fichiers** (preuve exigée
  avant « terminé » — un test unitaire ne suffit pas). Deux niveaux :
  - **(a) Extraction réelle (obligatoire, gratuit, sans clé IA)** : se procurer
    un vrai `.docx` et un vrai `.pptx` (créés dans Word/PowerPoint ou LibreOffice,
    avec du texte connu), et lancer un script tsx qui appelle `extractSourceText`
    et imprime le résultat. Ex. (depuis `web/`, après avoir copié les fichiers
    dans le `raw/` pointé par `RAW_ROOT`) :
    ```
    node --import tsx -e "import('./lib/ingest-local.ts').then(async m => { \
      console.log('DOCX:\n', await m.extractSourceText('mon-test.docx')); \
      console.log('PPTX:\n', await m.extractSourceText('mon-test.pptx')); })"
    ```
    **Vérif :** le texte imprimé correspond fidèlement au contenu des fichiers
    (paragraphes Word ; diapos PPT dans l'ordre + notes). Coller la sortie réelle
    dans le compte-rendu à l'utilisateur.
  - **(b) Ingestion complète (optionnel, coûte 1 appel IA + clé requise)** :
    déposer un petit `.docx` et un petit `.pptx` via l'app (`/upload`), laisser
    l'ingestion tourner, vérifier qu'une page `wiki/resources/<slug>.md` est bien
    créée et que le fichier entre dans `wiki/_ingested.json`. **Vérif :** page
    ressource présente et non vide ; statut d'ingestion « done », pas « error ».

- [ ] **9. (Considération, pas bloquant) Empaquetage Electron.** Les nouvelles
  deps (`mammoth`, `jszip`, pur JS) sont bundlées avec le serveur Next dans
  l'app. Si un build `.dmg`/`.exe` est régénéré, faire un smoke-test : ingérer un
  `.docx`/`.pptx` dans l'app packagée. **Vérif :** ingestion OK hors mode dev.
  (Le cœur de la preuve reste l'étape 8 ; cette étape ne bloque pas la
  livraison.)

## Bilan

**Fait (conforme à la spec) :**

- **Deps ajoutées** : `mammoth@1.12.0` + `jszip@3.10.1` dans `web/package.json` →
  `dependencies` ; `npm ls` résout sans conflit (`jszip` de `mammoth` est *deduped*
  sur la nôtre). Pur JS, compatibles empaquetage Electron.
- **`extractSourceText` étendue** (`web/lib/ingest-local.ts`) : branches `.docx`
  (mammoth) et `.pptx` (`extractPptxText` maison via jszip) + garde-fou « texte vide »
  sur `.pdf`/`.docx`/`.pptx` uniquement. Helpers `extractPptxText`,
  `pullDrawingmlText`, `decodeXmlEntities` ajoutés tels que spécifiés. Commentaire et
  message d'erreur mis à jour (« md/txt/pdf/docx/pptx »). `.md`/`.txt`/`.pdf`
  **inchangés**.
- **Types** : `tsc --noEmit` **exit 0**. Contrairement à ce que craignait la spec,
  `mammoth@1.12.0` **embarque ses propres types** (`node_modules/mammoth/lib/index.d.ts`)
  → **aucun shim `declare module` ni `@types/mammoth` nécessaire**. `jszip` embarque
  aussi ses types.
- **Tests** (`web/lib/__tests__/ingest-local.test.ts`) : 6 nouveaux tests, tous verts —
  ordre des diapos (y compris zip en désordre → tri numérique), notes de l'orateur
  incluses, décodage des entités XML, extraction `.docx` par mammoth, garde-fou
  « texte vide », extension non gérée. **Le plan B `.docx` n'a pas été nécessaire** :
  mammoth accepte le zip OOXML minimal construit à la volée par JSZip.
- **Doc** : `docs/ingestion.md` (paragraphe extraction) réécrit — les 4 briques, le
  garde-fou, et les limites (pas d'OCR, pas de fidélité visuelle PPT). Cohérent avec la
  liste des 5 formats (l.38).
- **Preuve sur de VRAIS fichiers (étape 8a)** : un `.docx` (37 Ko) et un `.pptx`
  (34 Ko) générés par `python-docx`/`python-pptx` (OOXML complet : thème, masques,
  layouts, notes) → `extractSourceText` restitue fidèlement titre/paragraphes/**cellules
  de tableau**/puces pour Word, et titre/sous-titre/**notes de l'orateur** interleavées/
  puces **dans l'ordre**, entités `&` et `<…>` décodées, pour PowerPoint. Sortie réelle
  collée dans le compte-rendu à l'utilisateur.

**Déviations / points ouverts :**

- **1 test pré-existant rouge, hors périmètre** : `wiki-tools.test.ts:68`
  (« renvoie les 13 fiches ») attend un **compte codé en dur de 13** alors que le wiki
  contient désormais **17** ressources (croissance du wiki via d'autres travaux, visible
  au `git status` d'ouverture). Sans rapport avec l'extraction (grep = 0 sur
  extractSourceText/mammoth/jszip/docx/pptx). Pattern déjà consigné dans `tasks/lessons.md`
  (2026-07-22, compte data-dépendant). **Non corrigé** (« ne toucher que le nécessaire » ;
  fichier étranger à cette tâche) — signalé à l'utilisateur.
- **Étape 8b (ingestion complète avec appel IA)** : **non exécutée** — optionnelle,
  coûte 1 appel IA + clé gateway. La preuve d'extraction (8a) sur vrais fichiers suffit à
  démontrer le correctif ; l'appel IA et la projection déterministe sont inchangés.
- **Étape 9 (empaquetage Electron)** : **non exécutée** (non bloquante par la spec).
  `mammoth`/`jszip` sont pur JS et bundlés avec le serveur Next comme les autres deps ;
  à re-vérifier si un `.dmg`/`.exe` est régénéré.
- **Build Next complet** : non lancé (risque des crashs Node 26 / sessions concurrentes
  documentés dans `lessons.md`). À la place, preuve plus forte : `tsc --noEmit` vert **et**
  import runtime réel de `ingest-local.ts` via tsx qui exécute mammoth **et** jszip avec
  succès sur les vrais fichiers.

---

**Fichier de spec :** `tasks/specs/2026-07-23-ingestion-word-powerpoint.md`

**Commande à taper dans une session neuve :**

```
/implement @tasks/specs/2026-07-23-ingestion-word-powerpoint.md
```
