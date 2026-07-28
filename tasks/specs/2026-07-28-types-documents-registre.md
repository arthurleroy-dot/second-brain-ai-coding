# Types de documents ouverts — registre créable depuis l'UI

## Contexte

**Demande d'origine (utilisateur).** Pouvoir **créer de nouveaux types de
documents** (aujourd'hui : `article`, `note personnelle`, `rapport pdf`…)
**directement dans le menu déroulant** de la page de dépôt (« la scrollbar dans
la page de Claude » = `/upload`). Le nouveau type doit ensuite apparaître
**automatiquement** partout : dans le **graphe**, dans les **filtres**, dans la
**page /explore**, avec une **synchronisation** entre les filtres des ressources
(`/sources`) et ce qui est proposé au dépôt. L'utilisateur a aussi signalé un
**type fantôme** : `tweet` apparaît dans les filtres `/sources` alors qu'il
n'est proposé nulle part au dépôt et qu'aucune ressource ne l'utilise.

**Problème technique constaté (audit).** Un « type de document » n'a **aucune
source de vérité unique**. La même notion est recopiée en dur dans une dizaine
de tables, sous **deux orthographes** :

| Vocabulaire | Exemple | Où |
|---|---|---|
| `ResourceType` (web, technique) | `report_pdf` (snake) | code TS, UI |
| `source_type` (wiki) | `report-pdf` (kebab) | frontmatter des ressources, `types.md`, `graph.json` |

…reliées par des tables de traduction. Ajouter un type impose aujourd'hui de
modifier ~10 fichiers. De plus, la **lecture** est verrouillée : `normalizeType`
→ `resolveSourceType` → `SOURCE_TYPE_TO_TYPE[x] ?? 'unknown'` écrase en
`unknown` tout `source_type` absent de la table. Le système est **fermé de bout
en bout** : impossible de créer un type sans toucher au code.

**Réalité des données (mesurée).** 23 ressources, 4 `source_type` réels
seulement : `article` (7), `report-pdf` (8), `personal-notes` (7),
`meeting-notes` (1). `tweet`, `interview`, `presentation`, `transcript`,
`unknown` : **zéro** ressource. `grep -rni tweet wiki/` → 0.

**Cause du fantôme `tweet`.** `/explore`, le graphe et les cartes de thème
dérivent DÉJÀ leur liste des ressources réelles (filtre par présence). **Un seul
consommateur est cassé** : `web/components/sources/FilterBar.tsx:96` énumère la
constante en dur `ALL_TYPES` (9 valeurs, dont `tweet`) sans la confronter aux
ressources.

**Modèle cible.** Le projet possède déjà le bon patron pour les **types
d'entités** (`entity_type` : `tool`, `client`, …) : système **ouvert**, un type
inconnu retombe sur une capitalisation du slug via `entityTypeLabel`
(`web/lib/ui.ts:112`), sans table à maintenir. On applique **exactement ce
patron** aux types de documents.

---

## Plan

### A. Décision d'architecture (le cœur)

1. **Le `source_type` (slug kebab) devient l'identité canonique unique**, partout
   (frontmatter, graphe, filtres, URL, UI). On **supprime** le vocabulaire
   `ResourceType` snake et ses tables de traduction. `ResourceType` devient un
   **alias `string`** (churn minimal : toutes les annotations `ResourceType`
   compilent encore, mais la valeur portée est désormais le slug kebab brut).

2. **Aucune migration de données wiki.** Les ressources stockent déjà
   `source_type: report-pdf` (kebab), les nœuds de graphe sont déjà
   `type:report-pdf`, les headings de `types.md` sont déjà en kebab. **Seul le
   code change.** Effet de bord voulu : `Source.type` contient désormais le slug
   kebab (`report-pdf`) là où il contenait le snake (`report_pdf`).

3. **`typeLabel(slug)` et `typeBadgeClass(slug)` deviennent des fonctions PURES
   du slug** (client-safe, synchrones, zéro dépendance registre/fs), sur le
   modèle de `entityTypeLabel` :
   - **Libellé** : table d'overrides pour les types intégrés (libellés FR curés)
     + **repli par dérivation du slug** pour les types créés (`podcast` →
       `Podcast`, `note-de-veille` → `Note de veille`).
   - **Couleur** : table d'overrides pour les intégrés (couleurs actuelles
     conservées) + **palette assignée par hash déterministe du slug** pour les
     nouveaux. Conséquence : un type donné a **toujours** le même libellé et la
     même couleur partout, sans stockage.

