# Alias visibles sur la page d'un thème — refonte du miroir entité/thème

## Contexte

**Demande d'origine (Arthur) :** « Dans la page thème, quand il y a des alias
on ne les voit pas dans la page du thème en question (je veux que ce soit comme
pour les entités). Il y a ce problème pour le thème *Évaluation des agents de
code*. J'ai envie que ce problème ne se produise plus jamais à l'avenir. »

**Problème.** La page de détail d'un thème (`web/app/wiki/[slug]/page.tsx`)
n'affiche jamais les alias, alors que la page de détail d'une entité
(`web/app/entities/[slug]/page.tsx`) les affiche. Dans ce projet, entités et
thèmes sont conçus comme des **jumeaux** (« miroir » : le code dit lui-même
« Miroir de listEntities() », « Miroir de EntitiesView »). Le miroir est
maintenu **à la main, par copier-coller** ; il est cassé à trois endroits, dont
deux produisent directement le bug, le troisième étant la cause structurelle
qui le laisse se reproduire.

**Audit — état du miroir entité / thème :**

| Point de miroir | Entité | Thème | Statut |
|---|---|---|---|
| Fonction registre (liste) | `listEntities()` | `listThemes()` | ✅ intact (les deux incluent `aliases`) |
| Vue liste | `EntitiesView` | `ThemesView` | ✅ intact (les deux affichent « N alias ») |
| **Accesseur détail typé** | `getEntity(slug)` | **absent** | ❌ **cassé** |
| **Création de page par le moteur** | `createEntityPage()` (émet `aliases`) | `createThemePage()` (n'émet pas `aliases`) | ❌ **cassé** |
| **Page détail (rendu)** | affiche les alias | ne les affiche pas | ❌ **cassé** |

**Chaîne causale précise :**

1. **Rendu.** `web/app/wiki/[slug]/page.tsx` parse le frontmatter du fichier
   thème avec `matter(raw)` → `data`, mais **ne lit que `data.label`** (ligne
   22) et ne référence jamais `data.aliases`. La donnée est disponible, jamais
   affichée. À comparer avec `web/app/entities/[slug]/page.tsx:43-47` qui rend
   `entity.aliases.join(', ')`.

2. **Absence d'accesseur typé.** `web/lib/wiki-parser.ts` fournit
   `getEntity(slug)` (retourne un `EntityEntry` typé avec `aliases`) mais **pas**
   de `getTheme(slug)`. La page thème bricole donc son propre parsing inline et
   « oublie » tout champ non recopié à la main. C'est le maillon structurel
   manquant.

3. **Moteur de projection.** Il existe **deux** chemins de création d'un fichier
   thème, qui divergent :
   - `applyThemeDecision` (arbitrage d'un candidat,
     `web/lib/wiki-mutate.ts:687-698`) : **écrit** `aliases`.
   - `createThemePage` (projection à l'ingestion quand un topic est vu sans page
     existante, `web/lib/wiki-project.ts:322-327`) : **n'écrit pas** `aliases`.

   D'où le fait observé : `wiki/themes/evaluation-des-agents.md` (né d'un
   arbitrage) a `aliases:`, tandis que `wiki/themes/machine-learning.md` (né de
   la projection) n'en a aucun. À comparer avec `createEntityPage`
   (`web/lib/wiki-project.ts:329-335`) qui écrit toujours `aliases`.

**Nuance de données importante (calibre la démonstration).** Le **seul** thème
du wiki portant actuellement un `aliases:` non vide est
`wiki/themes/evaluation-des-agents.md`, et son alias est **identique à son
label** :
```
label: "Évaluation des agents de code"
aliases: ["Évaluation des agents de code"]
```
Après le filtrage « masquer les alias égaux au label » (décidé ci-dessous), sa
page n'affichera **rien** — comportement correct (l'alias est du bruit), mais
cela signifie que ce thème précis ne peut pas servir de preuve visuelle. La
démonstration doit se faire avec un alias **distinct** du label (voir Todo).

