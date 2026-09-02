# Mise en forme du code (cadre + coloration) et des formules mathématiques (rendu KaTeX) + révision IA des formules

## Contexte

**Demande d'origine (Arthur).** « Lorsqu'on copie-colle du code, ou qu'on upload un
document contenant du code, la partie de code doit être affichée dans un cadre spécial
(coloration syntaxique) — dans la ressource, la page sources, ET dans le chat. Idem pour
les formules mathématiques copiées-collées : elles doivent être remises en forme
proprement. » Exemple fourni : une matrice collée en « dessin » de caractères Unicode

```
⎡ 1  2  3 ⎤              ⎡ 1  4 ⎤
A  =  ⎣ 4  5  6 ⎦       Aᵀ  =  ⎢ 2  5 ⎥
                               ⎣ 3  6 ⎦
```

doit s'afficher comme une vraie matrice (crochets `\begin{bmatrix}`, exposant transposée
`ᵀ`), à l'identique d'une capture d'écran montrant un rendu LaTeX propre.

**Problème réel (constaté à l'audit).**
- Le rendu markdown de tout le wiki repose sur `react-markdown@^10.1.0` + `remark-gfm@^4.0.1`
  UNIQUEMENT. **Aucun** highlighter de code, **aucun** support mathématique. Un bloc
  ```` ``` ```` s'affiche en gris monochrome (pas de couleurs) ; une formule ne s'affiche
  pas du tout (texte brut).
- La logique de rendu est **dupliquée** en deux endroits :
  `web/components/sources/FullContentProse.tsx` (pages ressource / détail source / thème /
  entité) et `web/components/chat/Message.tsx` (chat, avec en plus le chemin streaming
  `CommittedMarkdown`).
- Le prompt d'ingestion (`prompts/ingest-prompt.md`) ne dit **rien** du code ni des maths.
  Empiriquement : une ressource FinOps contenant du Python a été **aplatie en prose** (blocs
  perdus) ; la ressource « transposée » stocke les matrices comme un **magma d'Unicode
  cassé** (recopie verbatim fidèle d'un collage illisible) — c'est exactement le cas de la
  capture. **L'affichage seul ne peut donc PAS régler le cas d'usage** : la matrice arrive
  comme un dessin de caractères, pas comme une notation que l'ordinateur comprend. Il faut
  que l'IA d'ingestion la **transcrive en LaTeX**.
- Contrainte cardinale : **règle verbatim** (CLAUDE.md règle 6) — l'IA ne reformule /
  résume / traduit / complète jamais. Précédent réutilisable : le **« bloc figure »** de la
  passe vision PDF, seule dérogation existante, autorisée **parce qu'elle est signalée comme
  « description machine, non-verbatim »** (`docs/wiki-spec.md` §2.3 bis,
  `prompts/vision-figure-prompt.md`, spec `tasks/specs/2026-09-01-ingestion-vision-pdf.md`).

**Ce qu'on construit** — trois briques :
1. **Affichage** : un composant `<Markdown>` factorisé, doté de la coloration du code
   (rehype-highlight / highlight.js) et du rendu des maths (remark-math + rehype-katex),
   utilisé par les pages ET le chat.
2. **Ingestion** : apprendre à l'IA à encadrer le code (```` ```langage ````, pur verbatim)
   et à transcrire les maths en LaTeX `$$…$$` marqué « reconstruit » (bloc formule calqué
   sur le bloc figure).