4. **Registre `wiki/types.json`** = **la liste des slugs de types créés par
   l'utilisateur** (les intégrés vivent dans une constante, pas dans le fichier).
   Forme : `{ "types": ["podcast", "veille", ...] }`. Fichier **absent au
   départ** (aucun seed nécessaire). Voyage avec le wiki. Écrit **uniquement**
   via `applyFileOps` (garde-fou `web/lib/wiki-fs.ts` : seuls `wiki/` et `raw/`
   autorisés — `wiki/types.json` passe).
   - **Registre effectif** (pour le menu de dépôt) = `BUILTIN_TYPE_SLUGS ∪ fichier`,
     dédoublonné.
   - **Créer** un type = ajouter son slug au fichier.
   - **Supprimer** un type = retirer son slug du fichier (donc un intégré, jamais
     dans le fichier, n'est jamais supprimable — invariant gratuit).

5. **Filtres / /explore / graphe = dérivés des ressources réelles** (règle
   confirmée avec l'utilisateur : un type non utilisé n'apparaît PAS dans les
   filtres ; il apparaît dès qu'une ressource l'utilise). `tweet` disparaît
   mécaniquement (aucune ressource). Le registre ne pilote QUE le menu de dépôt.

### B. `web/lib/ui.ts` — le nouveau centre

Remplacer les tables snake par une résolution slug-native.

```ts
// Slugs intégrés (kebab = vocabulaire wiki). Seed du menu de dépôt. tweet RETIRÉ.
export const BUILTIN_TYPE_SLUGS = [
  'article', 'report-pdf', 'personal-notes', 'meeting-notes',
  'interview', 'presentation', 'transcript', 'unknown',
] as const;

// Libellés FR curés des intégrés (les seuls non dérivables du slug).
const TYPE_LABEL_OVERRIDES: Record<string, string> = {
  article: 'Article',
  'report-pdf': 'Rapport PDF',
  'personal-notes': 'Note perso',
  'meeting-notes': 'Réunion',
  interview: 'Interview',
  presentation: 'Présentation',
  transcript: 'Transcript',
  unknown: 'Inconnu',
};

/** Libellé d'un source_type (slug kebab). Override curé, sinon dérivation du slug. */
export function typeLabel(slug: string): string {
  const s = (slug ?? '').trim();
  if (!s) return 'Inconnu';
  if (TYPE_LABEL_OVERRIDES[s]) return TYPE_LABEL_OVERRIDES[s];
  const t = s.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Couleurs curées des intégrés (Tailwind bg+texte). Reprise EXACTE de l'actuel
// TYPE_BADGE, re-clés en kebab.
const TYPE_BADGE_OVERRIDES: Record<string, string> = {
  'meeting-notes': 'bg-[#E1F5EE] text-[#0F6E56]',
  article: 'bg-blue-50 text-blue-700',
  'report-pdf': 'bg-[#EAF0FB] text-[#2952A3]',
  interview: 'bg-[#FAEEDA] text-[#633806]',
  presentation: 'bg-[#FBEAF0] text-[#993556]',
  transcript: 'bg-violet-50 text-violet-700',
  'personal-notes': 'bg-slate-100 text-slate-700',
  unknown: 'bg-orange-50 text-orange-700',
};

// Palette de repli pour les types créés — classes LITTÉRALES (Tailwind JIT doit
// les voir en clair dans le source ; NE PAS interpoler).
const TYPE_BADGE_PALETTE = [
  'bg-emerald-50 text-emerald-700',
  'bg-sky-50 text-sky-700',
  'bg-amber-50 text-amber-700',
  'bg-rose-50 text-rose-700',
  'bg-indigo-50 text-indigo-700',
  'bg-teal-50 text-teal-700',
  'bg-fuchsia-50 text-fuchsia-700',
  'bg-lime-50 text-lime-700',
];

function hashSlug(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Classe badge d'un source_type. Override curé, sinon palette par hash du slug. */
export function typeBadgeClass(slug: string): string {
  const s = (slug ?? '').trim();
  if (TYPE_BADGE_OVERRIDES[s]) return TYPE_BADGE_OVERRIDES[s];
  return TYPE_BADGE_PALETTE[hashSlug(s || 'unknown') % TYPE_BADGE_PALETTE.length];
}
```

**Supprimer de `ui.ts`** : `TYPE_LABELS`, `TYPE_BADGE`, `SOURCE_TYPE_TO_TYPE`,
`resolveSourceType`, `TYPE_TO_FOLDER`, `ALL_TYPES`. (Garder `ORIGIN_*`,
`entityTypeLabel`, `formatDate`.)

> **Nota Tailwind.** Les classes de `TYPE_BADGE_PALETTE` doivent apparaître en
> chaînes littérales dans le source pour être incluses au build. Si un doute
> subsiste, les ajouter au `safelist` de `web/tailwind.config.*`. Vérifier
> qu'un badge de type créé est bien coloré (cf. Todo).

### C. `web/types/index.ts`

- Remplacer le type union `ResourceType` (lignes 1-10) par : `export type
  ResourceType = string;` (avec commentaire : « slug `source_type` kebab, ex.
  `report-pdf` ; open set piloté par le registre `wiki/types.json` »).
- `Source.type`, `TypeEntry.type` restent typés `ResourceType` (= `string`).
  `TypeEntry.folder` reste `string` (vaudra désormais le slug lui-même).

### D. `web/lib/wiki-parser.ts`

- `normalizeType` (l.57-59) : **arrêter d'écraser**. Nouvelle version :
  ```ts
  function normalizeType(rawType: unknown): string {
    const s = typeof rawType === 'string' ? rawType.trim() : '';
    return s || 'unknown';
  }
  ```
  (Retirer l'import `resolveSourceType`.)
- `listTypes()` (l.215-228) : **dériver** sans `ALL_TYPES`/`TYPE_TO_FOLDER` :
  ```ts
  export async function listTypes(): Promise<TypeEntry[]> {
    const sources = await listAllSources();
    const counts = new Map<string, number>();
    for (const s of sources) {
      const t = s.type || 'unknown';
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([t, n]) => ({ type: t, folder: t, label: typeLabel(t), source_count: n }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  ```
- **Ajouter** le lecteur de registre (client NON — serveur, lit le fs) :
  ```ts
  import { BUILTIN_TYPE_SLUGS } from '@/lib/ui';
  /** Slugs de types connus = intégrés ∪ registre utilisateur (wiki/types.json). */
  export async function listTypeRegistry(): Promise<string[]> {
    const content = await readWikiFile('types.json'); // '' si absent
    let user: string[] = [];
    if (content.trim()) {
      try {
        const j = JSON.parse(content);
        if (Array.isArray(j?.types)) user = j.types.map((x: unknown) => String(x).trim()).filter(Boolean);
      } catch { /* fichier illisible → ignore, on garde les intégrés */ }
    }
    return [...new Set([...BUILTIN_TYPE_SLUGS, ...user])];
  }
  ```
- Retirer les imports devenus inutiles (`ALL_TYPES`, `TYPE_TO_FOLDER`,
  `resolveSourceType`).

### E. Chaîne d'ingestion / moteur déterministe (slug-native, quasi inchangée)

Le moteur clé déjà tout sur `source_type` brut. Il ne reste qu'à supprimer les
traductions snake↔kebab.

- `web/app/api/upload/route.ts` :
  - **Supprimer** `TYPE_TO_SOURCE_TYPE` (l.13-23).
  - l.197-198 : la valeur du champ `type` du formulaire est **déjà** le slug
    kebab (le menu envoie le slug). Remplacer par :
    ```ts
    const sourceType = slugify(field(form, 'type') ?? '') || 'unknown';
    ```
    (`slugify` existe déjà l.45-52. Le sidecar écrit alors `type: <slug>`.)
- `web/lib/ingest-local.ts` :
  - **Supprimer** `WIKI_TYPE_TO_RT` (l.555-564). Remplacer l.565 par :
    ```ts
    export const wikiTypeLabel = (t: string) => typeLabel(t);
    ```
    (ou brancher directement `typeLabel` là où `wikiTypeLabel` est injecté :
    l.927 et l.980.)
  - l.982 `typeOrder: ALL_TYPES.map((t) => typeLabel(t))` : `ALL_TYPES` n'existe
    plus. Remplacer par un ordre dérivé du registre :
    ```ts
    typeOrder: (await listTypeRegistry()).map((t) => wikiTypeLabel(t)),
    ```
    (importer `listTypeRegistry` depuis `@/lib/wiki-parser` ; `rebuildDerivedIndexes`
    est déjà `async`.) Le tri de `buildIndex` retombe en alpha pour un label hors
    liste — donc robuste même si un type manque.
  - Retirer l'import `ALL_TYPES` (garder `typeLabel`).
- `web/app/api/sources/[slug]/route.ts` : **doublon** de `WIKI_TYPE_TO_RT`
  (l.14-23) + `wikiTypeLabel` (l.24). Remplacer par un `wikiTypeLabel = (t) =>
  typeLabel(t)` (import depuis `@/lib/ui`) ; supprimer la table.
- `web/scripts/wiki-backfill-topics.ts:72` : utilise aussi un `wikiTypeLabel` —
  aligner (import `typeLabel`, ou la version exportée d'`ingest-local`).
- `web/lib/wiki-project.ts` (l.478) et `web/lib/wiki-mutate.ts` (l.920) : **rien
  à changer** — ils reçoivent `typeLabel: (sourceType) => string` en paramètre
  injecté et clé déjà sur `card.source_type`/`meta.source_type` bruts.

### F. Filtres dérivés (sync `/sources` ↔ réalité) + graphe

- `web/components/sources/FilterBar.tsx` (le bug, l.6/90-101) : dériver les
  types de la prop `sources` (déjà reçue), comme le composant fait déjà pour
  `authors`/`dates`. Remplacer le `<select>` type :
  ```tsx
  const types = Array.from(new Set(sources.map((s) => s.type).filter(Boolean)))
    .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
  // …
  <option value="">Tous les types</option>
  {types.map((t) => (
    <option key={t} value={t}>{typeLabel(t)}</option>
  ))}
  ```
  Import : `typeLabel` seul (retirer `ALL_TYPES`, `TYPE_TO_FOLDER`). Valeur du
  filtre = le slug.
- `web/components/sources/SourceList.tsx` (l.6-7, l.46) : la valeur du filtre est
  désormais le slug = `s.type`. Simplifier :
  ```tsx
  if (type && s.type !== type) return false;
  ```
  Retirer l'import `TYPE_TO_FOLDER` et `ResourceType`.
- `web/components/wiki/TopicCard.tsx` (l.6, l.17-20) : itérer les slugs présents
  au lieu d'`ALL_TYPES` :
  ```tsx
  const counts = Array.from(new Set(topic.sources.map((s) => s.type)))
    .map((t) => ({ type: t, n: topic.sources.filter((s) => s.type === t).length }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n || typeLabel(a.type).localeCompare(typeLabel(b.type)));
  ```
  Import : `typeLabel, typeBadgeClass` (retirer `ALL_TYPES`). Retirer le cast
  `as ResourceType`.
- `web/components/graph/GraphView.tsx` (l.6, l.64) : le lien de nœud type
  construisait `/sources?type=${resolveSourceType(slug)}` (kebab→snake). La
  valeur du filtre est maintenant le slug kebab → `/sources?type=${slug}`.
  Retirer l'import/usage `resolveSourceType`. (Le reste — couleur par genre de
  nœud — inchangé.)
- `web/lib/wiki-query.ts` :
  - `resolveType` (l.36-42) : plus de `ALL_TYPES`/`TYPE_TO_FOLDER`. Slug =
    valeur du filtre. Garder une **rétro-compat** des vieilles URLs snake :
    ```ts
    export function resolveType(value: string): string | null {
      const v = (value ?? '').trim().replace(/_/g, '-'); // report_pdf → report-pdf
      return v || null;
    }
    ```
  - `describeChatFilters` (l.49-53) : `typeLabel(resolveType(f) ?? f)` continue
    de marcher (slug → libellé).
  - l.105 `type: (s?.type as ResourceType) ?? 'unknown'` : OK (string).
  - Ajuster les imports (retirer `ALL_TYPES`, `TYPE_TO_FOLDER`).
- `web/lib/chat-filters.ts` (l.29-34) : `resolveType` renvoie un slug ; la
  comparaison `wanted.includes(s.type)` reste correcte (slug vs slug). Ajuster le
  typage `(t): t is ResourceType` → `(t): t is string`. (Aucun panneau de filtres
  manuel côté chat aujourd'hui ; ce module valide `filters.types` peuplé par le
  routage par facettes — il doit néanmoins accepter les slugs ouverts.)

### G. API du registre (nouveau)

Trois handlers, sur le modèle de `settings/route.ts` (GET+POST fichier de
config) et `themes/[slug]/route.ts` (DELETE déterministe via `applyFileOps`).

- **`web/app/api/types/route.ts`** :
  - `GET` → `[{ slug, label, source_count, builtin }]` :
    ```ts
    import { listTypeRegistry, listTypes } from '@/lib/wiki-parser';
    import { BUILTIN_TYPE_SLUGS, typeLabel } from '@/lib/ui';
    export async function GET() {
      const [slugs, inUse] = await Promise.all([listTypeRegistry(), listTypes()]);
      const counts = new Map(inUse.map((t) => [t.type, t.source_count]));
      const builtin = new Set<string>(BUILTIN_TYPE_SLUGS);
      const types = slugs
        .map((s) => ({ slug: s, label: typeLabel(s), source_count: counts.get(s) ?? 0, builtin: builtin.has(s) }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return Response.json({ types });
    }
    ```
  - `POST` (créer) → body `{ name: string }` :
    - `slug = slugify(name)` (réutiliser `slugify` de `wiki-parser`), valider
      `/^[a-z0-9-]+$/` non vide.
    - Charger le fichier courant (`readWikiFile('types.json')`), parser `types`.
    - Si `slug ∈ BUILTIN_TYPE_SLUGS` ou déjà dans `types` → **409** `{ error:
      'Ce type existe déjà' }`.
    - Sinon `applyFileOps([{ path: 'wiki/types.json', content:
      JSON.stringify({ types: [...user, slug] }, null, 2) + '\n' }])`.
    - Retour `{ ok: true, slug, label: typeLabel(slug) }`.
- **`web/app/api/types/[slug]/route.ts`** :
  - `DELETE` → garde-fous :
    - `slug` valide `/^[a-z0-9-]+$/` sinon 400.
    - Si `slug ∈ BUILTIN_TYPE_SLUGS` → **403** `{ error: 'Type intégré non
      supprimable' }`.
    - Recompter via `listTypes()` : si `source_count > 0` → **409** `{ error:
      'N ressource(s) utilisent ce type' }` (jamais casser une ressource).
    - Sinon retirer le slug du fichier et réécrire via `applyFileOps`.
      (Aucune vue dérivée à toucher : un type à 0 ressource n'a ni ligne
      `types.md`, ni nœud graphe.)
    - Retour `{ ok: true }`.

### H. UI de dépôt — création dans la scrollbar (`UploadForm.tsx`)

- **Supprimer** `PASTE_TYPES`/`UPLOAD_TYPES` (l.18-35) et la logique de
  ré-alignement par mode dans `switchMode` (l.116-122 : garder le `setMode` +
  `setError`, retirer le realign du type). Un **seul** menu, alimenté par le
  registre, dans les deux onglets. (Décision : la distinction paste/upload des
  listes de types est abandonnée — un type créé n'a pas de mode ; une liste
  unique est plus cohérente. Réversible.)
- Charger le registre au montage :
  ```tsx
  const [types, setTypes] = useState<{ slug: string; label: string }[]>([]);
  const loadTypes = useCallback(() => {
    fetch('/api/types').then((r) => r.json())
      .then((d) => setTypes(d.types ?? [])).catch(() => {});
  }, []);
  useEffect(() => { loadTypes(); }, [loadTypes]);
  ```
- `type` (état) initialisé à `'article'` (slug intégré) — OK.
- Le `<select>` (l.364-377) rend `types` + une option sentinelle **« + Nouveau
  type… »** (`value="__new__"`). `onChange` :
  - si `__new__` → ouvrir une **ligne de création inline** sous le select (input
    texte + boutons « Créer »/« Annuler ») ; ne PAS changer `type`.
  - sinon `setType(value)`.
- Création inline : `POST /api/types { name }`. Au succès → `loadTypes()` puis
  `setType(data.slug)` et refermer la ligne. Sur 409 → afficher « existe déjà »
  et, si le slug existe déjà dans `types`, le sélectionner quand même.
  Validations UI : nom non vide ; désactiver « Créer » sinon.
- `<label>` « Type » : ajouter à droite, sur la même ligne, un petit lien gris
  **« Gérer les types »** (`type="button"`) qui ouvre `ManageTypesModal` (cf. I).
  Après fermeture de la modale → `loadTypes()` (un type supprimé disparaît du
  menu ; si le type courant a été supprimé, retomber sur `types[0]?.slug ??
  'unknown'`).
- Import : `typeLabel` n'est plus nécessaire pour le rendu des options (le
  registre fournit déjà `label`), mais reste utile ailleurs — ajuster au besoin.

### I. UI de gestion — `ManageTypesModal.tsx` (nouveau, calqué sur `DeleteThemeModal`)

`web/components/upload/ManageTypesModal.tsx` (client). Overlay + carte, mêmes
classes que `DeleteThemeModal` (fermeture Escape/clic overlay, état `busy`).

- Au montage : `GET /api/types` → liste `{ slug, label, source_count, builtin }`.
- Rendu : une ligne par type = `label` + `× N` (source_count) + à droite :
  - `builtin === true` ou `source_count > 0` → icône **cadenas** (`Lock`,
    lucide), non cliquable, `title` explicatif.
  - sinon → icône **corbeille** (`Trash2`) → `DELETE /api/types/<slug>` ; au
    succès, retirer la ligne de l'état local. Confirmation légère (le geste
    supprime seulement un type à 0 ressource : pas de casse ; une confirmation
    inline « Confirmer ? » suffit, pas besoin d'une 2ᵉ modale).
- Prop `onClose()` ; la fermeture déclenche `loadTypes()` côté `UploadForm`.

### J. Prompt d'ingestion (`prompts/ingest-prompt.md` + injection)

- `prompts/ingest-prompt.md:40-41` : l'enum figé (`article | report-pdf | tweet
  | …`) devient une consigne ouverte :
  ```
  - `source_type` (slug kebab, non quoté) : reprends VERBATIM celui du sidecar
    (fait autorité). Sans sidecar, choisis un type existant si l'un convient ;
    un slug inédit est autorisé (kebab, minuscules).
  ```
- **Injection dynamique** (robustesse : éviter que l'IA « corrige » un type
  inédit). Dans `web/lib/ingest-local.ts`, après lecture de `staticPrompt`
  (l.1083), append une ligne listant le registre courant :
  ```ts
  const known = (await listTypeRegistry()).join(', ');
  const systemPrompt = `${staticPrompt}\n\nTypes de ressource connus (registre) : ${known}.`;
  ```
  et passer `systemPrompt` (au lieu de `staticPrompt`) à l'appel IA (l.480/488).
  Le sidecar restant autoritaire, le flux normal (dépôt via UI) écrit toujours
  le bon slug.

### K. Tests & docs

- **Tests unitaires** (`node --test`, cf. `web/package.json` → `npm test`).
  Fichiers `__tests__` qui injectent un `typeLabel` factice
  (`wiki-project.test.ts`, `wiki-mutate.test.ts`, `wiki-index.test.ts`) : ils
  passent un stub `(t) => …` — inchangés dans leur principe, mais vérifier
  qu'aucun n'importe `ALL_TYPES`/`TYPE_TO_FOLDER`/`resolveSourceType` supprimés.
  `chat-filters.test.ts` (l.84 « résolution dossier → ResourceType ») : adapter
  aux slugs (un cas `report_pdf` → `report-pdf` via la rétro-compat de
  `resolveType`).
- **Nouveau test** `web/lib/__tests__/type-registry.test.ts` (ou étendre) :
  - `typeLabel('podcast') === 'Podcast'`, `typeLabel('report-pdf') === 'Rapport
    PDF'`, `typeLabel('note-de-veille') === 'Note de veille'`.
  - `typeBadgeClass('report-pdf')` = override connu ; `typeBadgeClass('podcast')`
    = une entrée de palette **stable** (même valeur à deux appels).
  - `listTypeRegistry()` : intégrés présents même sans fichier ; union avec un
    faux `wiki/types.json` (mock fs si nécessaire — sinon test ciblé sur la
    logique de merge extraite en helper pur).
- **Docs** : mettre à jour
  - `docs/wiki-spec.md:63` (enum `source_type`) et `docs/ingestion.md:62` :
    mentionner que les types sont un **registre ouvert** (`wiki/types.json`),
    plus une liste figée.
  - `CLAUDE.md` règle 3 (« tout le reste sous wiki/ est dérivé ») : ajouter
    l'exception `wiki/types.json` = **registre canonique** (comme les registres
    thèmes/entités), non dérivé.
  - `tasks/lessons.md` si une correction émerge en cours de route.

