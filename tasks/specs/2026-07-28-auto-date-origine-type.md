# Auto-remplissage déterministe de la DATE, l'ORIGINE et le TYPE à l'ingestion

## Contexte

**Demande utilisateur (Arthur).** Quand on dépose un document sans préciser
l'origine ni la date, ces champs restent parfois **vides** au lieu d'être
remplis automatiquement. Trois attentes :

1. **Origine** déduite du **type** de document quand elle n'est pas précisée.
2. **Date** récupérée **dans le document** (ex. en-tête d'article) ; à défaut, le
   **mois + année courants**.
3. **Type** : plus de défaut silencieux « Article ». Le champ démarre sur
   **« Auto (déduit par l'IA) »** (miroir du champ Origine « Auto ») ; l'IA
   déduit le type du contenu quand l'utilisateur ne choisit pas.

**Problème réel (audit en profondeur, code à l'appui).** Ce que l'utilisateur
demande est en partie « déjà censé » se produire — mais **rien ne le garantit** :
c'est confié à l'IA en prose, sans filet déterministe.

- **Origine.** `origin` est un enum fermé `{interne, externe}`
  (`web/types/index.ts:8` `OriginValue`, `web/lib/ui.ts:97-103`). Au dépôt, un
  `<select>` « Origine » avec une option **Auto** (`''`) n'est envoyé que si
  l'utilisateur force (`UploadForm.tsx:52`, `:243-244`). Le lien type→origine
  n'existe **que comme heuristique de prompt** (`prompts/ingest-prompt.md:80-86`
  + `docs/wiki-spec.md §5`), appliquée par l'IA. **Aucun lien déterministe** :
  `cleanOrigin` (`wiki-parser.ts:48-52`) valide sans consulter le type ; il
  n'existe **pas** de `forceOrigin` — c'est le SEUL champ « autoritaire du
  sidecar » sans filet déterministe (contrairement à `entities`/`topics` que
  `forceDeclaredLinks`/`rollupSection*` réinjectent de force dans le frontmatter,
  `ingest-local.ts:695-738`). Résultat : 1 fiche a `origin: ""`.
- **Date.** `date` est une chaîne libre non validée. **Aucun code n'extrait de
  date du contenu** ; l'IA *peut* le faire (rien ne l'interdit — asymétrie nette
  avec `url` « JAMAIS déduite du contenu », `ingest-prompt.md:47`), d'où des
  dates fines jamais saisies à la main. **Aucun repli** : si vide au sidecar et
  introuvable, la fiche reste `date: ""` (3 fiches dans ce cas). `today =
  nowIso().slice(0,10)` existe (`ingest-local.ts:1076`) mais n'est jamais utilisé
  comme date de ressource.
- **Type.** Choix utilisateur, défaut `'article'` **toujours** envoyé
  (`UploadForm.tsx:50`, `:242`). Repli brut `'unknown'`
  (`upload/route.ts:186`). L'IA a une capacité **dormante** de déduire le type
  « sans sidecar » (`ingest-prompt.md:40-43`) **jamais déclenchée** par l'UI (un
  type est toujours envoyé). **Aucune détection de type par contenu.**

**Registre des types (chantier 2026-07-28 « types ouverts »).**
`wiki/types.json` = `{ "types": [slug...] }` (aujourd'hui 8 slugs, mais
`unknown` n'est PAS dans la graine du menu — cf. `ui.ts:20-28`
`BUILTIN_TYPE_SLUGS` = 7 slugs : article, report-pdf, personal-notes,
meeting-notes, interview, presentation, transcript). `unknown` = repli
d'affichage seulement. Fichier autoritaire dès qu'il est non vide (plus d'union
avec la graine). `typeLabel`/`typeBadgeClass` = fonctions pures du slug.
Lecteur `listTypeRegistry(): string[]` (`wiki-parser.ts:242-256`). API
`GET/POST /api/types` + `PATCH/DELETE /api/types/[slug]`. UI : `UploadForm`
(menu + création inline « + Nouveau type… ») + `ManageTypesModal`
(renommer/supprimer si 0 ressource ; règle cardinale #5 : slug figé dès qu'une
ressource l'utilise).

**Patron déterministe post-IA existant** (à imiter). `ingestOne`
(`ingest-local.ts:896-922`) réécrit le frontmatter produit par l'IA AVANT
projection : `forceSourceFile` (`:680-685`), `forceDeclaredLinks` (`:695-705`),
`rollupSectionTopics`/`rollupSectionEntities` (`:715-738`), `rebuildNav`
(`:747-776`). Primitives : `splitFrontmatter`/`withFrontmatter`/`setScalar`
(`wiki-mutate.ts:76-92`). **Piège :** `setScalar` est un **no-op si la clé est
absente** (`:91-92`) → il faut créer la clé au besoin (cf. `forceSourceFile:683`).

---

## Plan

Trois chantiers **indépendants** (TYPE, ORIGINE, DATE) partageant un même point
d'insertion déterministe. Le fil rouge : **l'IA propose, un moteur déterministe
garantit.** L'origine et la date écrites par l'IA sont recouvertes par une
cascade déterministe ; le type est le seul point où l'IA reste décisionnaire
(déduction du contenu), avec repli déterministe `unknown`.

### 0. Point d'insertion commun (les 3 `force*`) — DANS LA BOUCLE LIVE, PAS DANS `ingestOne`

**Décision structurante.** Les nouvelles fonctions `forceType`, `forceOrigin`,
`forceDate` s'appliquent **uniquement au flux d'ingestion live** (nouveau dépôt,
un sidecar existe), **jamais** dans `ingestOne` — car `ingestOne` est réutilisé
par le backfill (`web/scripts/wiki-backfill-topics.ts`) qui **re-projette des
fiches existantes**. Les y mettre écraserait rétroactivement l'origine (réécrite
depuis le type) et la date (mois courant faux) de tout le corpus existant. Elles
vont donc dans la boucle de `runIngestion`, **avant** l'appel `ingestOne`.

