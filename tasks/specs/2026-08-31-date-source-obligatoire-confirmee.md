# Date de la source : pré-remplie, validée, confirmation obligatoire au dépôt

## Contexte

Demande d'origine de l'utilisateur (Arthur, non-développeur — il décide du QUOI,
l'agent du COMMENT) :

> Dans la page d'ingestion, il faut un remplissage automatique à la date
> d'aujourd'hui, que l'utilisateur puisse modifier lui-même. Je veux pouvoir dater
> toutes les ressources. Il faut une attention particulière portée à la date : si
> la source (article, présentation) est antérieure à la date du jour, cette date
> doit bien être saisie par l'utilisateur. Idée : mettre la section date en valeur
> (cadre en gras) et obliger à appuyer sur un bouton « confirmer » avant d'ingérer.
> Pré-remplissage à aujourd'hui, puis confirmation obligatoire pour lancer
> l'ingestion. Si on appuie sur « ingérer » sans avoir confirmé, c'est bloqué et un
> petit message s'affiche, la section date devient rouge. Utiliser les meilleures
> pratiques UX des champs obligatoires.

**Problème métier sous-jacent (confirmé par audit).** Le champ « Date » existe DÉJÀ
dans le formulaire de dépôt et circule déjà de bout en bout (formulaire → sidecar
`.meta.md` → moteur d'ingestion → frontmatter de la fiche). Mais :

1. Il n'est **pas pré-rempli** (vide par défaut, placeholder `2026-06` seulement).
2. Il est **optionnel**, et une date absente est **comblée silencieusement par le
   moteur avec le mois en cours** (`forceDate`, cf. Plan §« Aval »). Conséquence :
   un article de mars 2025 déposé sans date est classé « août 2026 ». C'est le piège
   à fermer.
3. Il n'a **aucune validation de format**. Une date mal formée (`2026-13`, texte
   libre) casse en silence le classement chronologique : le moteur `buildByDate`
   **exclut** des vues « par date » toute ressource dont la date est vide ou non
   parsable (`web/lib/wiki-index.ts:213` : `resources.filter((r) => r.date)`).

Objectif : rendre la date **toujours saisie, valide et consciemment confirmée** au
dépôt, sans toucher au serveur ni au moteur (la plomberie de la date existe déjà).

Levier retenu en discussion : **bouton « Confirmer » qui verrouille la date**
(choix explicite de l'utilisateur parmi 3 options : case à cocher / bouton qui
verrouille / fenêtre au dépôt).

## Plan

### Comportement fonctionnel (formulaire de dépôt `/upload`)

1. **À l'ouverture** : le champ Date est **pré-rempli avec la date du jour** au format
   complet `AAAA-MM-JJ` (ex. `2026-08-31`), présenté dans un **cadre mis en valeur**
   (bordure épaisse, fond légèrement teinté, picto 📅, mention « requis »), distinct
   des autres champs (bordure gris fin). À côté du champ : un bouton **« Confirmer »**.
   État initial : date renseignée mais **NON confirmée**.

2. **Clic sur « Confirmer »** :
   - **Format invalide** (voir règles de validation ci-dessous) → cadre **rouge** +
     message d'erreur clair, rien ne se verrouille, le champ reste éditable.
   - **Date dans le futur** (l'intervalle de la date commence après aujourd'hui) →
     **avertissement orange NON bloquant** (« Cette date est dans le futur —
     inhabituel pour une source »), la confirmation **aboutit quand même**
     (cas légitime : présentation à venir).
   - **Valide** → le champ se **verrouille** (`readOnly`), passe en **vert + « ✓
     confirmée »**, le bouton devient **« Modifier »**.

3. **Clic sur « Modifier »** : le champ se déverrouille, `dateConfirmed` repasse à
   `false` (retour à l'état « à confirmer »), la valeur est conservée. **Invariant
   garanti** : toute modification de la valeur du champ (via `onChange`) remet aussi
   `dateConfirmed = false`. Donc **la date déposée est toujours exactement celle qui a
   été confirmée** — impossible de confirmer puis changer en douce.

4. **Clic sur « Déposer → »** :
   - Si `dateConfirmed === false` → **dépôt bloqué** (`return` avant tout `fetch`),
     le cadre date passe en **rouge** avec le message « Vérifie et confirme la date
     avant de déposer. ». Le bouton « Déposer » **reste cliquable** (best-practice
     Nielsen Norman Group : ne pas griser un bouton sans expliquer pourquoi ; laisser
     cliquer et afficher l'erreur au clic). La désactivation existante du bouton
     (contenu/fichier requis) est **conservée telle quelle**, la date n'y est PAS
     ajoutée.
   - Si `dateConfirmed === true` → dépôt normal (chemin existant inchangé).

Résultat : impossible de déposer sans avoir consciemment regardé et validé la date,
y compris pour un vieil article re-daté.

### Périmètre technique

- **Nouveau fichier** `web/lib/date-input.ts` — fonction pure de validation (aucun
  import `fs`, client-safe ; aucune classe Tailwind littérale dedans → pas de souci de
  `content` Tailwind). Prend `today` en paramètre (pas de `new Date()` interne) pour
  être déterministe et testable, **exactement comme `forceDate(markdown, declaredDate,
  today)`** (`web/lib/ingest-local.ts:807`).
- **`web/components/upload/UploadForm.tsx`** — pré-remplissage, cadre mis en valeur,
  états `dateConfirmed`/`dateError`/`dateWarning`, logique confirmer/modifier, garde au
  submit, reset. C'est le gros du travail, entièrement localisé dans ce composant.
- **`web/components/sources/EditForm.tsx`** — ajout de la **validation de format
  seule** (pas de confirmation forcée), pour ne pas laisser un autre chemin d'écriture
  introduire une date cassée.
- **Aucun changement serveur ni moteur.** La date est déjà lue
  (`web/app/api/upload/route.ts:182`), écrite au sidecar
  (`web/app/api/upload/route.ts:127`), lue par `parseSidecar`
  (`web/lib/ingest-local.ts:249`) et priorisée par `forceDate`
  (`web/lib/ingest-local.ts:807-815`).

### Contrat exact de `web/lib/date-input.ts`

```ts
// Granularité d'une date wiki : déduite de la longueur/forme de la chaîne
// (jamais un champ séparé — convention du projet, cf. wiki-index / chat-filters).
export type DateGranularity = 'year' | 'month' | 'day';

export type DateValidation =
  | { ok: true; granularity: DateGranularity; isFuture: boolean }
  | { ok: false; error: string };

// raw   : saisie utilisateur (sera .trim()).
// today : date du jour 'AAAA-MM-JJ' (passée par l'appelant, pas de new Date() ici).
export function validateDateInput(raw: string, today: string): DateValidation;
```

Règles de validation (dans l'ordre) :

1. `s = raw.trim()`. Si vide → `{ ok:false, error:'Renseigne la date de la source.' }`.
2. Forme :
   - `/^\d{4}$/` → `granularity = 'year'`
   - `/^\d{4}-\d{2}$/` → `granularity = 'month'`
   - `/^\d{4}-\d{2}-\d{2}$/` → `granularity = 'day'`
   - sinon → `{ ok:false, error:'Format attendu : AAAA, AAAA-MM ou AAAA-MM-JJ (ex. 2025, 2025-03, 2025-03-14).' }`
   Ces trois regex sont exactement celles déjà utilisées ailleurs
   (`web/lib/chat-filters.ts:17-22`, `web/lib/wiki-index.ts:79-80`) — cohérence.
3. Calendrier :
   - `year = Number(s.slice(0,4))` ; si `year < 1970 || year > 2100` →
     `{ ok:false, error:'Année invalide (1970–2100).' }`.
   - si `granularity !== 'year'` : `month = Number(s.slice(5,7))` ; si `month < 1 ||
     month > 12` → `{ ok:false, error:'Mois invalide (01–12).' }`.
   - si `granularity === 'day'` : `day = Number(s.slice(8,10))` ;
     `dim = new Date(year, month, 0).getDate()` (dernier jour du mois `month`, gère les
     années bissextiles — `new Date(2024,2,0).getDate() === 29`) ; si `day < 1 || day >
     dim` → `{ ok:false, error:`Jour invalide (01–${String(dim).padStart(2,'0')} pour ce mois).` }`.
   NB : `new Date(...)` avec arguments explicites est du code applicatif normal
   (l'interdit `new Date()` argless ne concerne QUE les scripts du tool Workflow, pas
   `web/lib/`).
4. Futur : `isFuture = intervalStart(s, granularity) > today` (comparaison lexicale de
   chaînes ISO, correcte), avec :
   - `year` → `intervalStart = `${s}-01-01``
   - `month` → `intervalStart = `${s}-01``
   - `day` → `intervalStart = s`
   Ex. `today = '2026-08-31'` : `2026` → start `2026-01-01` ≤ today → non futur ;
   `2026-08` → `2026-08-01` ≤ today → non futur ; `2026-09` → `2026-09-01` > today →
   futur ; `2027` → futur ; `2026-08-31` → non futur.
5. Retour succès : `{ ok:true, granularity, isFuture }`.

### Modifications exactes de `UploadForm.tsx`

État (le composant commence à `web/components/upload/UploadForm.tsx:42`) :

- Ligne 49 actuelle `const [date, setDate] = useState('');` → initialiser à
  aujourd'hui + ajouter les états d'accompagnement. Ajouter en tête du composant un
  `today` figé au montage :
  ```ts
  const [today] = useState(() => new Date().toISOString().slice(0, 10)); // 'AAAA-MM-JJ'
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [dateWarning, setDateWarning] = useState<string | null>(null); // futur, non bloquant
  ```
  (Voir Décision D5 sur l'hydratation.)
- Import : `import { validateDateInput } from '@/lib/date-input';` (le composant importe
  déjà via alias `@/…`, contrairement au moteur — ok ici).

Handlers (à ajouter, ex. juste avant `submit`) :
```ts
const onDateChange = (v: string) => {
  setDate(v);
  setDateConfirmed(false);   // toute modif annule la confirmation
  setDateError(null);
  setDateWarning(null);
};

const confirmDate = () => {
  const res = validateDateInput(date, today);
  if (!res.ok) { setDateError(res.error); setDateWarning(null); return; }
  setDateError(null);
  setDateWarning(res.isFuture ? 'Cette date est dans le futur — inhabituel pour une source.' : null);
  setDateConfirmed(true);   // verrouille
};

const editDate = () => { setDateConfirmed(false); }; // garde la valeur, redevient éditable
```

Garde au submit — dans `submit` (`web/components/upload/UploadForm.tsx:207`), APRÈS
les gardes contenu/fichier existantes (lignes 210-226, qui font `return` si pas de
contenu/fichier) et AVANT `setSubmitting(true)` (ligne 228) :
```ts
if (!dateConfirmed) {
  setDateError('Vérifie et confirme la date avant de déposer.');
  return;
}
```
Le `form.append('date', date.trim())` existant (ligne 248) reste inchangé — il enverra
désormais toujours une date confirmée non vide.

`reset` (`web/components/upload/UploadForm.tsx:183`) — ligne 187 `setDate('');` →
```ts
setDate(today);
setDateConfirmed(false);
setDateError(null);
setDateWarning(null);
```

Bouton « Déposer » (`web/components/upload/UploadForm.tsx:599-608`) : **inchangé**
(garder `disabled={submitting || (mode === 'paste' ? !text.trim() : !file)}`).

Remplacement du champ Date : SUPPRIMER le bloc actuel `web/components/upload/
UploadForm.tsx:545-553` (le `<label>` Date) de son emplacement au milieu des
métadonnées, et INSÉRER le cadre mis en valeur ci-dessous **juste avant** la ligne du
bouton Déposer, c.-à-d. entre `{error && …}` (ligne 597) et
`<div className="flex justify-end">` (ligne 599), pour que la lecture soit « confirmer
la date → déposer » (cf. Décision D4). Structure (Tailwind inline, conventions du
projet — vert de marque `#0F6E56`, erreurs `text-red-600`, hints `text-[11px]
text-gray-400`) :
```tsx
<div
  className={[
    'rounded-xl border-2 px-4 py-3',
    dateError
      ? 'border-red-500 bg-red-50'
      : dateConfirmed
        ? 'border-emerald-500 bg-emerald-50'
        : 'border-[#0F6E56]/40 bg-[#F3FAF7]',
  ].join(' ')}
>
  <div className="flex items-center justify-between">
    <span className="text-xs font-semibold text-gray-700">
      📅 Date de la source
      <span className="ml-1 font-normal text-gray-500">— requis</span>
    </span>
    {dateConfirmed ? (
      <span className="text-xs font-medium text-emerald-700">✓ confirmée</span>
    ) : (
      <span className="text-xs text-gray-400">à confirmer</span>
    )}
  </div>

  <div className="mt-2 flex items-center gap-2">
    <input
      value={date}
      onChange={(e) => onDateChange(e.target.value)}
      readOnly={dateConfirmed}
      placeholder="2026-06"
      className={[
        'w-full rounded-lg border px-3 py-1.5 text-sm',
        dateConfirmed ? 'border-emerald-300 bg-white text-gray-500' : 'border-gray-300',
      ].join(' ')}
    />
    {dateConfirmed ? (
      <button
        type="button"
        onClick={editDate}
        className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        Modifier
      </button>
    ) : (
      <button
        type="button"
        onClick={confirmDate}
        className="shrink-0 rounded-lg bg-[#0F6E56] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c5a47]"
      >
        Confirmer
      </button>
    )}
  </div>

  <p className="mt-1 text-[11px] text-gray-400">
    Format : AAAA · AAAA-MM · AAAA-MM-JJ. Corrige-la si la source est plus ancienne que le dépôt.
  </p>
  {dateWarning && <p className="mt-1 text-[11px] text-amber-600">⚠ {dateWarning}</p>}
  {dateError && <p className="mt-1 text-xs text-red-600">⚠ {dateError}</p>}
</div>
```
NB : le cadre étant dans un fichier `components/**`, ses classes (dont
`border-[#0F6E56]/40`, `bg-[#F3FAF7]`) sont scannées par Tailwind — pas le piège
`lib/**` de la leçon 2026-07-28.

### Modifications exactes de `EditForm.tsx` (validation de format seule)

- Ajouter `today` figé + import :
  ```ts
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  // en tête des imports : import { validateDateInput } from '@/lib/date-input';
  ```
- Dans `submit` (`web/components/sources/EditForm.tsx:67`), au tout début (après
  `setError(null)`, avant `setSubmitting(true)`), valider la date **si non vide** :
  ```ts
  const d = date.trim();
  if (d) {
    const res = validateDateInput(d, today);
    if (!res.ok) { setError(res.error); return; }
  }
  ```
  (On n'IMPOSE pas la date en édition — une ressource éditée a déjà sa date ; on empêche
  seulement d'en saisir une cassée. Cf. Décision D3.)
- Le champ Date UI (`web/components/sources/EditForm.tsx:171-179`) reste un simple
  `<label>` (pas de cadre/confirmation en édition) ; l'erreur s'affiche déjà via le
  `{error && …}` existant (`web/components/sources/EditForm.tsx:210`).

### Aval (rappel — inchangé, pour comprendre l'enjeu)

Cascade `forceDate` (`web/lib/ingest-local.ts:807-815`), priorité décroissante :
1. date déclarée au sidecar (notre saisie confirmée) ; 2. date extraite par l'IA ;
3. mois courant `today.slice(0,7)`. Notre changement garantit que le palier 1 est
toujours servi par une date valide et confirmée → les paliers 2/3 (comblement
silencieux) ne servent plus jamais depuis l'UI.

## Décisions

- **D1 — Geste de confirmation = bouton « Confirmer » qui verrouille** (choix explicite
  de l'utilisateur via AskUserQuestion, 3 options présentées). Écartés : (a) case à
  cocher « J'ai vérifié la date » — plus léger/standard mais moins délibéré et cochable
  machinalement ; (b) fenêtre de confirmation au moment du dépôt (réutilisant
  `ConfirmDialog`) — le plus « forçant » mais une étape de plus à CHAQUE dépôt, pénible
  en dépôt de masse.
- **D2 — Ne pas griser le bouton « Déposer » pour la date** ; le laisser cliquable et
  afficher l'erreur + rouge au clic (best-practice Nielsen Norman Group : un bouton
  grisé n'explique pas pourquoi). Écarté : ajouter `!dateConfirmed` au `disabled` du
  bouton — c'est ce que l'utilisateur voulait éviter (« un petit message s'affiche »).
- **D3 — En page d'édition (`EditForm`) : validation de format seule, PAS de
  confirmation forcée.** Une ressource déjà ingérée a une date déjà vérifiée ; forcer
  une reconfirmation à chaque petite édition serait pénible. Écarté : répliquer tout le
  mécanisme confirmer/verrouiller en édition (sur-ingénierie pour ce chemin).
- **D4 — Placer le cadre date juste au-dessus du bouton « Déposer »** (le déplacer de
  son emplacement actuel au milieu des métadonnées) pour une lecture naturelle
  « confirmer la date → déposer ». Écarté : le laisser en place au milieu des champs —
  moins lisible pour un geste qui conditionne tout le dépôt.
- **D5 — Pré-remplissage en date COMPLÈTE `AAAA-MM-JJ` via
  `new Date().toISOString().slice(0,10)`** (UTC, cohérent avec le serveur
  `web/lib/ingest-local.ts:64`). Pour une capture du jour, la précision jour est
  correcte ; pour une source ancienne, l'utilisateur remplace par `AAAA-MM`/`AAAA`.
  Caveat hydratation : `UploadForm`/`EditForm` sont `'use client'` mais SSR-rendus ;
  `useState(() => new Date()…)` peut différer entre serveur et client uniquement à la
  bascule de jour/fuseau. **Négligeable ici** : app Electron = serveur et client sur la
  MÊME machine (et même en dev web, machine unique). Alternative écartée (initialiser à
  vide puis remplir dans un `useEffect` de montage) : ajoute un flash vide→date sans
  bénéfice réel dans ce contexte mono-machine.
- **D6 — Avertissement futur NON bloquant** (orange), la confirmation aboutit quand
  même. Écarté : blocage dur des dates futures — casserait le cas légitime d'une
  présentation/conférence à venir ; l'objectif est de dater les sources ANTÉRIEURES
  correctement, pas d'interdire le futur.
- **D7 — `validateDateInput(raw, today)` prend `today` en paramètre** (pas de
  `new Date()` interne), pour être pure et testable, en miroir de `forceDate`.
- **D8 — Réutiliser les trois regex de forme déjà présentes** dans le projet
  (`chat-filters.ts`, `wiki-index.ts`) plutôt qu'en inventer d'autres — cohérence de la
  définition « qu'est-ce qu'une date valide » à travers le code.

## Hors périmètre

- **Aucune validation côté serveur** (`web/app/api/upload/route.ts`) ni côté moteur
  (`forceDate`). La date arrive désormais validée+confirmée du client ; le serveur/moteur
  tolèrent déjà n'importe quelle chaîne (comportement existant conservé). Une validation
  serveur « défense en profondeur » est possible mais non requise par la demande.
- **Pas de sélecteur de date graphique** (calendrier `<input type="date">`) : il
  n'accepte que `AAAA-MM-JJ` et casserait la granularité mixte (année seule / mois)
  essentielle au wiki. On garde un champ texte + validation.
- **Pas de champ de granularité stocké** : la granularité reste déduite de la forme de
  la chaîne (convention du projet inchangée).
- **Pas de rétro-correction des ressources déjà ingérées** sans date précise (celles
  comblées au mois courant). Hors sujet ; se corrige à la main via la page d'édition si
  besoin.
- **Pas de refonte du reste du formulaire** (titre, type, thèmes, liens, etc.).

## Todo

- [x] **1. Créer `web/lib/date-input.ts`** avec `validateDateInput(raw, today)` selon le
  contrat exact ci-dessus (type `DateValidation`, 3 regex, vérifs calendaires avec
  `new Date(year, month, 0).getDate()`, `isFuture` via `intervalStart > today`).
  *Vérif : `tsc` du dossier `web` passe (`npm --prefix web run typecheck` ou
  équivalent) ; la signature et le type exportés compilent.*

- [x] **2. Écrire les tests unitaires `web/lib/__tests__/date-input.test.ts`** en
  `node:test` + `node:assert`, sur le modèle de `web/lib/__tests__/ingest-force.test.ts`.
  Cas minimaux (avec `today = '2026-08-31'`) : `2026`→ok/year/non-futur ;
  `2026-08`→ok/month/non-futur ; `2026-08-31`→ok/day/non-futur ; `2025-03`→ok/non-futur ;
  `2027`→ok/futur ; `2026-09`→ok/futur ; `2026-09-01`→ok/futur ; `''`→erreur ;
  `2026/08`→erreur ; `aug 2026`→erreur ; `2026-8` (mois 1 chiffre)→erreur ;
  `2026-13`→erreur (mois) ; `2026-02-30`→erreur (jour) ; `2024-02-29`→ok (bissextile) ;
  `2023-02-29`→erreur ; `1800`→erreur (année) ; `3000`→erreur (année).
  *Vérif : lancer le fichier avec le runner du projet (repérer comment
  `ingest-force.test.ts` est exécuté dans `web/package.json` — probablement
  `node --test` via tsx/loader, ou `npm --prefix web test`) ; TOUS les cas passent.
  Copier/coller la sortie de test dans le compte rendu.*

- [x] **3. `UploadForm.tsx` — pré-remplissage + états + handlers** : `today` figé au
  montage, `date` initialisé à aujourd'hui, ajouter `dateConfirmed`/`dateError`/
  `dateWarning`, importer `validateDateInput`, ajouter `onDateChange`/`confirmDate`/
  `editDate`.
  *Vérif : `tsc` passe ; à l'ouverture de `/upload` le champ affiche la date du jour.*

- [x] **4. `UploadForm.tsx` — cadre mis en valeur** : supprimer l'ancien `<label>` Date
  (545-553) et insérer le cadre (structure fournie) entre `{error && …}` (597) et le
  `<div className="flex justify-end">` du bouton Déposer (599). Câbler `onChange`→
  `onDateChange`, `readOnly={dateConfirmed}`, bouton Confirmer/Modifier, affichage
  `dateWarning`/`dateError`, bordures conditionnelles rouge/vert/vert-marque.
  *Vérif : rendu visuel dans l'app — cadre teinté « à confirmer » au chargement ;
  après « Confirmer » → vert + « ✓ confirmée » + champ verrouillé + bouton « Modifier » ;
  après « Modifier » → redevient éditable et « à confirmer ».*

- [x] **5. `UploadForm.tsx` — garde au submit + reset** : ajouter le `if
  (!dateConfirmed) { setDateError('Vérifie et confirme la date avant de déposer.');
  return; }` dans `submit` après les gardes contenu/fichier ; mettre à jour `reset`
  (`setDate(today)` + reset des 3 états date).
  *Vérif : dans l'app, cliquer « Déposer » SANS confirmer → aucun appel réseau (onglet
  Réseau vide / pas de POST /api/upload), cadre rouge + message ; après « Confirmer »,
  cliquer « Déposer » → le POST part.*

- [x] **6. `EditForm.tsx` — validation de format** : ajouter `today` figé, importer
  `validateDateInput`, valider la date si non vide au début de `submit` (bloc fourni),
  `return` sur erreur (l'erreur s'affiche via le `{error && …}` existant).
  *Vérif : `tsc` passe ; sur `/sources/<slug>/edit`, saisir `2026-13` puis
  « Enregistrer » → message d'erreur, pas de PATCH ; corriger en `2026-01` →
  l'enregistrement passe.*

- [x] **7. Preuve UI de bout en bout, sans coût IA.** Lancer l'app (respecter les
  leçons Node 26 : si un `next dev` concurrent tourne, ne pas corrompre `.next` ; sinon
  `npm --prefix web run dev`, ou `build && start`, une seule instance, port 3000/3001).
  Démontrer (capture ou pilotage CDP) les 4 états : (a) pré-rempli à aujourd'hui ;
  (b) « Déposer » sans confirmer → bloqué + rouge + message, **aucun** POST ;
  (c) « Confirmer » → verrouillé vert ; (d) « Modifier » → réédition. Pour prouver que
  le chemin confirmé atteint bien le POST **sans appel LLM payant**, utiliser la
  technique éprouvée (leçons 2026-07-22/28) : `DATA_ROOT` isolé + verrou d'ingestion
  pré-posé (`ingest.lock` → `runIngestion()` no-op), ou vérifier le départ du POST au
  niveau réseau.
  *Vérif : captures/logs des 4 états + preuve « pas de POST tant que non confirmé ».*

- [x] **8. Non-régression** : `tsc` global `web` propre, tests `web` verts (le nouveau
  fichier de test inclus). Vérifier qu'aucune classe Tailwind du cadre ne manque au
  rendu (toutes dans `components/**`, donc scannées — contrôle visuel du fond teinté).
  *Vérif : sortie de `tsc` + sortie des tests, sans erreur.*

- [x] **9. Mettre à jour `tasks/lessons.md`** si une correction d'Arthur survient
  pendant l'implémentation (contexte / correction / règle). — Aucune correction
  d'Arthur pendant l'implémentation ; rien à consigner.

## Bilan

**Fait (tout le plan, sans déviation).**

- **`web/lib/date-input.ts`** — `validateDateInput(raw, today)` pure, client-safe,
  exactement selon le contrat (3 regex de forme réutilisées du projet, bornes année
  1970–2100, mois 01–12, jour via `new Date(year, month, 0).getDate()` — bissextiles
  gérées, `isFuture` par comparaison lexicale de `intervalStart` à `today`).
- **`web/lib/__tests__/date-input.test.ts`** — 18 cas (`node:test`), TOUS verts, dont
  bissextile (`2024-02-29` ok / `2023-02-29` erreur), bornes d'année, futur, formats.
- **`UploadForm.tsx`** — `today`/`date` pré-remplis à aujourd'hui, états
  `dateConfirmed`/`dateError`/`dateWarning`, handlers `onDateChange`/`confirmDate`/
  `editDate`, garde au submit (bloque avant tout `fetch`), reset mis à jour, ancien
  champ Date supprimé et **cadre mis en valeur** inséré juste au-dessus de « Déposer ».
- **`EditForm.tsx`** — validation de FORMAT seule au submit (pas de confirmation forcée).

**Preuves (zéro coût IA, vrai wiki intact).**

- `npm --prefix web test` → **234/234 verts** (dont les 18 nouveaux) ; `tsc --noEmit` → **exit 0**.
- Instance ISOLÉE (copie de `web/` + `.next` propre, port 3007, `DATA_ROOT` scratch +
  `ingest.lock` pré-posé ⇒ `runIngestion()` no-op). Pilotage Chrome via CDP :
  - (a) `/upload` ouvert → date input = **2026-09-01** (aujourd'hui), cadre « à confirmer », éditable.
  - (b) « Déposer » sans confirmer → **0 POST `/api/upload`**, cadre **rouge** + message
    « Vérifie et confirme la date avant de déposer. ».
  - (c) « Confirmer » → champ **readOnly**, cadre **vert**, « ✓ confirmée », bouton « Modifier ».
  - (d) « Modifier » → redevient éditable, « à confirmer ».
  - (e) confirmé puis « Déposer » → **1 POST `/api/upload` → 200** ; sidecar écrit
    `date: "2026-09-01"` (la date confirmée traverse jusqu'au disque) ; aucun `ingest-state.json`/
    `ingest.log` ⇒ **aucun appel LLM**.
  - `EditForm` : `2026-13` → **0 PATCH** + « Mois invalide (01–12). » ; `2026-01` → **PATCH → 200**.
  - Captures d'écran des 3 états du cadre (vert-marque / rouge / vert confirmé) vérifiées.
- Le vrai wiki n'a pas été touché (mutations en copie isolée ; fiche éditée sans changement git).

**Déviations : aucune.** Le plan a été suivi à la lettre (contrat de `date-input.ts`,
emplacement du cadre, décisions D1–D8). Seule note technique : la preuve a tourné sous
Node 26 avec deux `next dev` concurrents d'une autre session sur 3000/3001 — d'où le
build+start ISOLÉ sur 3007 (leçons Node 26 + dépôt partagé), qui n'affecte ni leur `.next`
ni le vrai wiki.