3. **Révision IA des formules** : un panneau où Arthur voit chaque formule **rendue** et la
   corrige **en langage naturel** (consigne en français → l'IA re-génère cette formule),
   sans jamais toucher au LaTeX à la main. Calqué sur le rattrapage vision PDF.

---

## Plan

### Vue d'ensemble des fichiers touchés

| Zone | Fichiers |
|------|----------|
| Dépendances | `web/package.json` |
| Affichage (nouveau) | `web/components/Markdown.tsx` (composant partagé, **nouveau**) |
| Affichage (refactor) | `web/components/sources/FullContentProse.tsx`, `web/components/chat/Message.tsx` |
| Affichage (CSS) | import KaTeX + thème highlight.js (dans `Markdown.tsx`) ; éventuel ajustement `web/app/globals.css` |
| Ingestion (prompt/doctrine) | `prompts/ingest-prompt.md`, `CLAUDE.md` (règle 6), `docs/wiki-spec.md`, `docs/ingestion.md` |
| Révision (helper, **nouveau**) | `web/lib/formula-block.ts` (**nouveau**) + `web/lib/__tests__/formula-block.test.ts` (**nouveau**) |
| Révision (prompt, **nouveau**) | `prompts/revise-formula-prompt.md` (**nouveau**) |
| Révision (route, **nouveau**) | `web/app/api/resource/[slug]/revise-formulas/route.ts` (**nouveau**) |
| Révision (UI, **nouveau**) | `web/components/sources/ReviseFormulas.tsx` (**nouveau**) + intégration dans `web/app/sources/[id]/page.tsx` |

---

### BRIQUE 1 — Affichage (les 3 surfaces d'un coup)

#### 1.1 Dépendances (`web/package.json`)

Ajouter (versions compatibles react-markdown v10 / unified 11) :

```jsonc
"katex": "^0.16.11",
"rehype-katex": "^7.0.1",
"remark-math": "^6.0.0",
"rehype-highlight": "^7.0.1",
"highlight.js": "^11.10.0"
```

Installer avec `npm --prefix web install`. `highlight.js` fournit les **thèmes CSS** (dossier
`highlight.js/styles/*.css`) ET est la dépendance de `rehype-highlight`.

#### 1.2 Composant partagé `web/components/Markdown.tsx` (NOUVEAU)

C'est le **seul** point où l'on branche les plugins. Il porte **les deux maps de composants
Tailwind existantes** (déplacées telles quelles depuis `FullContentProse.tsx` et
`Message.tsx`, sans changer les valeurs → zéro régression typographique), choisies par une
prop `variant`.

Contrat :

```tsx
'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css'; // thème clair (l'app est mono-thème clair)

// PROSE_COMPONENTS = la map actuelle de FullContentProse (text-[15px], text-gray-800/900…)
// CHAT_COMPONENTS  = la map actuelle MARKDOWN_COMPONENTS de Message (text-base/sm compacts)
// → copiées VERBATIM depuis les fichiers d'origine, à l'exception des renderers `code`/`pre`
//   redéfinis ci-dessous pour préserver la coloration.

export default function Markdown({
  content,
  variant,
}: {
  content: string;
  variant: 'prose' | 'chat';
}) {
  const components = variant === 'prose' ? PROSE_COMPONENTS : CHAT_COMPONENTS;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}
```

**Point critique — renderers `code` / `pre` (sinon la coloration ne s'affiche pas).**
`rehype-highlight` pose sur le `<code>` d'un bloc fencé la classe `hljs language-xxx` et
tokenise le contenu en `<span>`. Les overrides actuels de `code` **écrasent** cette
`className` (ils ne rendent que `<code className="bg-gray-100…">{children}</code>`) → les
couleurs seraient perdues. Dans les deux maps, redéfinir :

```tsx
code: ({ className, children }) => {
  // Bloc fencé (coloré par rehype-highlight) → on FORWARD la className `hljs language-*`
  // pour que le thème CSS s'applique ; le cadre est porté par `pre` (voir ci-dessous).
  if (className && /\bhljs\b|\blanguage-/.test(className)) {
    return <code className={className}>{children}</code>;
  }
  // Code INLINE → pastille (style actuel conservé, valeurs selon variant).
  return (
    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800">
      {children}
    </code>
  );
},
pre: ({ children }) => (
  // Cadre « éditeur » : arrondi, padding, scroll horizontal. Le fond/texte des tokens
  // vient du thème highlight.js (.hljs) ; garder un fond cohérent (voir globals.css §1.4).
  <pre className="mb-4 overflow-x-auto rounded-lg p-4 text-sm last:mb-0">
    {children}
  </pre>
),
```

(Valeurs Tailwind `mb`/`text`/`p` à reprendre de chaque variant — prose = `mb-4 p-4 text-sm`,
chat = `mb-2 p-3 text-xs` — l'essentiel est le forward de `className` sur `code` et le
retrait des `bg-gray-900/800` en dur qui masqueraient le thème.)

**Ordre des plugins** : `remark-math` doit précéder dans `remarkPlugins` (il parse `$$` en
nœuds math mdast) ; `rehype-katex` les rend en hast. `rehype-highlight` agit sur les nœuds
`code` (indépendant). L'ordre ci-dessus est correct.

#### 1.3 Refactor des deux consommateurs

- `web/components/sources/FullContentProse.tsx` : remplacer le `<ReactMarkdown …>` inline
  par `<Markdown variant="prose" content={content} />`. Déplacer sa map de composants dans
  `Markdown.tsx` (PROSE_COMPONENTS).
- `web/components/chat/Message.tsx` :
  - `CommittedMarkdown` (L79-85) → rendre via `<Markdown variant="chat" content={text} />`.
  - Rendu figé (L142-146) → `<Markdown variant="chat" content={message.content} />`.
  - `MARKDOWN_COMPONENTS` (L15-74) → déplacé dans `Markdown.tsx` (CHAT_COMPONENTS).
  - **Ne pas toucher** `ActiveText` (L97-117) : le bloc en cours reste en texte brut
    (`whitespace-pre-wrap`). Conséquence acceptée : pendant le streaming, un `$$…$$` non
    encore refermé reste brut jusqu'à sa fermeture (comme les fences de code, déjà gérées
    par `splitStreamingMarkdown`), puis passe en « committed » et se rend en KaTeX.
  - **Ne pas toucher** le message UTILISATEUR (`isUser`, L131-132) : reste texte brut.

#### 1.4 CSS (fond du cadre code, cohérence)

Le thème `github.css` colore les tokens et pose un fond clair sur `.hljs`. Vérifier
visuellement le rendu ; si le cadre manque de contraste, ajouter dans `web/app/globals.css`
un léger ajustement (ex. `.hljs { @apply rounded-lg; background: #f6f8fa; }`) — facultatif,
à décider sur rendu réel. **Pas de mode sombre à gérer** (app mono-thème clair).

#### 1.5 Protection des prix (fausse détection maths) — À VÉRIFIER PAR TEST

Le corpus contient des prix en dollars (ex. `$6,64`, `$0,117`). Avec le simple `$` activé,
`remark-math` les prendrait pour des maths. **Mitigation retenue** : passer
`{ singleDollarTextMath: false }` à `remark-math` (option transmise à
`micromark-extension-math`) → le simple `$…$` inline est **désactivé**, seul `$$…$$`
(display) est interprété. Les prix (simple `$`) sont donc saufs, et les matrices d'Arthur
(display) fonctionnent.

**Vérification obligatoire** (ne pas se contenter d'affirmer) : rendre une page contenant
`$6,64` et `$0,117` à la suite et **constater** qu'aucun `$…$` n'est transformé en formule.
Conséquence assumée : pas de maths inline `$x$` — toute formule est en display `$$…$$` (le
prompt d'ingestion l'impose, cf. Brique 2). C'est aligné sur le cas d'usage (matrices).

---

### BRIQUE 2 — Ingestion (produire la bonne forme)

Objectif : quand une source contient du **code** ou des **maths**, l'IA d'ingestion émet la
bonne forme markdown (le corps produit passe **tel quel** au fichier `.md` — le moteur
déterministe `web/lib/wiki-project.ts` ne réécrit jamais le corps). La source brute reste
**intacte** dans `raw/` (immuable).

#### 2.1 Format canonique du « bloc formule » (à graver partout)

Une formule mathématique reconstruite est stockée sous cette forme EXACTE (display math sur
lignes propres + marqueur de reconstruction en dessous) :

```
$$
A = \begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}
\qquad
A^\top = \begin{bmatrix} 1 & 4 \\ 2 & 5 \\ 3 & 6 \end{bmatrix}
$$
*(Formule reconstruite — non-verbatim.)*
```

- Ouverture `$$` et fermeture `$$` **chacune sur sa propre ligne** ; le LaTeX entre les deux.
- Ligne immédiatement suivante = le **marqueur** littéral `*(Formule reconstruite —
  non-verbatim.)*` (em dash `—`). Ce marqueur (a) signale au lecteur que c'est une
  transcription non-verbatim (honnêteté, exigence de la règle 6) et (b) sert d'**ancre** à
  la révision (Brique 3).
- Le marqueur se rend en petit italique sous la formule (via le renderer `em`/`p`) ; il
  n'est PAS retiré à l'affichage (`stripChunkAnnotations` ne le touche pas).

#### 2.2 `prompts/ingest-prompt.md` — deux ajouts

**(a) Code = pur verbatim, mise en forme autorisée.** Dans la section « Corps de la
ressource » point 3 (« Mise en forme du texte source EXACT », L72-78), ajouter le **code** à
la liste des mises en forme autorisées, au même titre que les tableaux :

> Quand la source contient du **code** (extrait de programme, commande, configuration,
> pseudo-code affiché comme tel), encadre-le en **bloc de code markdown** ```` ```langage ````
> (choisis le langage si évident : `python`, `ts`, `bash`, `json`… sinon ```` ``` ```` nu).
> C'est de la **mise en forme, pas une reformulation** — recopie le code **mot pour mot**,
> indentation comprise ; n'en corrige ni complète rien. Le code inline court (un identifiant,
> un appel) reste en `` `inline-code` `` comme aujourd'hui.