Emplacement exact — `web/lib/ingest-local.ts`, boucle `for (const file of
pending)` (≈ `:1090-1132`), juste après `phase('project', …)` (`:1113`) et avant
`ingestOne(...)` (`:1114`) :

```ts
phase('project', lbl('Structuration de la fiche'), file);
// Filet déterministe : type (repli unknown) → origine (cascade) → date (cascade).
// AVANT ingestOne (qui est aussi appelé par le backfill : ne pas y toucher).
let md = forceType(gen.markdown);
md = forceOrigin(md, sidecar.origin, typeOrigins);
md = forceDate(md, sidecar.date, today);
const { ops, slug, warnings } = await ingestOne({
  file, markdown: md, detectedNew: gen.detectedNew,
  declaredEntities, declaredThemes, registries, today,
});
```

`sidecar.origin` / `sidecar.date` proviennent du `parseSidecar` étendu (§B2).
`typeOrigins` est une map `Record<slug, OriginValue>` chargée **une fois par run**
(cf. §B3), à placer près de `const knownTypes = …` (`:1082`) :

```ts
const typeOrigins = await loadTypeOriginMap();
```

`ingestOne` reste **inchangé** (signature `IngestOneInput` intacte) : il applique
comme avant `forceSourceFile` + rollups + `rebuildNav`, et son `parseResourceMeta`
(`:906`) verra désormais le type/origine/date déjà forcés dans le frontmatter.

---

### A. CHANTIER TYPE — « Auto (déduit par l'IA) »

#### A1. `web/components/upload/UploadForm.tsx`

- Ligne 50 : le défaut `'article'` devient **Auto**. Introduire une sentinelle
  et démarrer dessus :
  ```ts
  const AUTO_TYPE = ''; // '' = Auto (l'IA déduit le type du contenu)
  const [type, setType] = useState<ResourceType>(AUTO_TYPE);
  ```