---

## Décisions

1. **Ambition : registre complet, pas correctif ciblé.** (Choisi par
   l'utilisateur.) Alternative écartée : réparer seulement `FilterBar` + unifier
   les listes de dépôt (~10× moins de travail) mais ajouter un type resterait
   une modif de code. Rejetée car la demande centrale est la création depuis
   l'UI. Le correctif ciblé est de toute façon **inclus** (filtres dérivés).

2. **Slug kebab = identité canonique unique ; `ResourceType` → `string`.**
   Alternative écartée : garder l'enum snake et ajouter un registre parallèle
   pour les types « custom ». Rejetée : deux systèmes = bricolage, et laisse la
   double orthographe. Le refactor **supprime** de la complexité (3 tables de
   traduction, un enum fermé) au lieu d'en ajouter.

3. **Libellé/couleur = fonctions pures du slug** (overrides intégrés + repli
   dérivation/hash), sur le modèle `entityTypeLabel` existant. Alternative
   écartée : stocker libellé + couleur par type dans le registre et les diffuser
   au client (contexte/props). Rejetée : machinerie client lourde, risque de
   drift ; la dérivation suffit et garantit la cohérence partout sans stockage.
   Conséquence assumée : un libellé de type créé perd les majuscules internes
   (`API Reviews` → `Api reviews`) — acceptable en v1, cohérent avec les entités.

4. **Filtres/explore/graphe dérivés des ressources en usage** (pas du registre).
   (Choisi par l'utilisateur.) Alternative écartée : piloter les filtres par le
   registre (un type créé apparaît même à 0 ressource). Rejetée : recrée
   exactement des « fantômes » comme `tweet`.

5. **Création = juste un nom.** (Choisi.) Slug + couleur auto. Alternative
   écartée : demander aussi une couleur (friction, écran plus lourd).

6. **Gestion = créer + supprimer un type inutilisé**, via lien « Gérer les
   types » **accolé au champ Type** de `/upload` + mini-modale (réutilise le
   patron `DeleteThemeModal`). (Choisi.) Alternatives écartées : tout mettre dans
   `/reglages` (gestion loin du moment de dépôt) ; création seule sans
   suppression (une faute de frappe resterait à vie). **Renommer un libellé =
   hors périmètre** (slug immuable — règle cardinale 5 ; une faute se corrige par
   suppression + recréation).

7. **Registre `wiki/types.json` = slugs utilisateur seulement** ; les intégrés
   vivent dans `BUILTIN_TYPE_SLUGS`. Le fichier est **absent au départ** (pas de
   seed/migration). Alternative écartée : écrire tous les intégrés dans le
   fichier au premier lancement (étape de migration en plus, et rend un intégré
   « supprimable » par erreur).

8. **`tweet` disparaît sans action spéciale** : exclu de `BUILTIN_TYPE_SLUGS`
   (donc absent du menu), et les filtres étant dérivés, il n'apparaît plus nulle
   part (0 ressource).

9. **Menu de dépôt unique (fin de la distinction paste/upload des types).**
   Alternative écartée : conserver des sous-listes par mode (impossible pour les
   types créés sans métadonnée « mode applicable » → complexité). Réversible.

10. **`unknown` conservé** comme type intégré (libellé/couleur résolus, proposé
    au dépôt comme aujourd'hui en mode upload) — repli quand aucun type n'est
    déterminé.

---

## Hors périmètre

- **Renommer le libellé d'un type** (slug immuable ; correction = supprimer +
  recréer). À rouvrir plus tard si besoin (nécessiterait un champ `label` dans le
  registre + priorité sur les overrides/dérivation).
- **Supprimer / fusionner un type intégré** (`article`, `report-pdf`, …).
- **Panneau de filtres manuel par type dans le chat** : n'existe pas
  aujourd'hui (facettes pilotées par l'agent) ; on met seulement à jour
  `chat-filters.ts`/`wiki-query.ts` pour qu'ils acceptent les slugs ouverts. Pas
  de nouvelle UI de filtre chat.
- **Migration des données wiki** : aucune (les `source_type` sont déjà en kebab).
- **Réassigner en masse le type de ressources existantes** depuis l'UI.
- **Couleur/icône personnalisée par type** choisie par l'utilisateur.
- **Distinction paste/upload par type** (abandonnée, cf. Décision 9).

---

## Todo

> Le refactor casse temporairement la compilation (suppression d'`ALL_TYPES`
> etc.) tant que tous les consommateurs ne sont pas migrés. Faire B→F d'un bloc,
> puis compiler. Vérification finale globale à la fin.

- [x] **1. `ui.ts` slug-native.** Ajouter `BUILTIN_TYPE_SLUGS`,
  `TYPE_LABEL_OVERRIDES`, `TYPE_BADGE_OVERRIDES`, `TYPE_BADGE_PALETTE`,
  `hashSlug`, réécrire `typeLabel`/`typeBadgeClass`. Supprimer `TYPE_LABELS`,
  `TYPE_BADGE`, `SOURCE_TYPE_TO_TYPE`, `resolveSourceType`, `TYPE_TO_FOLDER`,
  `ALL_TYPES`.
  **Vérif** : test unitaire `typeLabel('podcast')==='Podcast'`,
  `typeLabel('report-pdf')==='Rapport PDF'`, `typeBadgeClass('podcast')` stable
  entre deux appels (ajouter à `type-registry.test.ts`, l'exécuter seul :
  `cd web && node --import tsx --test lib/__tests__/type-registry.test.ts`).

- [x] **2. `types/index.ts`.** `ResourceType = string` (+ commentaire).
  **Vérif** : `grep -n "ResourceType =" web/types/index.ts` montre l'alias
  string ; plus d'union figée.

- [x] **3. `wiki-parser.ts`.** `normalizeType` pass-through ; `listTypes()`
  dérivé sans `ALL_TYPES`/`TYPE_TO_FOLDER` ; ajouter `listTypeRegistry()`.
  **Vérif** : `listTypeRegistry()` renvoie les 8 intégrés quand `wiki/types.json`
  est absent ; `listTypes()` ne renvoie QUE les 4 types réellement présents
  (test ou log ponctuel).

- [x] **4. Ingestion & moteur.** `upload/route.ts` (drop `TYPE_TO_SOURCE_TYPE`,
  `sourceType = slugify(type)`), `ingest-local.ts` (drop `WIKI_TYPE_TO_RT`,
  `wikiTypeLabel = typeLabel`, `typeOrder` via `listTypeRegistry`),
  `sources/[slug]/route.ts` (drop doublon), `scripts/wiki-backfill-topics.ts`.
  **Vérif** : (après build OK) déposer un fichier de type `article` → la
  ressource générée porte `source_type: article` et l'index/graph/types.md sont
  cohérents (cf. vérif finale E2E).

- [x] **5. Filtres & graphe dérivés.** `FilterBar` (dérive de `sources`),
  `SourceList` (`s.type !== type`), `TopicCard` (slugs distincts), `GraphView`
  (`?type=${slug}`), `wiki-query.resolveType` (+ rétro-compat `_`→`-`),
  `chat-filters` (typage string).
  **Vérif** : lancer l'app (`cd web && npm run dev`), ouvrir `/sources` → le menu
  « type » ne contient QUE `Article, Rapport PDF, Note perso, Réunion`
  (4 présents), **plus de `Tweet`**. Cliquer un type filtre bien la liste.

- [x] **6. API registre.** `GET/POST /api/types`, `DELETE /api/types/[slug]`
  avec garde-fous (builtin 403, en-usage 409, doublon 409).
  **Vérif** : `curl -s localhost:3000/api/types` liste les types + `builtin` +
  `source_count` ; `curl -XPOST -H 'content-type: application/json' -d
  '{"name":"Podcast"}' localhost:3000/api/types` → `{ok,slug:"podcast"}` et
  crée/complète `wiki/types.json` ; re-POST « Podcast » → 409 ; `curl -XDELETE
  localhost:3000/api/types/article` → 403 ; `curl -XDELETE
  localhost:3000/api/types/podcast` → `{ok}` et retire le slug du fichier.

- [x] **7. UI dépôt.** `UploadForm` : menu unique alimenté par `/api/types`,
  option « + Nouveau type… » + création inline (`POST`), lien « Gérer les
  types ». Drop `PASTE_TYPES`/`UPLOAD_TYPES` + realign par mode.
  **Vérif** (dev) : sur `/upload`, choisir « + Nouveau type… », taper « Podcast »,
  Créer → « Podcast » devient l'option sélectionnée et persiste après reload
  (via `wiki/types.json`).

- [x] **8. UI gestion.** `ManageTypesModal` + branchement du lien « Gérer les
  types » ; corbeille active seulement pour type non-intégré à 0 ressource,
  cadenas sinon.
  **Vérif** (dev) : ouvrir « Gérer les types » → `Article` et les autres
  intégrés montrent un cadenas ; `Podcast` (0 ressource) montre une corbeille ;
  supprimer `Podcast` → disparaît du menu de dépôt.

- [x] **9. Prompt d'ingestion.** Enum figé → consigne ouverte
  (`ingest-prompt.md`) + injection dynamique du registre dans `ingest-local.ts`.
  **Vérif** : `grep -n "registre" prompts/ingest-prompt.md`… non — vérifier que
  le system prompt effectif contient « Types de ressource connus (registre) : … »
  (log ponctuel du `systemPrompt` en dev lors d'un dépôt).

- [x] **10. E2E complet du nouveau type** (la preuve centrale, en `npm run dev`) :
  créer le type « Podcast » au dépôt → déposer un document de type « Podcast »
  (mode coller, petit texte) → attendre la fin d'ingestion → vérifier que
  « Podcast » apparaît **(a)** dans le filtre `/sources` (badge coloré + libellé),
  **(b)** dans `/explore`, **(c)** dans le graphe (`/api/graph` contient un nœud
  `type:podcast` label « Podcast » + une arête `has_type`), **(d)** dans
  `wiki/types.md` (heading `## podcast (1 ressource)`). Puis vérifier qu'un type
  créé mais **non utilisé** (« Podacst » de test) reste **absent** des filtres et
  du graphe, et **supprimable** via « Gérer les types ».

- [x] **11. Tests & typecheck.** Adapter `chat-filters.test.ts` +
  `wiki-*` tests (imports supprimés) ; ajouter `type-registry.test.ts`.
  **Vérif** : `cd web && npm test` vert ; `cd web && npx tsc --noEmit` sans
  erreur ; `cd web && npm run build` réussit (confirme le safelist Tailwind des
  badges de palette).

- [x] **12. Docs & lessons.** `docs/wiki-spec.md` + `docs/ingestion.md`
  (registre ouvert) ; `CLAUDE.md` règle 3 (exception `wiki/types.json`) ;
  `tasks/lessons.md` si correction émergée.
  **Vérif** : relecture ; `grep -rn "types.json" docs CLAUDE.md` renvoie les
  mentions ajoutées.

---

**Critère « ingénieur senior »** : après ce chantier, ajouter un type de
document ne touche **aucun** fichier de code (une entrée dans `wiki/types.json`
via l'UI suffit) ; il n'existe **plus qu'un seul vocabulaire** (slug kebab) et
**aucune** liste de types codée en dur consommée sans être confrontée aux
ressources réelles.

---

## Bilan

**Fait (les 12 items cochés).** `source_type` (slug kebab) est désormais l'identité
unique : `ResourceType = string`, `typeLabel`/`typeBadgeClass` sont des fonctions PURES
du slug (overrides intégrés + dérivation/palette-par-hash), toutes les tables de
traduction snake↔kebab supprimées (`TYPE_LABELS`, `TYPE_BADGE`, `SOURCE_TYPE_TO_TYPE`,
`resolveSourceType`, `TYPE_TO_FOLDER`, `ALL_TYPES`, `TYPE_TO_SOURCE_TYPE`, les deux
`WIKI_TYPE_TO_RT`). Registre ouvert `wiki/types.json` (lecteur `listTypeRegistry`), API
`GET/POST /api/types` + `DELETE /api/types/[slug]` avec garde-fous (doublon 409, intégré
403, en-usage 409). Filtres/graphe/`/explore` dérivés des ressources réelles → `tweet`
fantôme éliminé. UI dépôt : menu unique alimenté par le registre + création inline
« + Nouveau type… » + `ManageTypesModal` (lien « Gérer les types »). Prompt d'ingestion :
enum figé → consigne ouverte + injection dynamique du registre. Docs + `CLAUDE.md` règle 3
+ 2 leçons.

**Preuves (sans coût LLM, vrai wiki intact).**
- `tsc --noEmit` **clean** ; `npm test` **184/184 vert** (dont 8 nouveaux `type-registry`
  + `chat-filters` adaptés aux slugs).
- **Build de prod isolé** (copie `rsync` + `.next` propre) **réussi** : compilé, types OK,
  13/13 pages, routes `/api/types` + `/api/types/[slug]` présentes, aucune erreur Tailwind.
- **API** prouvée en pilotant les VRAIS handlers sur un `DATA_ROOT` isolé : POST crée +
  écrit `types.json` ; re-POST → 409 ; intégré → 403 ; type créé en usage → 409 ; créé
  inutilisé → supprimé et retiré du fichier.
- **E2E déterministe** (isolé, sans IA) via `ingestOne(markdown source_type: podcast)` :
  `listTypes` → `podcast (source_count 1)`, nœud graphe `type:podcast` label « Podcast » +
  arête `has_type`, heading `## podcast (1 ressource)` dans `types.md`.
- **Injection prompt** vérifiée : ligne effective `Types de ressource connus (registre) :
  article, report-pdf, …`.

**Déviations assumées.**
1. **Tailwind : cause racine ≠ safelist.** Le plan envisageait un `safelist` « en cas de
   doute ». En vérifiant, j'ai trouvé la vraie cause : `content` ne listait QUE
   `app/**`+`components/**`, donc AUCUNE classe de `lib/ui.ts` n'était générée — même les
   overrides existants (`bg-[#EAF0FB]`…) étaient absents du CSS compilé. Correctif racine :
   ajouter `./lib/**/*.{ts,tsx}` au `content` (corrige AUSSI le bug latent des badges
   intégrés). Prouvé via la CLI `tailwindcss` + le build isolé. (Leçon consignée.)
2. **Preuve sans `npm run dev` réel.** L'item 10 prévoyait un vrai dépôt en dev (appel LLM
   payant + mutation du vrai wiki). Écarté car (a) un `next dev` **concurrent** tournait sur
   `.next` (le corrompre est interdit, cf. `lessons.md` 2026-07-21), (b) coût + pollution du
   vrai wiki. Remplacé par : handlers réels sur `DATA_ROOT` isolé + moteur déterministe via
   `ingestOne` + build isolé. Le câblage React (UploadForm/ManageTypesModal) est
   type-checké et inclus dans le build réussi ; non piloté en navigateur (CDP) pour ne pas
   interférer avec la session concurrente, tous ses appels d'API étant déjà prouvés.
3. **Session concurrente.** Une autre session Claude éditait/commitait le streaming du chat
   (`ChatWindow.tsx`… → commit `24258de`) pendant le chantier — `tsc` a bronché
   ponctuellement sur SES fichiers. Mon périmètre et mon commit sont **cadrés sur mes
   fichiers** ; les fichiers d'un autre chantier encore non commités (thèmes/`wiki-mutate`)
   sont laissés intacts.
4. **Nettoyage mineur** : 2 commentaires obsolètes citant `ALL_TYPES` mis à jour dans
   `wiki-index.ts` (le symbole n'existe plus).

**Non couvert (conforme au périmètre).** Renommer un libellé de type (slug immuable),
supprimer/fusionner un intégré, filtre-type manuel dans le chat, migration de données
(inutile — `source_type` déjà en kebab).

## Addendum 2026-07-28 — Retours de test (règle unique + fix Annuler)

Après test par Arthur, trois retours ont fait ÉVOLUER la conception (deux points « non
couverts » ci-dessus sont finalement intégrés) :

1. **Fin des types « intégrés » permanents.** Les 8 types de graine étaient
   indéboulonnables (cadenas UI + `403` sur DELETE) même à 0 ressource → Arthur ne pouvait
   pas retirer les types vides qu'il n'utilise pas. Remplacé par **une règle unique** :
   *un type est renommable ET supprimable tant qu'aucune ressource ne le porte ; dès qu'≥1
   ressource l'utilise, son slug est figé* (cardinale #5). `BUILTIN_TYPE_SLUGS` devient une
   simple **graine** ; `wiki/types.json` devient la liste **complète** du menu, autoritaire
   dès qu'elle est non vide (fin de l'union → un type retiré ne repousse pas). Chaque
   mutation réécrit la liste effective entière (matérialise la graine au 1er changement).
   Impacts : `wiki-parser.listTypeRegistry` (sémantique fichier-ou-graine), API POST/DELETE
   rebasées sur la liste effective, garde-fou `403 intégré` **retiré**.
2. **Renommage** (nouveau `PATCH /api/types/[slug]`). Renomme un type inutilisé en
   échangeant son slug (position préservée) ; `409` si utilisé. Le libellé RESTE une
   fonction pure du slug (pas de label stocké) → renommer un type *déjà utilisé* resterait
   impossible sans réécrire tous les documents + le graphe : **limite explicitée**, pas
   bricolée. UI : action crayon dans `ManageTypesModal` (cadenas réservé aux types utilisés).
3. **Bug « Annuler » ouvrait « Gérer les types ».** Le champ Type était un `<label>`
   enveloppant plusieurs boutons → un `<label>` renvoie les clics vers son 1er contrôle
   labelable (« Gérer les types »). Corrigé en `<div>` + `<label htmlFor="type-select">`.
   Aussi : `reset()` ne force plus `'article'` (retombe sur le 1er type du registre courant).

**Preuves.** `tsc` propre ; **186/186** tests (dont registre adapté : fichier autoritaire,
non-repousse d'un type retiré) ; pilotage des **vrais** handlers sur `DATA_ROOT` isolé
(**15/15**) : suppression d'un intégré vide (`interview` → 200, jadis 403), matérialisation
de `types.json` sans repousse, `article` en usage protégé (409 delete + 409 rename),
renommage `presentation→podcast`, création/suppression `veille`, doublon 409 — **vrai wiki
intact**. Fix `<label>` : correction structurelle (tsc vert) rechargée à chaud dans le
`next dev` en cours ; non re-piloté en CDP pour ne pas perturber la session de test.
(Leçons consignées : « registre à entrées permanentes vs contrôle utilisateur » et
« `<button>` dans un `<label>` détourne le clic ».)