**(b) Bloc formule (maths).** Ajouter une nouvelle section, calquée sur « Blocs figure », qui
constitue la **seconde et dernière dérogation** au strict verbatim :

> ## Blocs formule (maths) — transcris en LaTeX et signale-les
>
> Quand la source contient une **formule mathématique** — équation, matrice, vecteur, somme,
> fraction, exposant/indice — **y compris dessinée en caractères** (matrices en crochets
> Unicode `⎡ ⎣ ⎢ ⎤ ⎦`, ASCII-art, ou Unicode « cassé » issu d'un copier-coller d'une page
> web où les maths étaient rendues), **transcris-la en LaTeX** dans un **bloc formule** au
> format EXACT :
>
> ```
> $$
> {LaTeX de la formule}
> $$
> *(Formule reconstruite — non-verbatim.)*
> ```
>
> - Toujours en **display `$$…$$`** (jamais de simple `$…$` inline — il est désactivé côté
>   rendu pour ne pas confondre avec les prix en dollars).
> - Exemple — la source
>   ```
>   ⎡ 1  2  3 ⎤              ⎡ 1  4 ⎤
>   A  =  ⎣ 4  5  6 ⎦       Aᵀ  =  ⎢ 2  5 ⎥
>                                  ⎣ 3  6 ⎦
>   ```
>   devient
>   ```
>   $$
>   A = \begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}
>   \qquad
>   A^\top = \begin{bmatrix} 1 & 4 \\ 2 & 5 \\ 3 & 6 \end{bmatrix}
>   $$
>   *(Formule reconstruite — non-verbatim.)*
>   ```
> - **Trois paliers (RÈGLE ABSOLUE, comme les blocs figure)** : palier littéral — transcris
>   **exactement** les symboles, nombres, indices, exposants **présents** (mot pour mot) ;
>   palier structurel — respecte la structure lue (dimensions d'une matrice, ordre des
>   termes) ; palier sens — **INTERDIT** : n'interprète pas, ne calcule pas, ne complète pas,
>   ne « corrige » pas une formule qui te semble fausse (transcris ce qui est écrit).
> - Recopie le marqueur `*(Formule reconstruite — non-verbatim.)*` **tel quel** sous la
>   formule.

Mettre à jour la phrase des **ajouts autorisés** (L80-83) pour inclure ces deux nouveautés :
le blockquote de nav, les annotations `topics:`/`entities:`, **les blocs figure**, **les
blocs de code (mise en forme verbatim)** et **les blocs formule (transcription LaTeX
signalée)** sont les seuls ajouts structurels autorisés ; tout le reste du corps est le texte
de la source, mot pour mot.

#### 2.3 `CLAUDE.md` — règle 6

Étendre la règle 6 (verbatim) pour mentionner, à côté de l'exception « bloc figure », les
deux nouvelles mises en forme :
- **code** → bloc ```` ```langage ```` : pur verbatim (mise en forme, comme un tableau), pas
  une dérogation.
- **bloc formule** → transcription LaTeX `$$…$$` marquée `*(Formule reconstruite —
  non-verbatim.)*` : **seconde dérogation signalée** au strict verbatim (comme le bloc
  figure), autorisée **parce qu'elle est explicitement marquée** ; la source brute reste dans
  `raw/`.

#### 2.4 `docs/wiki-spec.md` et `docs/ingestion.md`

- `docs/wiki-spec.md` : ajouter un **§2.3 ter « Bloc formule (maths reconstruites) »**
  juste après le §2.3 bis (bloc figure), reprenant le format canonique (§2.1 ci-dessus), le
  marqueur, la règle des trois paliers et la mention « display `$$…$$` seulement ». Mentionner
  aussi la mise en forme du code (bloc ```` ```langage ````).