- `<select id="type-select">` (`:428-450`) : ajouter en **première** option
  l'Auto, avant la liste `types` et l'option `NEW_TYPE` :
  ```tsx
  <option value={AUTO_TYPE}>Auto (déduit par l'IA)</option>
  {types.map((t) => (<option key={t.slug} value={t.slug}>{t.label}</option>))}
  <option value={NEW_TYPE}>+ Nouveau type…</option>
  ```
  Ajouter sous le select une aide (miroir de l'aide Origine `:504-506`) :
  « Laisse « Auto » pour que l'IA déduise le type d'après le contenu. »
- Réconciliation `loadTypes` (`:75`) : l'Auto doit survivre à un rechargement du
  registre (ne pas le remplacer par `list[0]`) :
  ```ts
  setType((cur) => (cur === AUTO_TYPE || list.some((t) => t.slug === cur) ? cur : AUTO_TYPE));
  ```
- `reset()` (`:183`) : `setType(types[0]?.slug ?? 'unknown')` → `setType(AUTO_TYPE)`.
- `submit()` (`:242`) : `form.append('type', type)` (inconditionnel) →
  **n'envoyer que si un vrai type est choisi** :
  ```ts
  if (type) form.append('type', type); // Auto ('') → pas de champ → l'IA déduit
  ```
- Conséquences des comparaisons `type === 'article'` (`:246`, `:528`) : en Auto,
  le champ URL de l'article ne s'affiche plus tant qu'« Article » n'est pas
  explicitement choisi. **Comportement voulu** (l'URL est spécifique à l'article
  saisi à la main). `authorLabel` (`:281`, comparaison `'meeting-notes'`) :
  inchangé.

#### A2. `web/app/api/upload/route.ts`

- `field`/`slugify` inchangés. Ligne 186 :
  ```ts
  // Type ABSENT (Auto) ⇒ null ⇒ pas de ligne `type:` au sidecar ⇒ l'IA déduit.
  const typeRaw = field(form, 'type');
  const sourceType = typeRaw ? (slugify(typeRaw) || null) : null;
  ```
- `buildSidecar` : `sourceType: string` → `sourceType: string | null` (signature
  `:107`). Ligne 120 `lines.push(\`type: ${meta.sourceType}\`)` (inconditionnel)
  → conditionnel :
  ```ts
  if (meta.sourceType) lines.push(`type: ${meta.sourceType}`);
  ```
  (mettre à jour le commentaire `:121-122` : l'origine est désormais déterminée
  par le moteur, plus par « l'agent déduit ».)

#### A3. `prompts/ingest-prompt.md` (déduction du type)

- Renforcer la consigne `source_type` (`:40-43`). Cible :
  ```
  - `source_type` (slug kebab, non quoté) : reprends VERBATIM celui du sidecar
    s'il est fourni (fait autorité). SANS type au sidecar (mode Auto), DÉDUIS le
    type le plus probable du contenu, choisi PARMI les « Types de ressource
    connus » listés dans le message système. Si aucun ne convient clairement →
    `source_type: unknown`. Ne crée pas de slug de type inédit en mode Auto.
  ```
  (`knownTypes` est déjà injecté au system prompt, `ingest-local.ts:1082-1083` —
  ne rien changer côté injection.)
- **Repli déterministe ultime** : `forceType` (§A4) garantit `source_type:
  unknown` si l'IA n'en produit aucun d'exploitable.

#### A4. `web/lib/ingest-local.ts` — `forceType` (nouvelle fonction exportée)

À placer près des autres `force*` (après `rollupSectionEntities`, ≈ `:738`) :

```ts
/**
 * Repli déterministe du type : si l'IA n'a produit aucun `source_type`
 * exploitable (mode Auto sans déduction), force `unknown`. Ne touche à rien si un
 * type est présent. `setScalar` étant no-op si la clé manque, on la crée au besoin.
 */
export function forceType(markdown: string): string {
  const meta = parseResourceMeta(markdown, '');
  if (meta.source_type) return markdown;
  const { fm, rest } = splitFrontmatter(markdown);
  let nf = setScalar(fm, 'source_type', 'unknown');
  if (!/^source_type:/m.test(nf)) nf = `${nf}\nsource_type: unknown`;
  return withFrontmatter(nf, rest);
}
```

**Hors périmètre TYPE :** aucune UI pour corriger le `source_type` d'une fiche
**après** ingestion (« on ne modifie pas les types »). Une déduction erronée se
corrige en re-déposant.

---

### B. CHANTIER ORIGINE — portée par le type, binaire, déterministe

#### B1. Modèle & classification (BINAIRE — pas d'état « indéterminé »)

Chaque type porte **une** origine ∈ `{interne, externe}`. Classification de
graine (`BUILTIN_TYPE_ORIGIN`), validée avec Arthur :

| slug | origine |
|---|---|
| `personal-notes` | interne |
| `meeting-notes` | interne |
| `transcript` | interne |
| `report-pdf` | externe |
| `article` | externe |
| `interview` | externe |
| `presentation` | externe |
| `unknown` | externe (repli) |

Un type **créé** par l'utilisateur porte l'origine choisie à la création
(défaut `externe`), stockée dans `wiki/types.json`, modifiable ensuite.

#### B2. `web/lib/ui.ts` — graine d'origine + résolveur pur

```ts
// Origine par défaut d'un type (BINAIRE). Graine des types intégrés + repli unknown.
// Sert de valeur par défaut quand types.json ne stocke pas d'origine pour un slug.
export const BUILTIN_TYPE_ORIGIN: Record<string, OriginValue> = {
  'personal-notes': 'interne',
  'meeting-notes': 'interne',
  transcript: 'interne',
  'report-pdf': 'externe',
  article: 'externe',
  interview: 'externe',
  presentation: 'externe',
  unknown: 'externe',
};

/** Origine par défaut d'un slug de type (pur, client-safe). Slug inconnu → externe. */
export function typeOriginDefault(slug: string): OriginValue {
  return BUILTIN_TYPE_ORIGIN[(slug ?? '').trim()] ?? 'externe';
}
```

#### B3. `wiki/types.json` — schéma porteur de l'origine + lecteurs

**Nouveau schéma** : `{ "types": [ { "slug": "article", "origin": "externe" },
… ] }`. **Compat LECTURE** de l'ancien format (tableau de strings) : une entrée
string `"article"` → `{ slug: "article", origin: typeOriginDefault("article") }`.
Écriture via `applyFileOps` uniquement (garde-fou `wiki-fs`).

`web/lib/wiki-parser.ts` :

```ts
import { BUILTIN_TYPE_SLUGS, typeOriginDefault } from '@/lib/ui';
import { OriginValue } from '@/types';

export interface TypeRegistryEntry { slug: string; origin: OriginValue; }

/**
 * Registre EFFECTIF complet (slug + origine). Fichier autoritaire dès qu'il est
 * non vide (mêmes sémantiques que listTypeRegistry : plus d'union, un type retiré
 * ne repousse pas). Entrée string (ancien format) ou objet {slug, origin} tolérée.
 * Absent/vide/illisible → graine BUILTIN_TYPE_SLUGS avec leur origine par défaut.
 */
export async function listTypeRegistryFull(): Promise<TypeRegistryEntry[]> {
  const content = await readWikiFile('types.json');
  if (content.trim()) {
    try {
      const j = JSON.parse(content);
      if (Array.isArray(j?.types) && j.types.length) {
        const seen = new Set<string>();
        const out: TypeRegistryEntry[] = [];
        for (const raw of j.types) {
          const slug = (typeof raw === 'string' ? raw : String(raw?.slug ?? '')).trim();
          if (!slug || seen.has(slug)) continue;
          seen.add(slug);
          const o = raw && typeof raw === 'object' ? String((raw as any).origin ?? '').trim() : '';
          out.push({ slug, origin: o === 'interne' || o === 'externe' ? o : typeOriginDefault(slug) });
        }
        if (out.length) return out;
      }
    } catch { /* illisible → graine */ }
  }
  return [...BUILTIN_TYPE_SLUGS].map((slug) => ({ slug, origin: typeOriginDefault(slug) }));
}
```

**Refactor `listTypeRegistry()`** (`:242-256`) pour tolérer le nouveau schéma
(sinon `String({slug,origin})` = `"[object Object]"`). Le dériver de la version
Full — préserve tous les tests existants (graine si vide/absent/illisible ;
fichier autoritaire dédoublonné) :
```ts
export async function listTypeRegistry(): Promise<string[]> {
  return (await listTypeRegistryFull()).map((t) => t.slug);
}
```

#### B4. `web/lib/ingest-local.ts` — `loadTypeOriginMap` + `forceOrigin`

```ts
import { BUILTIN_TYPE_ORIGIN } from '@/lib/ui';
import { listTypeRegistryFull } from '@/lib/wiki-parser';
import { OriginValue } from '@/types';

/** Map slug→origine du run (graine ∪ registre). Chargée une fois par ingestion. */
async function loadTypeOriginMap(): Promise<Record<string, OriginValue>> {
  const map: Record<string, OriginValue> = { ...BUILTIN_TYPE_ORIGIN };
  for (const t of await listTypeRegistryFull()) map[t.slug] = t.origin;
  return map;
}

/**
 * Cascade déterministe de l'origine (le 1er qui s'applique gagne) :
 *  1) origine DÉCLARÉE au dépôt (sidecar) — gagne toujours, même en contradiction
 *     avec le type ;
 *  2) sinon origine du TYPE final (déclaré ou déduit par l'IA), via la map registre ;
 *  3) filet edge (type hors map) → externe.
 * L'origine écrite par l'IA est IGNORÉE/écrasée. `setScalar` no-op si clé absente → créée.
 */
export function forceOrigin(
  markdown: string,
  declaredOrigin: OriginValue | null,
  typeOrigins: Record<string, OriginValue>,
): string {
  const meta = parseResourceMeta(markdown, '');
  const finalType = meta.source_type ?? 'unknown';
  const origin: OriginValue = declaredOrigin ?? typeOrigins[finalType] ?? 'externe';
  const { fm, rest } = splitFrontmatter(markdown);
  let nf = setScalar(fm, 'origin', origin); // valeur NON quotée (convention frontmatter)
  if (!/^origin:/m.test(nf)) nf = `${nf}\norigin: ${origin}`;
  return withFrontmatter(nf, rest);
}
```

> `forceType` DOIT s'exécuter avant `forceOrigin` (l'origine dépend du type
> final) — respecté par l'ordre d'appel du §0.

**Étendre `parseSidecar`** (`:225-246`) pour lire `origin` + `date` (aujourd'hui
ignorés — ils ne survivent que via le texte brut injecté au prompt) :
```ts
export interface Sidecar {
  links: Record<string, string[]>;
  entitiesGranularity: unknown;
  themes: string[];
  themesGranularity: string;
  origin: OriginValue | null;   // NOUVEAU
  date: string | null;          // NOUVEAU
}
// dans parseSidecar, avant le return :
const o = typeof data.origin === 'string' ? data.origin.trim() : '';
const origin: OriginValue | null = o === 'interne' || o === 'externe' ? o : null;
const date = typeof data.date === 'string' && data.date.trim() ? data.date.trim() : null;
// … return { links, entitiesGranularity, themes, themesGranularity, origin, date };
```

#### B5. `prompts/ingest-prompt.md` — retirer l'heuristique origin

- **Supprimer** entièrement la section « ## Heuristique origin » (`:80-86`).
- Champ `origin` du frontmatter (`:44`) : l'IA ne décide plus. Remplacer par :
  ```
  - `origin` (non quoté) : écris `origin: ""` — le moteur déterministe remplit
    l'origine à partir du type (ou de l'origine déclarée au dépôt). Ne la déduis pas.
  ```
- Ligne d'autorité sidecar (`:50-51`) : retirer `origin` de la liste des champs
  repris (le moteur s'en charge) → `title`/`author`/`date`/`url`/`source_type`.

#### B6. API registre — porter l'origine

Toutes les mutations réécrivent des **objets** `{slug, origin}`. Introduire
`writeRegistry(entries: TypeRegistryEntry[])` (remplace la version « strings »
dans `[slug]/route.ts:10-18`, à dupliquer/partager dans `route.ts`) :
```ts
content: JSON.stringify({ types: entries }, null, 2) + '\n'
```

- **`GET /api/types`** (`route.ts:21-34`) : ajouter `origin` par ligne.
  ```ts
  const [full, inUse] = await Promise.all([listTypeRegistryFull(), listTypes()]);
  const counts = new Map(inUse.map((t) => [t.type, t.source_count]));
  const builtin = new Set<string>(BUILTIN_TYPE_SLUGS);
  const types = full
    .map((t) => ({ slug: t.slug, label: typeLabel(t.slug), origin: t.origin,
      source_count: counts.get(t.slug) ?? 0, builtin: builtin.has(t.slug) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  ```
- **`POST /api/types`** (`route.ts:37-70`) : accepter `{ name, origin }`.
  ```ts
  const originIn = (body as any)?.origin;
  const origin: OriginValue = originIn === 'interne' || originIn === 'externe' ? originIn : 'externe';
  const current = await listTypeRegistryFull();
  if (current.some((t) => t.slug === slug)) return 409 'Ce type existe déjà';
  await writeRegistry([...current, { slug, origin }]);
  return Response.json({ ok: true, slug, label: typeLabel(slug), origin });
  ```
- **`DELETE /api/types/[slug]`** (`[slug]/route.ts:35-65`) : garde `usageCount`
  inchangé ; réécrire avec objets :
  ```ts
  const current = await listTypeRegistryFull();
  await writeRegistry(current.filter((t) => t.slug !== slug));
  ```
- **`PATCH /api/types/[slug]`** (`[slug]/route.ts:69-122`) : accepter
  `{ name?, origin? }` — **renommage** (comme aujourd'hui, interdit si utilisé) ET
  **changement d'origine** (TOUJOURS autorisé, même si utilisé : ne touche pas au
  slug, n'affecte que les futurs dépôts). Logique :
  ```ts
  const current = await listTypeRegistryFull();
  const idx = current.findIndex((t) => t.slug === oldSlug);
  if (idx === -1) return 404 'Type introuvable';
  const next = [...current];
  // (a) changement d'origine — inconditionnel
  const oIn = (body as any)?.origin;
  if (oIn === 'interne' || oIn === 'externe') next[idx] = { ...next[idx], origin: oIn };
  // (b) renommage — seulement si un `name` est fourni ET le slug change
  const name = typeof (body as any)?.name === 'string' ? (body as any).name : '';
  const newSlug = name ? slugify(name) : oldSlug;
  if (name && newSlug && newSlug !== oldSlug) {
    if (!SLUG_RE.test(newSlug)) return 400 'Nouveau nom invalide';
    if (await usageCount(oldSlug) > 0) return 409 '… nom figé';
    if (current.some((t) => t.slug === newSlug)) return 409 'Un type porte déjà ce nom';
    next[idx] = { ...next[idx], slug: newSlug };
  }
  await writeRegistry(next);
  return Response.json({ ok: true, slug: next[idx].slug, label: typeLabel(next[idx].slug), origin: next[idx].origin });
  ```

#### B7. UI — origine à la création + édition

- **`UploadForm.tsx`** (création inline) : ajouter un état
  `const [newTypeOrigin, setNewTypeOrigin] = useState<OriginValue>('externe');`,
  un petit `<select>` interne/externe dans la ligne de création (`:452-487`), et
  l'envoyer :
  ```ts
  body: JSON.stringify({ name, origin: newTypeOrigin }),
  ```
  Réinitialiser `newTypeOrigin` à `'externe'` à l'ouverture/fermeture de la ligne.
- **`ManageTypesModal.tsx`** : `TypeRow` gagne `origin: OriginValue` (`:6`).
  Afficher par ligne un contrôle d'origine (segmenté interne/externe ou
  `<select>`) **toujours actif** (même pour un type verrouillé en
  renommage/suppression), qui appelle `PATCH { origin }` et met à jour l'état
  local au succès. Le cadenas (`locked = source_count > 0`) ne concerne QUE
  renommage/suppression, pas l'origine.

---

### C. CHANTIER DATE — extraite du document, sinon mois courant

#### C1. `prompts/ingest-prompt.md` (extraction explicite)

Champ `date` du frontmatter (`:39`). Cible :
```
- `date` : `AAAA` | `AAAA-MM` | `AAAA-MM-JJ`, entre guillemets. Reprends la date
  du sidecar si fournie (fait autorité). SINON, extrais la date de PUBLICATION du
  document lui-même (en-tête, chapô, signature, métadonnées) au niveau de
  précision disponible. Si tu n'en trouves aucune, écris `date: ""` — le moteur
  déterministe mettra le mois courant.
```
(La règle VERBATIM concerne le CORPS ; renseigner un champ de métadonnée depuis
l'en-tête n'est pas une reformulation de contenu — c'est déjà le comportement de
fait, ici rendu explicite.)

#### C2. `web/lib/ingest-local.ts` — `forceDate`

```ts
/**
 * Cascade déterministe de la date (le 1er qui s'applique gagne) :
 *  1) date DÉCLARÉE au dépôt (sidecar) ;
 *  2) sinon date extraite par l'IA (présente au frontmatter) ;
 *  3) sinon MOIS COURANT (AAAA-MM) — plus jamais de date vide.
 * Écrit une valeur QUOTÉE (convention frontmatter). Clé créée si absente.
 */
export function forceDate(markdown: string, declaredDate: string | null, today: string): string {
  const meta = parseResourceMeta(markdown, '');
  const date = declaredDate ?? meta.date ?? today.slice(0, 7); // today = AAAA-MM-JJ → AAAA-MM
  const { fm, rest } = splitFrontmatter(markdown);
  const raw = JSON.stringify(date);
  let nf = setScalar(fm, 'date', raw);
  if (!/^date:/m.test(nf)) nf = `${nf}\ndate: ${raw}`;
  return withFrontmatter(nf, rest);
}
```

`today` est déjà `nowIso().slice(0,10)` (`:1076`) et passé dans la boucle.
`rebuildNav` (dans `ingestOne`, `:917`) régénère la nav depuis `meta.date` déjà
forcée → le lien by-date pointe le mois courant à défaut. La vue `by-date/`
(`wiki-index.ts:buildByDate`) et le graphe (`published_on`) suivent
mécaniquement (ils dérivent de `card.date`, désormais toujours non vide).

---

### D. Docs & règles

- **`prompts/ingest-prompt.md`** : cf. §A3, §B5, §C1.
- **`docs/wiki-spec.md`** §5 (table heuristique origin, ≈ `:219-231`) : remplacer
  par « `origin` est **déterministe**, dérivée du **type** via le registre
  `wiki/types.json` (map slug→origine) ; l'origine **déclarée** au dépôt prime.
  L'IA ne déduit plus l'origine. » Mentionner la déduction Auto du type + le
  repli date (mois courant).
- **`docs/ingestion.md`** : documenter les 3 filets déterministes (`forceType`,
  `forceOrigin`, `forceDate`) et le mode « Auto » du type.
- **`CLAUDE.md`** règle 3 : préciser que `wiki/types.json` porte désormais une
  **origine par type** (`{ "types": [{ "slug, origin }] }`) — registre canonique,
  non dérivé.

### E. Tests

- **`web/lib/__tests__/type-registry.test.ts`** (étendre) :
  - `typeOriginDefault` : `'personal-notes'→'interne'`, `'article'→'externe'`,
    `'unknown'→'externe'`, slug créé inconnu → `'externe'`.
  - `listTypeRegistryFull` : graine (fichier absent) = 7 slugs avec origines de
    `BUILTIN_TYPE_ORIGIN` ; fichier objets `[{slug,origin}]` autoritaire ; entrée
    string (ancien format) → origine par défaut ; dédoublonnage.
  - Vérifier que les tests `listTypeRegistry` **existants restent verts**
    (graine/vide/illisible/autorité/non-repousse) après refactor via Full.
- **Nouveau `web/lib/__tests__/ingest-force.test.ts`** (fonctions pures, sans
  LLM) :
  - `forceType` : frontmatter `source_type: ""`/absent → `unknown` ; présent → inchangé.
  - `forceOrigin` : (1) `declaredOrigin` gagne même si le type dit l'inverse ;
    (2) sans déclaration, origine = map du type (`article→externe`,
    `personal-notes→interne`) ; (3) type hors map → `externe` ; clé `origin`
    créée si absente du frontmatter.
  - `forceDate` : (1) `declaredDate` gagne ; (2) sinon date IA du frontmatter ;
    (3) sinon `today.slice(0,7)` ; clé créée si absente.
- Vérifier `parseSidecar` : un sidecar `origin: interne` + `date: "2026-03"`
  renvoie `{origin:'interne', date:'2026-03'}`.

---

## Décisions

1. **Type « Auto (déduit par l'IA) » au lieu du défaut `'article'`.** _Écarté :_
   garder un défaut concret (« Article ») — risque de valeur fausse **plausible
   et silencieuse** (un compte-rendu enregistré « Article » sans qu'on le voie).
   _Écarté aussi :_ « proposer + confirmer » le type avant ingestion (flux en
   deux temps, plus lourd) — Arthur veut la **parité** avec le champ Origine Auto
   (fire-and-forget, l'IA décide pendant l'ingestion).

2. **Origine BINAIRE par type, sans état « indéterminé ».** _Écarté :_ modèle à
   trois états (interne/externe/indéterminé, l'IA tranchant les types ambigus).
   Rejeté par Arthur au profit de la **simplicité** : chaque type est classé
   interne **ou** externe ; l'exception (ex. un article réellement interne) se
   gère par la **déclaration prioritaire** au dépôt. Conséquence assumée :
   **l'IA ne décide plus jamais l'origine** — l'origine devient 100 %
   déterministe (déclarée > type). Pour un document exceptionnel, il faut penser à
   déclarer l'origine au dépôt.

3. **Origine déclarée au dépôt PRIORITAIRE sur l'origine du type** (demande
   explicite d'Arthur en cas de contradiction). Implémenté comme 1ᵉʳ palier de la
   cascade `forceOrigin`.

4. **Classification de graine des 8 types** (§B1). `unknown = externe` : Arthur
   ne l'a pas cité ; **défaut annoncé**, révisable d'un mot (changer
   `BUILTIN_TYPE_ORIGIN['unknown']`).

5. **Correction du `source_type` d'une fiche APRÈS ingestion : HORS périmètre**
   (« on ne modifie pas les types »). Une déduction erronée se corrige en
   re-déposant.

6. **Origine d'un type éditable dans `ManageTypesModal` même si le type est
   utilisé** : changer l'origine par défaut ne touche pas au slug (pas de rupture
   de wikilink, cardinale #5) et n'affecte QUE les futurs dépôts — donc autorisé
   sans la garde `usageCount`. _Écarté :_ verrouiller l'origine comme le
   renommage (inutilement restrictif).

7. **Les `force*` dans la boucle live, PAS dans `ingestOne`.** _Écarté :_ les
   mettre dans `ingestOne` par cohérence avec `forceSourceFile`/rollups. Rejeté :
   `ingestOne` est partagé avec le backfill (re-projection de fiches existantes) ;
   forcer origine/date là **écraserait rétroactivement** tout le corpus (origines
   réécrites, dates faussées au mois courant). Le remplissage est une propriété du
   **dépôt live** (sidecar + `today` frais), pas de la re-projection.

8. **Schéma `types.json` = tableau d'objets `{slug, origin}`**, avec compat
   lecture de l'ancien tableau de strings. _Écarté :_ map parallèle
   `{ types:[...], origins:{...} }` — deux structures à garder synchrones. L'objet
   par type est la forme canonique la plus simple ; `listTypeRegistry` reste
   `string[]` (dérivé) pour ne pas casser ses nombreux consommateurs.

9. **`forceType` avant `forceOrigin`** : l'origine dépend du type final ; l'ordre
   d'appel (§0) le garantit.

---

## Hors périmètre

- **Édition du `source_type` d'une ressource existante** (aucune UI ; décision 5).
- **Réécriture rétroactive** de l'origine/la date des ressources **existantes**
  (les fiches actuelles à `origin: ""` / `date: ""` ne sont PAS corrigées par ce
  chantier — elles le seraient seulement par un re-dépôt, non automatisé ici).
- **Changer l'origine par défaut d'un type ne reclasse PAS** les ressources déjà
  ingérées de ce type (n'affecte que les futurs dépôts).
- **Validation stricte du format de date** saisi (champ texte libre inchangé).
- **Ré-ingestion / re-projection en masse** du corpus.
- **Déduction Auto inventant un slug de type inédit** : en mode Auto, l'IA choisit
  parmi le registre connu ou tombe sur `unknown` (pas de nouveau slug).

---

## Todo

> Ordre conseillé : socle de données (registre + origine) → moteur déterministe →
> API → UI → prompt/docs → tests. Compiler après le socle (changement de schéma
> `types.json`). Vérif finale globale à la fin.

- [x] **1. `ui.ts` — graine d'origine.** Ajouter `BUILTIN_TYPE_ORIGIN` (8 entrées,
  §B1) + `typeOriginDefault`. **Vérif :** test unitaire
  `typeOriginDefault('personal-notes')==='interne'`,
  `typeOriginDefault('article')==='externe'`, `typeOriginDefault('xyz')==='externe'`.

- [x] **2. `wiki-parser.ts` — registre porteur d'origine.** Ajouter
  `TypeRegistryEntry` + `listTypeRegistryFull()` (compat string/objet, graine) ;
  refactorer `listTypeRegistry()` en `map(Full → slug)`. **Vérif :**
  `cd web && node --import tsx --test lib/__tests__/type-registry.test.ts` —
  tests existants **verts** ; nouveaux cas `listTypeRegistryFull` (graine 7 slugs
  avec origines ; fichier objets autoritaire ; entrée string → origine par défaut).

- [x] **3. `parseSidecar` étendu.** `Sidecar` gagne `origin`/`date` ; parsing
  (§B4). **Vérif :** test unitaire — sidecar `---\ntype: article\norigin:
  interne\ndate: "2026-03"\n---` → `{origin:'interne', date:'2026-03'}` ; sidecar
  sans origin/date → `{origin:null, date:null}`.

- [x] **4. Moteur déterministe — `forceType`/`forceOrigin`/`forceDate` +
  `loadTypeOriginMap`.** Ajouter les 3 fonctions exportées (§A4/§B4/§C2) + la map
  ; **les brancher dans la boucle `runIngestion`** (§0), PAS dans `ingestOne`.
  Imports (`OriginValue`, `BUILTIN_TYPE_ORIGIN`, `listTypeRegistryFull`).
  **Vérif :** nouveau `ingest-force.test.ts` vert (cascades des 3 fonctions, cf.
  §E) — `cd web && node --import tsx --test lib/__tests__/ingest-force.test.ts`.

- [x] **5. `upload/route.ts` — type optionnel.** `sourceType: string|null`
  (Auto → pas de ligne `type:`), `buildSidecar` conditionnel. **Vérif :** appeler
  `buildSidecar` (unité ou log) avec `sourceType:null` → sidecar **sans** ligne
  `type:` ; avec `sourceType:'article'` → `type: article`.

- [x] **6. API registre (origine).** `writeRegistry(objets)`, `GET` (+origin),
  `POST {name,origin}`, `PATCH {name?,origin?}` (origine inconditionnelle, rename
  si inutilisé), `DELETE` (objets). **Vérif :** piloter les VRAIS handlers sur un
  `DATA_ROOT` isolé (cf. patron du chantier types) : `POST {name:"Podcast",
  origin:"interne"}` → `types.json` contient `{slug:"podcast",origin:"interne"}` ;
  `GET` renvoie `origin` par type ; `PATCH podcast {origin:"externe"}` change
  l'origine (même simulé « en usage ») ; `PATCH` rename d'un type **utilisé** →
  409 ; `DELETE` d'un type inutilisé → retiré. **Vrai wiki intact** (DATA_ROOT
  temporaire).

- [x] **7. UI — Auto + origine.** `UploadForm` : option « Auto (déduit par
  l'IA) » par défaut, `type` envoyé seulement si choisi, réconciliation/reset sur
  Auto, `<select>` origine dans la création inline (POST `{name,origin}`).
  `ManageTypesModal` : contrôle d'origine par ligne (PATCH, toujours actif).
  **Vérif :** `cd web && npx tsc --noEmit` sans erreur ; revue du rendu (option
  Auto en tête, sélecteur origine à la création, badge/toggle origine dans la
  modale). Si un `next dev` est déjà en cours, ne pas le perturber (cf.
  `tasks/lessons.md`) — s'appuyer sur tsc + build.

- [x] **8. Prompt d'ingestion.** `source_type` (déduction Auto bornée au
  registre + repli unknown), `origin` (`""` + moteur), retrait de « Heuristique
  origin », `date` (extraction explicite + repli mois courant), autorité sidecar
  sans `origin`. **Vérif :** `grep -n "Heuristique origin" prompts/ingest-prompt.md`
  → **vide** ; `grep -n "mois courant\|déduit le type\|le moteur déterministe"
  prompts/ingest-prompt.md` → présent.

- [x] **9. Docs & CLAUDE.md.** `docs/wiki-spec.md §5` (origine déterministe),
  `docs/ingestion.md` (3 filets + Auto), `CLAUDE.md` règle 3 (types.json porte
  l'origine). **Vérif :** relecture ; `grep -rn "origin" docs/wiki-spec.md` reflète
  le nouveau modèle (plus de table heuristique).

- [x] **10. Tests & typecheck & build.** `type-registry.test.ts` étendu,
  `ingest-force.test.ts` nouveau, `parseSidecar` couvert. **Vérif :**
  `cd web && npm test` **vert** ; `cd web && npx tsc --noEmit` propre ;
  `cd web && npm run build` réussit.

- [x] **11. Preuve E2E déterministe (sans LLM, wiki réel intact).** Sur un
  `DATA_ROOT` isolé, simuler la sortie IA (markdown de fiche) et exécuter la
  chaîne live `forceType→forceOrigin→forceDate→ingestOne` :
  - fiche `source_type: article`, sidecar SANS origin ni date → résultat
    `origin: externe` (map article), `date: "<mois courant>"` (AAAA-MM).
  - fiche `source_type: personal-notes` → `origin: interne`.
  - sidecar `origin: interne` sur une fiche `source_type: article` (contradiction)
    → `origin: interne` (déclaration gagne).
  - fiche sans `source_type` (Auto non déduit) → `forceType` met `unknown`,
    `origin: externe`.
  - sidecar `date: "2024-10"` → `date` conservée (déclarée gagne).
  Prouver via un petit script `tsx` ou un test qui appelle les fonctions et
  affiche/asserte le frontmatter final. **Vrai wiki NON touché.**

---

**Critère « ingénieur senior »** : après ce chantier, aucune fiche ne peut sortir
de l'ingestion avec une origine ou une date vide ; l'origine est une **garantie de
code** dérivée du type (déclaration prioritaire), plus une consigne confiée à
l'IA ; le type n'a plus de défaut trompeur (« Auto » explicite) ; et le backfill
/ la re-projection ne réécrivent **pas** rétroactivement le corpus existant.

---

## Bilan

**Fait — conforme à la spec, sans déviation fonctionnelle.**

- **Socle données.** `ui.ts` : `BUILTIN_TYPE_ORIGIN` (8 entrées) + `typeOriginDefault`.
  `wiki-parser.ts` : `TypeRegistryEntry` + `listTypeRegistryFull()` (compat lecture
  string/objet), `listTypeRegistry()` refactoré en dérivé de Full, + un
  **`writeTypeRegistry(entries)` partagé** (au lieu de dupliquer `writeRegistry` dans
  les deux routes — plus DRY que le croquis de la spec).
- **Moteur.** `parseSidecar` lit `origin`/`date` ; `forceType`/`forceOrigin`/`forceDate`
  + `loadTypeOriginMap` ajoutés et branchés **dans la boucle `runIngestion`** (avant
  `ingestOne`, jamais dedans — le backfill reste intact).
- **API.** `route.ts` GET (+origin) / POST `{name,origin}` ; `[slug]/route.ts` PATCH
  `{name?,origin?}` (origine inconditionnelle, rename si inutilisé) / DELETE (objets).
- **UI.** `UploadForm` : option « Auto (déduit par l'IA) » en tête + par défaut, `type`
  envoyé seulement si choisi, réconciliation/reset sur Auto, `<select>` origine à la
  création inline. `ManageTypesModal` : `<select>` origine par ligne, toujours actif.
- **Prompt & docs.** `ingest-prompt.md` (déduction Auto bornée, `origin: ""`, date
  extraite + repli mois courant, section « Heuristique origin » supprimée) ;
  `wiki-spec.md §5` réécrit (origine déterministe) ; `ingestion.md` (3 filets + Auto) ;
  `CLAUDE.md` règle 3 (types.json porte l'origine).

**Preuves exécutées.**

- `web/lib/__tests__/type-registry.test.ts` (16 ✓, dont `typeOriginDefault` +
  `listTypeRegistryFull`), `ingest-force.test.ts` (12 ✓, cascades des 3 fonctions),
  `parseSidecar` couvert dans `ingest-local.test.ts` (27 ✓).
- Suite complète : **`npm test` → 205/205 ✓** ; **`tsc --noEmit` → exit 0**.
- **Items 5 & 6** prouvés en pilotant les VRAIS handlers sur un `DATA_ROOT` isolé
  (verrou d'ingestion pré-posé = 0 coût) : sidecar sans `type:` en mode Auto,
  `type: article` sinon ; POST/GET/PATCH/DELETE registre avec origine (17 ✓).
- **Item 11 (E2E)** : chaîne live `forceType→forceOrigin→forceDate→ingestOne→applyFileOps`
  sur `DATA_ROOT` isolé, relecture du frontmatter projeté — 5 scénarios, **15/15 ✓**.
- **Build** : `next build` (Next 14.2.35) → « ✓ Compiled successfully » + types validés
  + 13 pages générées, exit 0.

**Déviations / notes d'environnement (pas de déviation de plan).**

1. **`writeTypeRegistry` partagé dans `wiki-parser.ts`** au lieu d'être dupliqué dans les
   deux routes (§B6 laissait le choix « dupliquer/partager ») — une seule source de vérité.
2. **Contexte concurrent.** Pendant le chantier, un `next dev` d'une AUTRE session tournait
   et son `web/node_modules` a été **vidé** en cours de route (les 205 tests, `tsc` et un
   1er `next build` avaient déjà réussi AVANT). Pour le build final propre et l'E2E, j'ai
   travaillé dans une **copie isolée** (`rsync` + `npm ci` dédié, `.next` propre) — le vrai
   `web/`, son `.next` et le serveur dev n'ont pas été touchés. Conséquence : le
   `web/node_modules` réel peut être à restaurer (`npm ci`) — non causé par ce chantier.
3. **Vrai wiki intact.** `wiki/types.json` réel non modifié (tous les scripts de preuve sur
   `DATA_ROOT` isolé). Les fichiers `wiki/*` en `git status` proviennent d'une autre session
   (déjà présents au démarrage) — hors de ce commit.