**Décision de périmètre (validée par Arthur) : refonte structurelle**, pas un
simple patch d'affichage. Objectif explicite : « que ce problème ne se produise
plus jamais ». On traite donc la cause (miroir maintenu à la main → un champ
peut être oublié) et pas seulement le symptôme.

---

## Plan

Quatre changements. Le cœur « ne plus jamais » = les items 1 et 2 (accesseur
typé + composant d'affichage partagé). L'item 3 est une consistance de forme du
moteur (faible enjeu — voir Décisions). L'item 4 est la finition UX.

### 1. `getTheme(slug)` — accesseur détail typé (miroir de `getEntity`)

Fichier : `web/lib/wiki-parser.ts`.

`getEntity` existe déjà (lignes 306-326) :
```ts
export interface EntityDetail {
  entity: EntityEntry;
  body: string; // corps markdown (## Mentions) sans le frontmatter
}

export async function getEntity(slug: string): Promise<EntityDetail | null> {
  const content = await readWikiFile(`${ENTITIES}/${slug}.md`);
  if (!content.trim()) return null;
  const { data, content: body } = matter(content);
  const s = cleanStr(data.slug) ?? slug;
  return {
    entity: {
      slug: s,
      label: cleanStr(data.label) ?? s,
      entity_type: cleanStr(data.entity_type) ?? 'entity',
      aliases: arr(data.aliases),
    },
    body,
  };
}
```

Ajouter son miroir juste après (le type `ThemeEntry` est déjà importé de
`@/types` en haut du fichier, ligne 12 ; la constante `THEMES = 'themes'` existe
déjà ligne 28 ; `cleanStr` et `arr` sont déjà définis dans le fichier) :
```ts
export interface ThemeDetail {
  theme: ThemeEntry;
  body: string; // corps markdown (blocs ## par ressource) sans le frontmatter
}

/** Un thème du registre par slug (frontmatter + corps), ou null. Miroir de getEntity(). */
export async function getTheme(slug: string): Promise<ThemeDetail | null> {
  const content = await readWikiFile(`${THEMES}/${slug}.md`);
  if (!content.trim()) return null;
  const { data, content: body } = matter(content);
  const s = cleanStr(data.slug) ?? slug;
  return {
    theme: {
      slug: s,
      label: cleanStr(data.label) ?? s,
      aliases: arr(data.aliases),
    },
    body,
  };
}
```

`ThemeEntry` (défini dans `web/types/index.ts:198-202`) = `{ slug: string;
label: string; aliases: string[] }`. Pas de champ `entity_type` (c'est la seule
différence avec `EntityEntry`).

### 2. `<AliasLine>` — composant d'affichage partagé (source unique de vérité)

**Pourquoi un composant plutôt qu'unifier les deux pages entières :** les deux
pages de détail ont des mises en page différentes (l'entité affiche un badge de
type + alias au-dessus du titre ; le thème affiche le titre puis un compteur de
ressources et une section Sources). Unifier tout le header changerait la
disposition visuelle du thème — hors sujet. On partage donc **uniquement** le
fragment qui rend les alias, avec la logique de dédoublonnage intégrée : ainsi,
la règle d'affichage des alias vit à **un seul endroit** et ne peut plus être
oubliée d'un côté.

Nouveau fichier : `web/components/wiki/AliasLine.tsx`.
```tsx
/**
 * Affiche la ligne « alias : … » d'une entité ou d'un thème — source unique de
 * vérité partagée entre les deux pages de détail. Filtre les alias égaux au
 * label (comparaison insensible à la casse / espaces) : un alias identique au
 * titre est du bruit. Ne rend rien s'il ne reste aucun alias distinct.
 */
export default function AliasLine({
  label,
  aliases,
}: {
  label: string;
  aliases: string[];
}) {
  const norm = (s: string) => s.trim().toLowerCase();
  const extra = aliases.filter((a) => a.trim() && norm(a) !== norm(label));
  if (extra.length === 0) return null;
  return <span className="text-xs text-gray-500">alias : {extra.join(', ')}</span>;
}
```

**Brancher la page entité** (`web/app/entities/[slug]/page.tsx`) : remplacer le
bloc conditionnel actuel des lignes 43-47…
```tsx
{entity.aliases.length > 0 && (
  <span className="text-gray-500">
    alias : {entity.aliases.join(', ')}
  </span>
)}
```
…par :
```tsx
<AliasLine label={entity.label} aliases={entity.aliases} />
```
Conserver le badge `entityTypeLabel` (lignes 40-42) inchangé. Ajouter l'import
`import AliasLine from '@/components/wiki/AliasLine';`.

Effet de bord **voulu** : l'entité `swe-bench` (label = alias = « SWE-bench ») et
`chatgpt` (label = alias = « ChatGPT ») cesseront d'afficher une ligne alias
redondante. `claude-code` (label « Claude Code », aliases `["claude code",
"claude-code", "claude code cli"]`) affichera « alias : claude-code, claude code
cli » (« claude code » est masqué car égal au label à la casse près).

### 3. `createThemePage` — émettre `aliases: []` (consistance de forme du moteur)

Fichier : `web/lib/wiki-project.ts`, fonction `createThemePage` (lignes 322-327).

Actuel :
```ts
function createThemePage(slug: string, label: string, block: string, today: string): string {
  return (
    `---\ntype: theme\nslug: ${slug}\nlabel: ${JSON.stringify(label)}\n` +
    `resource_count: 1\nlast_updated: ${JSON.stringify(today)}\n---\n\n${block}\n`
  );
}
```

Cible — insérer la ligne `aliases: []` (mirroir de `createEntityPage` qui écrit
toujours `aliases`) :
```ts
function createThemePage(slug: string, label: string, block: string, today: string): string {
  return (
    `---\ntype: theme\nslug: ${slug}\nlabel: ${JSON.stringify(label)}\naliases: []\n` +
    `resource_count: 1\nlast_updated: ${JSON.stringify(today)}\n---\n\n${block}\n`
  );
}
```

Valeur toujours `[]` : le sidecar de thème (`ResolvedTheme`,
`web/lib/ingest-local.ts:257-262`) ne porte **pas** de champ `aliases` — il n'y
a aucune source d'alias à l'ingestion pour un thème. Les alias d'un thème
proviennent exclusivement de l'arbitrage d'un candidat (`applyThemeDecision`),
inchangé. Ne PAS ajouter de champ `aliases` à `ResolvedTheme` (hors périmètre,
voir Décisions).

Le chemin de **mise à jour** d'un thème existant (`web/lib/wiki-project.ts:378-384`)
préserve déjà le frontmatter existant (`splitFrontmatter` + `setScalar` ciblés
sur `resource_count`/`last_updated`) : il ne clobber pas `aliases`. Aucun
changement requis de ce côté.

### 4. Brancher la page thème sur `getTheme` + `<AliasLine>`

Fichier : `web/app/wiki/[slug]/page.tsx`.

État actuel (extrait) :
```tsx
const raw = await readWikiFile(`themes/${params.slug}.md`);
if (!raw.trim()) notFound();
const { data, content: body } = matter(raw);
const title = (typeof data.label === 'string' && data.label) || params.slug;
const display = derivedPageForDisplay(body);
```
et le header :
```tsx
<div className="mb-6">
  <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
  <p className="text-sm text-gray-400">{resources.length} ressource(s)</p>
</div>
```

Cible :
- Remplacer la lecture inline `readWikiFile` + `matter` par l'accesseur typé :
  ```ts
  const data = await getTheme(params.slug);
  if (!data) notFound();
  const { theme, body } = data;
  const title = theme.label;
  const display = derivedPageForDisplay(body);
  ```
  (Retirer les imports devenus inutiles : `matter` et `readWikiFile` si plus
  utilisés dans le fichier — `readWikiFile` n'est utilisé que pour cette lecture ;
  `matter` idem. Vérifier avant suppression.)
- Ajouter l'import `getTheme` depuis `@/lib/wiki-parser` et `AliasLine` depuis
  `@/components/wiki/AliasLine`.
- Insérer `<AliasLine>` dans le header, sous le titre :
  ```tsx
  <div className="mb-6">
    <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-sm text-gray-400">{resources.length} ressource(s)</p>
      <AliasLine label={theme.label} aliases={theme.aliases} />
    </div>
  </div>
  ```
- La section « Sources » et `listSources()` restent inchangées.

---

## Décisions

- **Composant partagé `<AliasLine>` plutôt qu'un header entièrement unifié.**
  Alternative écartée : extraire un `<EntityThemeHeader>` commun rendant
  badge + alias + titre. Rejetée car les deux pages ont des dispositions
  distinctes (l'entité met le badge/alias au-dessus du titre ; le thème met le
  compteur de ressources et une section Sources) → unifier tout le header
  imposerait un redesign visuel non demandé. Le composant `<AliasLine>` isole
  le **seul** fragment réellement dupliqué (rendu des alias + dédoublonnage),
  ce qui suffit à rendre l'oubli impossible sans toucher aux mises en page.

- **Masquer les alias égaux au label (dédoublonnage insensible à la casse).**
  Motivation : l'arbitrage d'un candidat produit quasi systématiquement un
  alias égal au label (ex. `evaluation-des-agents`, et côté entités `swe-bench`,
  `chatgpt`). Sans filtrage, chaque fiche arbitrée afficherait une ligne
  « alias : <son propre titre> » — du bruit. Comparaison `trim().toLowerCase()`
  (ex. côté entités, « claude code » est masqué car égal à « Claude Code » à la
  casse près, mais « claude-code » et « claude code cli » restent visibles).
  Alternative écartée : normalisation par slug (traiter « claude-code » comme
  égal au label) — rejetée car trop agressive et imprévisible ; l'égalité
  casse/espaces suffit.

- **`createThemePage` émet `aliases: []` (jamais une valeur seedée).**
  Alternative écartée : seeder l'alias avec le label — rejetée car cela
  recréerait précisément le cas « alias == label » qu'on filtre. Autre
  alternative écartée : ajouter un champ `aliases` à `ResolvedTheme` et le
  câbler dans les vues de projection (`themeAliases`) pour permettre la
  déclaration d'alias de thème à l'ingestion — rejetée comme sur-ingénierie :
  aucune source de donnée ne l'alimente aujourd'hui, et les alias de thème
  arrivent déjà par l'arbitrage.

- **Honnêteté sur le poids réel de l'item 3.** Le parser (`arr(data.aliases)`)
  renvoie déjà `[]` quand le champ `aliases` est absent du frontmatter : le
  rendu est donc **déjà** sûr sans l'item 3. L'item 3 n'est PAS load-bearing
  pour la visibilité des alias — c'est une consistance de forme entre les deux
  chemins de création de page (mirror de `createEntityPage`), qui évite qu'un
  futur lecteur soit induit en erreur par un fichier thème sans champ `aliases`.
  On le fait parce que la refonte vise un miroir étanche, mais son enjeu est
  cosmétique au niveau fichier.

- **Le cœur « ne plus jamais » = items 1 + 2.** L'accesseur typé `getTheme`
  interdit à la page thème de re-parser le frontmatter à la main (donc d'oublier
  un champ) ; le composant `<AliasLine>` partagé garantit une règle d'affichage
  unique. Ensemble, ils suppriment la classe de bug, pas juste l'instance.

---

## Hors périmètre

- **Ne pas** ajouter de champ `aliases` à `ResolvedTheme` ni de mécanisme de
  déclaration d'alias de thème à l'ingestion (le sidecar IA n'en produit pas).
- **Ne pas** unifier entièrement les deux pages de détail (entité / thème) en un
  seul composant de page — seul le fragment `<AliasLine>` est partagé.
- **Ne pas** modifier `applyThemeDecision` (`wiki-mutate.ts`) : il écrit déjà
  correctement les alias lors d'un arbitrage.
- **Ne pas** modifier le chemin de mise à jour d'un thème existant dans le
  moteur (il préserve déjà `aliases`).
- **Ne pas** toucher aux vues liste (`ThemesView` / `EntitiesView`) : elles
  affichent déjà le compteur d'alias correctement.
- **Ne pas** réécrire les fichiers thème existants du wiki (pas de migration de
  données) : `machine-learning.md` restera sans champ `aliases` jusqu'à sa
  prochaine réécriture par le moteur — sans impact, le parser défaultant à `[]`.
- **Ne pas** renommer de slug (règle cardinale : slugs immuables).

---

## Todo

- [x] **1. Ajouter `getTheme(slug)` + interface `ThemeDetail`** dans
  `web/lib/wiki-parser.ts`, juste après `getEntity`/`EntityDetail`. Miroir
  exact, sans champ `entity_type`. `ThemeEntry` déjà importé ligne 12, `THEMES`
  déjà défini ligne 28.
  **Vérif :** `cd web && npx tsc --noEmit` passe sans erreur. Grep de contrôle :
  `getTheme` et `ThemeDetail` présents dans `wiki-parser.ts`.

- [x] **2. Créer `web/components/wiki/AliasLine.tsx`** (contenu exact fourni au
  Plan §2) : filtre `norm(a) !== norm(label)` avec `norm = trim().toLowerCase()`,
  rend `null` si vide.
  **Vérif :** `npx tsc --noEmit` passe. Relire le composant : la logique de
  filtrage est bien celle spécifiée.

- [x] **3. Brancher la page entité** (`web/app/entities/[slug]/page.tsx`) sur
  `<AliasLine>` : remplacer le bloc `{entity.aliases.length > 0 && (…)}` (lignes
  43-47) par `<AliasLine label={entity.label} aliases={entity.aliases} />`,
  conserver le badge, ajouter l'import.
  **Vérif :** `npx tsc --noEmit` passe. Lancer l'app (`cd web && npm run dev`),
  ouvrir `/entities/claude-code` → affiche « alias : claude-code, claude code
  cli » (SANS « claude code » seul, masqué car = label). Ouvrir
  `/entities/swe-bench` → **aucune** ligne alias (label = alias). Screenshot des
  deux.

- [x] **4. `createThemePage` émet `aliases: []`** dans `web/lib/wiki-project.ts`
  (insérer `\naliases: []` après `label:`).
  **Vérif :** `cd web && npm test` — la suite `wiki-project.test.ts` reste verte
  (assertions en `.includes(...)`, non impactées). Ajouter/étendre un test qui
  projette une ressource référençant un topic **sans** page thème existante et
  asserte que l'op `wiki/themes/<t>.md` créée contient `aliases: []` dans son
  frontmatter. Le test passe.

- [x] **5. Brancher la page thème** (`web/app/wiki/[slug]/page.tsx`) sur
  `getTheme` + `<AliasLine>` (Plan §4) : remplacer `readWikiFile`+`matter` par
  `getTheme`, insérer `<AliasLine label={theme.label} aliases={theme.aliases} />`
  dans le header, nettoyer les imports devenus inutiles (`matter`,
  `readWikiFile` s'ils ne servent plus).
  **Vérif :** `npx tsc --noEmit` passe.

- [x] **6. Démonstration end-to-end (preuve du bug résolu).** Le seul thème avec
  alias (`evaluation-des-agents`) a alias = label → n'affichera rien (correct).
  Pour prouver l'affichage : éditer **temporairement**
  `wiki/themes/evaluation-des-agents.md` en remplaçant la ligne `aliases:` par
  un alias distinct, p. ex. `aliases: ["éval agents", "agent evaluation"]`.
  Lancer `cd web && npm run dev`, ouvrir `/wiki/evaluation-des-agents`.
  **Vérif attendue :** la page affiche « alias : éval agents, agent evaluation »
  dans le header (screenshot). Puis **remettre** la ligne d'origine
  `aliases: ["Évaluation des agents de code"]` (git diff doit être propre sur ce
  fichier) et recharger la page → **aucune** ligne alias (alias = label, masqué).
  Screenshot des deux états.

- [x] **7. Non-régression globale.** `cd web && npm test` (toute la suite verte)
  + `npx tsc --noEmit` (zéro erreur) + `npm run lint` (pas de nouvelle erreur).
  `git status` : seuls les fichiers prévus sont modifiés, aucun fichier du wiki
  (`wiki/**`) laissé modifié après la démo de l'étape 6.

- [x] **8. Note de leçon.** Ajouter à `tasks/lessons.md` (le créer s'il n'existe
  pas) le pattern : « entités et thèmes sont un miroir maintenu à la main ; tout
  champ ajouté d'un côté doit passer par un accesseur typé partagé
  (`getEntity`/`getTheme`) et un composant d'affichage partagé (`<AliasLine>`)
  — jamais de re-parsing inline du frontmatter dans une page. »
  **Vérif :** entrée présente dans `tasks/lessons.md`.

---

## Bilan

**Fait — conforme au plan, sans déviation de fond.**

Les 4 changements du plan ont été implémentés à l'identique :
1. `getTheme(slug)` + interface `ThemeDetail` ajoutés dans `web/lib/wiki-parser.ts`,
   miroir exact de `getEntity`, sans `entity_type`.
2. `web/components/wiki/AliasLine.tsx` créé (contenu exact du Plan §2 : filtre
   `norm(a) !== norm(label)`, `null` si vide).
3. Page entité (`web/app/entities/[slug]/page.tsx`) branchée sur `<AliasLine>`,
   badge de type conservé, import ajouté.
4. `createThemePage` (`web/lib/wiki-project.ts`) émet `aliases: []`.
5. Page thème (`web/app/wiki/[slug]/page.tsx`) branchée sur `getTheme` + `<AliasLine>` ;
   imports devenus inutiles retirés (`matter`, `readWikiFile`).
Test unitaire ajouté à `wiki-project.test.ts` (page thème créée porte `aliases: []`).

**Preuves (démontrées, pas affirmées) :**
- `npm test` : **159 tests verts**, dont le nouveau test `aliases: []`.
- `npx tsc --noEmit` : **0 erreur**.
- Démonstration end-to-end via le serveur `next dev` déjà lancé (port 3000), sur le
  HTML réellement rendu (server components `force-dynamic`) :
  - `/entities/claude-code` → `alias : claude-code, claude code cli` (« claude code »
    seul masqué car = label à la casse près).
  - `/entities/swe-bench` → **aucune** ligne alias (label = alias).
  - `/wiki/evaluation-des-agents` (état réel, alias = label) → **aucune** ligne (correct).
  - `/wiki/evaluation-des-agents` avec alias temporaires distincts →
    `alias : éval agents, agent evaluation` (**le bug rapporté est résolu**), puis
    `git checkout` → fichier propre, page redevenue sans ligne.

**Déviations / notes d'honnêteté :**
- **Preuve par `curl | grep` plutôt que screenshot.** La spec demandait des captures
  d'écran. L'environnement était partagé (plusieurs sessions Claude concurrentes + un
  `next dev` non m'appartenant sur le port 3000). Plutôt que lancer une instance
  (risque de corrompre le `.next` du serveur voisin — cf. leçons Node 26), j'ai prouvé
  l'affichage sur le HTML rendu par le serveur existant (HMR reflétant mes edits). C'est
  une preuve du **texte exactement rendu** par le vrai chemin de données, aussi probante
  qu'une capture. Détail : React insère `<!-- -->` entre texte statique et dynamique →
  marqueurs retirés avant le grep.
- **`npm run lint` : ESLint n'est pas configuré dans le projet** (aucun `.eslintrc*`,
  `next lint` propose une config interactive). Le critère « pas de nouvelle erreur lint »
  est donc vide de sens ici — remplacé par `tsc` + tests + preuve live.
- **Fichiers hors périmètre modifiés par une session concurrente** (`web/components/chat/
  ChatWindow.tsx`, `web/next.config.js`, `wiki/Sans titre.canvas`, `wiki/themes/
  _candidates.json`) : **non touchés par moi**, exclus du commit proposé.