- `docs/ingestion.md` : mentionner, dans le pipeline, que la passe texte produit désormais
  blocs de code et blocs formule, et documenter l'endpoint de **révision des formules**
  (Brique 3) à côté du rattrapage vision.

**Aucune modification** de `web/lib/ingest-local.ts` / `web/lib/wiki-project.ts` : le corps
produit par l'IA transite déjà tel quel (`parseGeneration` → `projectResource` écrit le corps
verbatim). La Brique 2 est **uniquement** prompt + doctrine + docs.

---

### BRIQUE 3 — Révision IA des formules (100 % IA, aucun LaTeX à la main)

**Décision cardinale (validée) :** Arthur ne corrige PAS le LaTeX à la main. Il tape une
**consigne en langage naturel** (« la 2ᵉ ligne devrait être 4 5 6 », « il manque une
colonne », « c'est une matrice 3×2 pas 2×3 ») et l'IA re-génère **cette** formule en tenant
compte de la consigne. Un simple re-run sans consigne redonnerait la même erreur → **la
consigne est le levier central, à ne pas omettre.**

Patron calqué sur le rattrapage vision PDF (commit `d3a5d25`) : **ancre stable** + **helper
de greffe pur testé** + **endpoint POST ciblé** + **UI** + **re-projection déterministe**.

#### 3.1 Helper pur `web/lib/formula-block.ts` (NOUVEAU) — analogue de `figure-block.ts`

Ancre = l'**ordre d'apparition** (index 0-based) des blocs formule dans le corps (il n'y a
pas de page comme pour les figures). Un bloc formule est détecté par le couple `$$…$$` +
marqueur `*(Formule reconstruite — non-verbatim.)*`.

```ts
/** Marqueur canonique d'un bloc formule (identique au prompt et à la doc). */
export const FORMULA_MARKER = '*(Formule reconstruite — non-verbatim.)*';

// Un bloc formule : $$ … $$ sur lignes propres, immédiatement suivi (lignes vides tolérées)
// du marqueur. Capture le LaTeX intérieur. `g` pour itérer dans l'ordre du document.
const FORMULA_RE =
  /\$\$\n([\s\S]*?)\n\$\$\s*\n+\*\(Formule reconstruite — non-verbatim\.\)\*/g;

export interface FormulaBlock { index: number; latex: string; }

/** Liste les blocs formule (index dans l'ordre du document + LaTeX intérieur). Pure. */
export function listFormulaBlocks(md: string): FormulaBlock[] { /* itère FORMULA_RE */ }

/**
 * Remplace EN PLACE le LaTeX du bloc formule d'index `index` par `newLatex`
 * (conserve les `$$` et le marqueur). Ne touche à RIEN d'autre. Pure (testable).
 * `index` hors bornes → renvoie `md` inchangé.
 */
export function graftFormulaBlock(md: string, index: number, newLatex: string): string { /* … */ }
```

Créer les tests `web/lib/__tests__/formula-block.test.ts` (mêmes conventions que les tests
existants, lancés par `npm --prefix web test`) couvrant : listing (0, 1, N blocs), greffe du
bon index sans toucher aux autres, index hors bornes, préservation du reste du corps et du
marqueur.

#### 3.2 Prompt `prompts/revise-formula-prompt.md` (NOUVEAU)

Prompt système statique (chargé comme `prompts/vision-figure-prompt.md`). Consignes :

- Tu reçois : (1) le **LaTeX actuel** d'une formule (transcrite d'une source, possiblement
  fautive), (2) une **consigne de correction en langage naturel** rédigée par l'utilisateur,
  (3) le **texte source brut** de la ressource (pour te resituer).
- Tu produis **UNIQUEMENT le LaTeX corrigé** de cette formule — le contenu qui va **entre**
  les `$$` — **sans** les `$$`, sans marqueur, sans phrase d'introduction, sans bloc de code
  englobant. Rien d'autre.
- Applique la consigne de l'utilisateur ; pour le reste, reste **fidèle à la source**
  (transcription, pas d'invention). Display LaTeX valide KaTeX.

#### 3.3 Route `web/app/api/resource/[slug]/revise-formulas/route.ts` (NOUVEAU)

Structure calquée sur `web/app/api/resource/[slug]/revise-figures/route.ts`.

**`GET`** → `{ formulas: FormulaBlock[] }` : lit `wiki/resources/<slug>.md`
(`readRepoFile`), renvoie `listFormulaBlocks(content)`. 404 si ressource introuvable, slug
validé par `SLUG_RE = /^[a-z0-9-]+$/`.

**`POST { index: number, instruction: string }`** :
1. Valider slug + `Number.isInteger(index) && index >= 0` + `instruction` non vide.
2. `if (lockHeld()) → 409` (sérialiser vs une ingestion en cours, comme revise-figures).
3. Lire `wiki/resources/<slug>.md` ; `listFormulaBlocks` ; si `index` hors bornes → 400.
4. Lire la source brute : `source_file = parseResourceMeta(content, slug).source_file` puis
   `readRepoFile('raw/' + source_file)` (texte). Si non lisible, passer une chaîne vide (la
   consigne + le LaTeX actuel suffisent).
5. **Appel IA** (modèle **texte** d'ingestion — `getModel()` de `@/lib/claude`), non-streaming,
   pour re-générer le LaTeX. Mirroir de `visionTranscribePage` (web/lib/vision-ingest.ts) pour
   la capture de coût :

   ```ts
   const system = await readPromptFile('revise-formula-prompt.md'); // prompt statique
   const user = [
     `LaTeX actuel :\n${current.latex}`,
     `Consigne de l'utilisateur :\n${instruction}`,
     rawText ? `Texte source (contexte) :\n${rawText}` : '',
   ].filter(Boolean).join('\n\n---\n\n');

   const { data, response } = await getAnthropic().messages.create({
     model: getModel(),
     max_tokens: 4000,
     system: [{ type: 'text', text: system }],
     messages: [{ role: 'user', content: user }],
     stream: false,
   }).withResponse();

   const newLatex = data.content.filter(c => c.type === 'text').map(c => c.text).join('').trim();
   const gwRaw = response.headers.get('x-litellm-response-cost');
   const gatewayCost = gwRaw && Number.isFinite(parseFloat(gwRaw)) ? parseFloat(gwRaw) : null;
   const costUsd = gatewayCost ?? estimateCostFor(getModel(), data.usage);
   ```

   Nettoyer `newLatex` d'éventuels `$$`/fences que l'IA aurait ajoutés (strip `^\$\$` /
   `\$\$$` et un éventuel ```` ``` ```` englobant) avant greffe.
6. `md = graftFormulaBlock(content, index, newLatex)`. Si `md === content` (rien changé) →
   `{ ok: true, changed: false, costUsd }`.
7. **Re-projection déterministe** (identique à la fin de revise-figures POST, L151-158) :
   ```ts
   const today = new Date().toISOString().slice(0, 10);
   const reg = await loadRegistries();
   const { views } = await loadProjectViews(md, reg, today, [], []);
   const ops = projectResource({ slug, resourceContent: md, views, slugifyAuthor: slugify, typeLabel: wikiTypeLabel, today });
   await applyFileOps(ops);
   await applyFileOps(await rebuildDerivedIndexes(today));
   return Response.json({ ok: true, changed: true, index, costUsd: Number(costUsd.toFixed(6)) });
   ```
   Pas de « retract » : le frontmatter (topics/entités/date/type) est INCHANGÉ (on ne touche
   que le LaTeX intérieur d'un bloc déjà présent dans une section déjà annotée).
8. `export const dynamic = 'force-dynamic';`

Réutiliser les imports de revise-figures : `applyFileOps`, `readRepoFile` (`@/lib/wiki-fs`),
`parseResourceMeta` (`@/lib/wiki-mutate`), `projectResource` (`@/lib/wiki-project`),
`slugify` (`@/lib/wiki-parser`), `typeLabel` (`@/lib/ui`), `loadRegistries`,
`loadProjectViews`, `rebuildDerivedIndexes`, `estimateCostFor`, `lockHeld`
(`@/lib/ingest-local`), `getAnthropic`, `getModel` (`@/lib/claude`). Pour lire le fichier
prompt, réutiliser le même mécanisme que la passe vision (chemin `prompts/…` résolu côté
serveur — voir comment `vision-ingest.ts` charge `vision-figure-prompt.md`).

#### 3.4 UI `web/components/sources/ReviseFormulas.tsx` (NOUVEAU)

Client component calqué sur `ReviseFigures.tsx`. Comportement :
- `endpoint = /api/resource/<slug>/revise-formulas`.
- Au montage, `GET` → `formulas: { index, latex }[]`. **Si la liste est vide, le composant ne
  rend RIEN** (pas de panneau parasite sur les ressources sans formule).
- Sinon, un panneau **« Réviser les formules »** listant chaque formule :
  - **Aperçu rendu** de la formule : réutiliser `<Markdown variant="prose" content={`$$\n${latex}\n$$`} />`
    (rendu KaTeX identique à la page).
  - Un `<input>`/`<textarea>` « Décris la correction… » (consigne en langage naturel).
  - Un bouton **« Re-générer »** → `POST { index, instruction }`.
  - Sur succès : afficher le coût (`~$${costUsd.toFixed(3)}` comme ReviseFigures), vider le
    champ, recharger la liste (`GET`) et `router.refresh()` (recharge la page ressource →
    nouvelle formule rendue). Sur erreur : message d'erreur.
  - Désactiver le bouton pendant l'appel (`busy`, `Loader2` spinner) et si consigne vide.
- Reprendre les classes Tailwind / le style d'états (bandeau ok=emerald, err=amber) de
  `ReviseFigures.tsx` pour la cohérence visuelle.

#### 3.5 Intégration dans `web/app/sources/[id]/page.tsx`

Rendre `<ReviseFormulas slug={source.slug} />` sur la page détail :
- **Branche article/texte** (non-PDF, L117-127) : insérer le panneau **au-dessus** de
  `<FullContentProse … />` (dans `<article>`), après `Meta`/titre. C'est le cas principal
  (matrices collées via `.txt`).
- **Branche PDF** (L97-116) : insérer dans la **colonne droite** (`w-[40%]`), au-dessus de
  `<FullContentProse … />`. (Les formules issues d'un PDF passent par la passe vision/figure
  — hors périmètre ici — donc le panneau y sera le plus souvent vide et invisible.)

Le composant s'auto-masque si aucune formule → aucune régression sur les ressources sans
maths.

**Le chat bénéficie automatiquement** de la Brique 1 : quand l'assistant cite une ressource
contenant `$$…$$` ou un bloc de code, `Message.tsx` (via `<Markdown variant="chat">`) les
rend colorés / en KaTeX. Aucun changement backend de chat nécessaire.

---

## Décisions

1. **Levier retenu = Affichage + Ingestion + Révision** (les trois couches).
   - *Écarté « Affichage seulement »* : ne rend PAS le cas d'usage d'Arthur — la matrice
     collée arrive en dessin de caractères, pas en LaTeX ; sans transcription à l'ingestion
     elle reste cassée, et rien ne garantit la bonne forme sur les futurs dépôts.
   - *Écarté « + rattrapage des ressources déjà cassées »* : Arthur a choisi « Aucune pour
     l'instant » (cf. Hors périmètre).

2. **Doctrine maths = reconstruction LaTeX marquée « reconstruit »** (transcription fidèle,
   patron du bloc figure).
   - *Écarté « strict : n'embellir que le LaTeX déjà propre à la source »* : ne marcherait pas
     sur la matrice collée d'Arthur (elle n'est pas en LaTeX).
   - *Risque assumé* : erreur de transcription rare sur formule complexe → mitigé par le
     marqueur « reconstruit », la révision (Brique 3) et la source brute conservée dans `raw/`.

3. **Révision = 100 % IA avec consigne en langage naturel.**
   - *Écarté « édition manuelle du LaTeX + aperçu »* : Arthur refuse explicitement de corriger
     à la main.
   - *Écarté « re-run IA sans consigne » (comme le rattrapage PDF)* : sur un texte identique,
     re-générerait la même erreur — la consigne en français est indispensable au levier.

4. **Highlighter = `rehype-highlight` (highlight.js).**
   - *Écarté Shiki* : plus beau mais lourd/asynchrone, complexité inutile pour un usage bureau
     local ; highlight.js = auto-détection du langage, couverture large, un fichier de thème
     CSS, intégration triviale avec react-markdown.

5. **Prix protégés d'une fausse détection maths** via `remark-math { singleDollarTextMath:
   false }` (simple `$` désactivé, seul `$$…$$` display interprété). Conséquence : pas de
   maths inline `$x$` ; toute formule est en display (aligné sur le cas matrices). **À
   VÉRIFIER par test** sur les prix réels du corpus (`$6,64`, `$0,117`).

6. **Messages utilisateur du chat : restent texte brut** (inchangés). Seules les réponses de
   l'assistant sont mises en forme.

7. **Ancre de révision = index d'apparition du bloc formule** (pas de page comme les
   figures) ; détection par le couple `$$…$$` + marqueur. *Écarté* : identifiant embarqué
   `<!-- f:id -->` (pollue le markdown verbatim) et match par texte exact (ambigu si deux
   formules identiques). L'index est simple, re-calculé à chaque `GET`.

8. **Le corps de la ressource n'est jamais réécrit par le moteur déterministe** : la Brique 2
   est purement prompt + doctrine, aucune touche à `ingest-local.ts` / `wiki-project.ts`.

---

## Hors périmètre

- **Ré-ingestion / rattrapage des ressources déjà cassées** : la « transposée »
  (`wiki/resources/le-t-ou-parfois-ecrit-t-veut-dire-transposee.md`, Unicode cassé) et FinOps
  (`wiki/resources/traditional-finops-breaks-ai-workloads.md`, code aplati). On ne traite que
  les futurs dépôts. (On pourra les ré-ingérer manuellement plus tard.)
- **Révision du code** : formules uniquement. Le code est du pur verbatim (fiable) ; la même
  mécanique (helper + route + UI) pourra être réutilisée plus tard pour le code si besoin.
- **Édition manuelle du LaTeX / du code à la main** (Arthur a refusé).
- **Mode sombre / theming** (app mono-thème clair).
- **Rendu markdown des messages utilisateur du chat** (restent texte brut).
- **Formules issues de figures PDF** (elles passent par la passe vision / bloc figure) et
  **maths inline `$x$`** (désactivées pour protéger les prix).
- **Exposition du choix de modèle vision dans `/reglages`** (déjà hors périmètre côté vision).

---

## Todo

### Brique 1 — Affichage

- [x] **Installer les dépendances** : ajouter `katex`, `rehype-katex`, `remark-math`,
      `rehype-highlight`, `highlight.js` à `web/package.json` puis `npm --prefix web install`.
      *Vérif :* `npm --prefix web ls remark-math rehype-katex katex rehype-highlight highlight.js`
      les liste sans erreur ; `npm --prefix web run build` compile.
- [x] **Créer `web/components/Markdown.tsx`** : composant partagé `variant: 'prose' | 'chat'`,
      plugins `remark-gfm` + `remark-math {singleDollarTextMath:false}` + `rehype-katex` +
      `rehype-highlight`, imports CSS KaTeX + `highlight.js/styles/github.css`, les deux maps
      PROSE/CHAT (déplacées verbatim), renderers `code`/`pre` corrigés (forward de
      `className` `hljs language-*` sur `code`, cadre sur `pre`).
      *Vérif :* `npm --prefix web run build` compile ; typecheck OK.
- [x] **Refactorer `FullContentProse.tsx`** pour rendre via `<Markdown variant="prose">`
      (map prose déplacée dans `Markdown.tsx`).
      *Vérif :* une page ressource existante (texte) s'affiche **identique** à avant (aucune
      régression typographique) — comparer visuellement avec `main`.
- [x] **Refactorer `Message.tsx`** : `CommittedMarkdown` et le rendu figé passent par
      `<Markdown variant="chat">` ; `MARKDOWN_COMPONENTS` déplacé ; `ActiveText` et le message
      utilisateur **inchangés**.
      *Vérif :* dans le chat (`npm --prefix web run dev`), une réponse assistant existante
      s'affiche identique ; un message utilisateur reste en texte brut.
- [x] **Prouver le rendu maths + code à l'affichage** (avant même l'ingestion) : créer à la
      main une ressource de test dans `wiki/resources/` contenant un bloc ```` ```python ````
      et un bloc `$$ \begin{bmatrix}…\end{bmatrix} $$` + marqueur, ouvrir `/sources/<slug>`.
      *Vérif :* le code s'affiche **coloré** dans un cadre ; la matrice s'affiche en **rendu
      KaTeX** (crochets, exposant `\top`). Poser la même ressource dans une question de chat →
      même rendu dans la bulle assistant. **Supprimer** la ressource de test ensuite.
- [x] **Prouver la protection des prix** : rendre un contenu avec `$6,64` et `$0,117`.
      *Vérif :* aucun `$…$` n'est transformé en formule (les dollars restent du texte).

### Brique 2 — Ingestion

- [x] **`prompts/ingest-prompt.md`** : ajouter (a) le code aux mises en forme autorisées
      (point 3) et (b) la section « Blocs formule (maths) » avec format exact, exemple matrice
      d'Arthur et les trois paliers ; mettre à jour la phrase des « ajouts autorisés ».
      *Vérif :* relecture — cohérence avec le format canonique §2.1 (marqueur identique au
      caractère près).
- [x] **`CLAUDE.md` (règle 6)** : mentionner code (pur verbatim) + bloc formule (2ᵉ dérogation
      signalée). **`docs/wiki-spec.md`** : ajouter §2.3 ter « Bloc formule ». **`docs/ingestion.md`** :
      pipeline (blocs code/formule) + endpoint de révision.
      *Vérif :* les 4 fichiers décrivent le **même** format/marqueur, sans contradiction.
- [x] **Prouver l'ingestion de la matrice d'Arthur (bout en bout)** : via `/upload` (onglet
      « Coller le contenu »), coller le texte de la matrice ASCII-art de la capture, laisser
      l'ingestion tourner (`npm --prefix web run dev`).
      *Vérif :* `wiki/resources/<slug>.md` contient un bloc `$$…\begin{bmatrix}…$$` + le
      marqueur ; la page `/sources/<slug>` l'affiche en **rendu KaTeX propre** (comme la
      capture). La source brute `raw/<fichier>.txt` est **intacte** (Unicode d'origine).
- [x] **Prouver l'ingestion du code** : déposer un texte/document contenant un extrait de code.
      *Vérif :* la ressource contient un bloc ```` ```langage ```` (code recopié mot pour mot) ;
      `/sources/<slug>` l'affiche **coloré** ; poser une question de chat sur cette ressource →
      code coloré dans la bulle assistant.

### Brique 3 — Révision IA des formules

- [x] **`web/lib/formula-block.ts`** : `FORMULA_MARKER`, `listFormulaBlocks`,
      `graftFormulaBlock`. **`web/lib/__tests__/formula-block.test.ts`** : listing (0/1/N),
      greffe du bon index, hors bornes, non-régression du reste + marqueur.
      *Vérif :* `npm --prefix web test` — tous les tests `formula-block` passent.
- [x] **`prompts/revise-formula-prompt.md`** : prompt système « produis UNIQUEMENT le LaTeX
      corrigé » (entre-`$$`, sans marqueur), applique la consigne, reste fidèle à la source.
      *Vérif :* relecture ; cohérence avec le nettoyage `$$`/fences côté route.
- [x] **`web/app/api/resource/[slug]/revise-formulas/route.ts`** : `GET` (liste) + `POST`
      (`{index, instruction}` → appel IA `getModel()` → nettoyage → `graftFormulaBlock` →
      re-projection déterministe + coût). `lockHeld()` → 409. Pas de retract.
      *Vérif :* `curl` local — `GET /api/resource/<slug>/revise-formulas` renvoie la liste des
      formules ; `POST` avec une consigne renvoie `{ ok, changed:true, costUsd }` et
      `wiki/resources/<slug>.md` voit **uniquement** le LaTeX ciblé changer (diff minimal).
- [x] **`web/components/sources/ReviseFormulas.tsx`** + intégration dans
      `web/app/sources/[id]/page.tsx` (au-dessus de `FullContentProse`, branches texte ET
      PDF ; auto-masqué si aucune formule).
      *Vérif :* sur une ressource sans formule, **aucun** panneau. Sur la ressource-matrice,
      le panneau liste la formule avec aperçu KaTeX.
- [x] **Prouver la révision de bout en bout** : sur la ressource-matrice, provoquer/observer une
      formule (au besoin en dégradant volontairement le LaTeX dans le `.md`), ouvrir « Réviser
      les formules », taper une consigne en français (ex. « la 2ᵉ ligne devrait être 4 5 6 »),
      cliquer « Re-générer ».
      *Vérif :* l'aperçu et la page ressource affichent la formule **corrigée** après
      `router.refresh()` ; le reste de la ressource est **intact** (greffe chirurgicale — diff
      limité au bloc) ; un coût `~$…` s'affiche.

### Clôture

- [x] **Suite de tests** : `npm --prefix web test` passe en entier (248 tests, dont les 7
      nouveaux `formula-block` + les existants).
- [~] **Build** : le code de CETTE feature compile (`next build` → « ✓ Compiled
      successfully ») et `tsc --noEmit` = 0 erreur. MAIS le `next build` **complet** échoue à
      l'étape « Collecting page data » sur `/api/ingest`, à cause d'un souci **pré-existant**
      (identique sur `main`, indépendant de ce chantier) : la minification, sous **Node 26**,
      d'un template literal de `web/lib/vision-ingest.ts` contenant des backticks ```` ``` ````
      (chunk `5510.js`, `${i}`). Vérifié : `git diff main -- web/lib/vision-ingest.ts` est vide
      et aucune route d'ingestion n'importe le code de cette feature. Hors périmètre ; à
      corriger séparément (ou build en CI avec un Node stable). Cf. Bilan.
- [x] **Lessons** : aucune correction d'Arthur pendant l'implémentation (session autonome) →
      rien à ajouter à `tasks/lessons.md` (réservé aux corrections). Le point build est consigné
      au Bilan.

---

## Bilan

**Livré, conforme au plan, sur les trois briques.**

### Ce qui a été fait
- **Brique 1 — Affichage.** 5 dépendances ajoutées (`katex`, `rehype-katex`, `remark-math`,
  `rehype-highlight`, `highlight.js`). Composant partagé `web/components/Markdown.tsx`
  (variants `prose`/`chat`, plugins branchés une seule fois, renderers `code`/`pre` corrigés
  pour forwarder la classe `hljs language-*`). `FullContentProse` et `Message` refactorés
  pour l'utiliser (maps typographiques déplacées verbatim → zéro régression). `ActiveText`
  et le message utilisateur inchangés. Ajustement `globals.css` : neutralisation du
  fond/padding internes de `.hljs` pour un cadre unique porté par `<pre>`.
- **Brique 2 — Ingestion.** `prompts/ingest-prompt.md` : code = mise en forme verbatim
  autorisée + nouvelle section « Blocs formule (maths) » (format exact, exemple matrice
  d'Arthur, trois paliers) + phrase des ajouts autorisés. Doctrine alignée : `CLAUDE.md`
  règle 6, `docs/wiki-spec.md` §2.3 ter, `docs/ingestion.md` (pipeline + endpoint de
  révision). Marqueur `*(Formule reconstruite — non-verbatim.)*` identique au caractère
  près (em dash) dans les 4 fichiers. **Aucune** touche à `ingest-local.ts`/`wiki-project.ts`.
- **Brique 3 — Révision.** Helper pur `web/lib/formula-block.ts` (`listFormulaBlocks`,
  `graftFormulaBlock`, ancre = index d'apparition) + 7 tests. Prompt statique
  `prompts/revise-formula-prompt.md`. Route `web/app/api/resource/[slug]/revise-formulas/route.ts`
  (`GET` liste, `POST {index,instruction}` → IA `getModel()` → nettoyage → greffe → re-projection ;
  `lockHeld()` → 409 ; pas de retract). UI `web/components/sources/ReviseFormulas.tsx`
  (aperçu KaTeX, consigne en français, auto-masqué si aucune formule) intégrée aux deux
  branches (texte + PDF) de `web/app/sources/[id]/page.tsx`.

### Preuves (démontrées, pas affirmées)
- **Affichage (déterministe)** : le pipeline de plugins exact rend la matrice en KaTeX,
  le code Python coloré (`hljs language-python` + tokens), et **ne transforme PAS** les prix
  `$6,64`/`$0,117` (single-dollar désactivé) ; `resourceBodyForDisplay` préserve `$$`/code/marqueur.
- **Affichage (rendu Next réel)** : pages servies par un `next dev` isolé → page matrice
  contient `class="katex"` + `katex-mathml`/`katex-html` + CSS KaTeX ; page code contient
  `code.hljs language-python` + spans de tokens.
- **Ingestion (vrai appel IA, copie isolée)** : la matrice Unicode d'Arthur ressort en
  `$$…\begin{bmatrix}…$$` + marqueur (exactement le format canonique), le code en ```` ```python ```` ;
  `raw/` intact. Coût réel **$0,031** (2 sources).
- **Révision (vrai appel IA, copie isolée)** : dégradation `9&9&9` → consigne FR → correction
  `4&5&6`, 2ᵉ matrice + reste du corps **octet pour octet identiques** (greffe chirurgicale),
  `lockHeld → 409`. Coût **$0,0048**.
- **UI révision (vrai navigateur, CDP)** : panneau « Réviser les formules » présent + aperçu
  KaTeX sur la fiche matrice, **absent** sur une fiche sans formule.
- **Régression** : `tsc --noEmit` = 0 ; suite complète **248 tests** verts.

Toutes les preuves à coût/serveur ont tourné sur des **copies isolées** (`DATA_ROOT`/`WIKI_ROOT`/`RAW_ROOT`
scratch + clé copiée) : le **vrai wiki n'a jamais été touché** (confirmé : aucune ressource de
test dans `wiki/resources/`). Les serveurs dev des autres sessions (ports 3000/3001) sont restés
intacts.

### Écarts au plan
1. **Preuves via copies isolées + handlers directs + CDP**, et non via l'UI `/upload` en direct
   (le plan suggérait `/upload`). Raison : plusieurs sessions Claude tournaient en parallèle sur
   le `.next` partagé (leçons 2026-07-21/22) et le vrai chemin `/upload` écrit dans le vrai wiki +
   coûte de l'argent. L'isolation prouve le comportement sans effet de bord — patron déjà éprouvé
   (leçon vision 2026-09-01). Résultat identique à ce que le plan voulait démontrer.
2. **`next build` complet non abouti — souci PRÉ-EXISTANT hors périmètre.** Le code de cette
   feature compile (« ✓ Compiled successfully ») et passe `tsc`. Mais le build complet échoue à
   « Collecting page data » sur `/api/ingest`, par minification (Node 26) d'un template literal à
   backticks dans `web/lib/vision-ingest.ts` (chunk `5510.js`). `git diff main` sur ce fichier est
   vide et aucune route d'ingestion n'importe le code de ce chantier → **présent sur `main`, non
   introduit ici**. À traiter séparément (ou build CI sous Node stable). **À signaler à Arthur.**
3. **CSS `.hljs` neutralisé dans `globals.css`** (fond/padding) : non explicitement prévu mais
   nécessaire (github.css pose un fond blanc + padding 1em qui créaient un double-cadrage). §1.4
   du plan l'anticipait comme ajustement « à décider sur rendu réel ».

### Reste (hors périmètre, connu)
- Ressources déjà cassées non ré-ingérées (transposée Unicode, FinOps code aplati) — choix d'Arthur.
- Révision du code (formules seulement) ; édition manuelle du LaTeX ; mode sombre ; formules issues
  de figures PDF ; maths inline `$x$`.

---

*Fichier de spec : `tasks/specs/2026-09-02-rendu-code-et-formules-maths.md`.*
*Implémentation dans une session neuve : `/implement @tasks/specs/2026-09-02-rendu-code-et-formules-maths.md`*
