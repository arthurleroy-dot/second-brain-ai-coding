# Sélecteur de thèmes à l'upload — liste déroulante maison, ajout au clic

## Contexte

Dans le formulaire de dépôt (`/upload`), le composant
[web/components/upload/ThemePicker.tsx](../../web/components/upload/ThemePicker.tsx)
affiche aujourd'hui **trois zones** empilées :

1. **Bulles violettes** (`value`) — thèmes déjà sélectionnés, chacun avec une croix
   pour retirer.
2. **Champ de saisie + `datalist` native + bouton « + »** — un `<input list="theme-options">`
   dont l'autocomplétion est fournie par une `<datalist>` native, plus un bouton `+`.
3. **Rangée de pastilles « + Nom »** (`suggestions.slice(0, 10)`, lignes ~126-139) —
   tous les thèmes existants non encore choisis, en pastilles cliquables (ajout immédiat
   au clic, mais bridées à 10).

**Demande d'origine de l'utilisateur (Arthur) :** deux frictions à corriger.
- La zone 3 (pastilles) va **exploser** visuellement quand il y aura beaucoup de thèmes
  → les supprimer, tout doit passer par une liste déroulante scrollable.
- La `datalist` native (ce que l'utilisateur appelle « la scrollbar ») **ne délivre pas
  « clic = ajout »** : sélectionner un thème dans la liste ne fait que recopier son texte
  dans le champ ; il faut ensuite presser « + » pour qu'il devienne une bulle violette.
  Ça, c'est pénible. On veut que **cliquer un thème existant l'ajoute directement** en
  bulle violette. Le « + » ne doit plus servir qu'à **créer un thème inédit** (qui
  n'existe pas encore).

**Raison technique du remplacement :** une `<datalist>` native ne distingue pas un clic
d'une frappe clavier (elle se contente de remplir la valeur de l'`<input>` et de déclencher
un événement `input` indistinct). Il est donc **impossible d'ajouter au clic** avec une
`datalist`. Seule solution : la remplacer par une **liste déroulante maison** (combobox
contrôlé) où chaque ligne est un vrai `<button>` avec son propre `onClick`.

## Plan

Réécriture d'**un seul fichier** :
[web/components/upload/ThemePicker.tsx](../../web/components/upload/ThemePicker.tsx).
**Aucun changement serveur** — `/api/themes` existe déjà et renvoie
`{ themes: [{ slug, label }] }`.

### Ce qui disparaît
- La rangée de pastilles « + Nom » du bas (bloc `suggestions.slice(0, 10)`, lignes ~126-139).
- La variable `suggestions` telle quelle (remplacée par une liste `options` filtrée, sans cap).
- L'autocomplétion native : suppression de `<datalist id="theme-options">` (lignes ~120-124)
  ET de l'attribut `list="theme-options"` sur l'`<input>`.

### Ce qui remplace — combobox contrôlé
Le champ « Ajouter un thème » devient une liste déroulante maison :

1. **Focus sur le champ** → une liste **scrollable** s'ouvre juste en dessous (positionnée
   en `absolute` dans un conteneur `relative`), listant tous les thèmes existants **sauf ceux
   déjà sélectionnés**. Hauteur plafonnée `max-h-56` + `overflow-y-auto` → ascenseur au-delà.
   État d'ouverture : `const [open, setOpen] = useState(false)`, mis à `true` sur `onFocus`.
2. **Saisie dans le champ** → la liste **se filtre en direct**, insensible à la casse ET aux
   accents. Normalisation via un helper `norm(s)` local = `s.toLowerCase().normalize('NFD')
   .replace(/\p{Diacritic}/gu, '')` (miroir de la 1re moitié de `localSlug` d'UploadForm, mais
   SANS slugifier — on garde espaces/ponctuation pour un `includes` naturel). Filtre :
   `norm(t.label).includes(norm(draft))`.
3. **Clic sur une ligne** → `add(t.label)` → le thème devient **immédiatement une bulle
   violette** ; on **vide le champ** (`setDraft('')`) et **on laisse la liste ouverte** →
   on peut en enchaîner plusieurs.
4. **Le bouton « + » ET la touche Entrée** appellent `commitDraft()` → crée (ou re-sélectionne)
   le thème **tapé** s'il n'existe pas → bulle violette. `addName` dédup en casse-insensible :
   si le thème existe déjà, ajout simple, **pas d'erreur**.
5. **Fermeture de la liste** : au **clic hors du composant** (listener `document` sur
   `mousedown`, comparé au `ref` du conteneur) et à **Échap** (`onKeyDown` de l'input). Le clic
   sur une ligne ou sur le « + » est INTERNE au conteneur → ne ferme donc pas (d'où les ajouts
   multiples enchaînables). Ré-ouverture au focus. **Pas de fermeture sur `blur`** (évite le bug
   classique « blur avant click » qui empêcherait le clic sur une ligne).

### Ce qui NE bouge PAS
- Bulles violettes en haut (`value`) avec la croix (`remove`) — inchangées.
- Réglage de **granularité** (`<select>` `auto`/`resource`/`chunk`) — inchangé.
- Le **texte d'aide** de bas de cadre (« Un thème inédit sera créé et réutilisable… ») —
  conservé ; le hint « « {draft} » sera pris en compte au dépôt » quand `draft` non vide —
  conservé.
- La poignée impérative **`flush()` / `ThemePickerHandle`** + `mergeThemeDraft` (récupère au
  submit le brouillon tapé-mais-non-validé) — **INCHANGÉE**. `useImperativeHandle(ref, () =>
  ({ flush }), [value, draft])`.
- La **signature des props** (`value` / `onChange` / `granularity` / `onGranularityChange`) —
  **INCHANGÉE**. `UploadForm.tsx` n'est pas modifié.
- Le `useEffect` de fetch `/api/themes` au montage — inchangé.
- Les helpers `add` (via `addName`), `remove`, `commitDraft` — logique inchangée (seul le
  wording du `placeholder`/`aria-label` du « + » peut passer à « créer »).

### Implémentation de référence (fichier complet)
L'implémenteur peut adapter le détail, mais ce fichier satisfait toute la spec :

```tsx
'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Gran } from './LinkPicker';
import { addName, mergeThemeDraft } from '@/lib/upload-drafts';

interface ThemeInfo {
  slug: string;
  label: string;
}

// Poignée impérative symétrique de LinkPickerHandle : `flush()` fusionne le
// brouillon de thème tapé mais non validé et retourne la liste à jour au submit.
export type ThemePickerHandle = { flush: () => string[] };

interface ThemePickerProps {
  value: string[];
  onChange: (v: string[]) => void;
  granularity: Gran;
  onGranularityChange: (v: Gran) => void;
}

// Normalisation légère pour le filtrage : minuscule + suppression des diacritiques
// (accents), SANS slugifier — on garde espaces/ponctuation pour un `includes` naturel.
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Sélecteur de thèmes à l'upload. Champ de recherche + liste déroulante maison
 * (combobox) des thèmes existants (via /api/themes) : clic sur une ligne = ajout
 * immédiat en puce ; « + »/Entrée = création d'un thème inédit tapé. Valeur =
 * liste de noms (l'agent slugifie et crée/relie selon docs/entities.md).
 */
const ThemePicker = forwardRef<ThemePickerHandle, ThemePickerProps>(function ThemePicker(
  { value, onChange, granularity, onGranularityChange },
  ref,
) {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => {});
  }, []);

  // Ferme la liste au clic hors du composant. Le clic sur une ligne ou le « + »,
  // internes au conteneur, ne ferme donc pas → ajouts multiples enchaînables.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const add = (name: string) => {
    const next = addName(value, name); // trim + dédup casse-insensible (helper partagé)
    if (next === value) return; // vide ou doublon : rien à ajouter
    onChange(next);
  };
  const remove = (name: string) => onChange(value.filter((x) => x !== name));

  // « + » / Entrée : crée (ou re-sélectionne) le thème TAPÉ, puis vide le champ.
  const commitDraft = () => {
    add(draft);
    setDraft('');
  };

  // Ramasse au submit le brouillon tapé mais non validé (cf. ThemePickerHandle).
  const flush = (): string[] => {
    const merged = mergeThemeDraft(value, draft);
    onChange(merged); // cohérence UI : le brouillon devient une puce
    setDraft('');
    return merged; // valeur synchrone consommée par submit()
  };
  useImperativeHandle(ref, () => ({ flush }), [value, draft]);

  // Thèmes existants non encore sélectionnés, filtrés par le texte tapé (insensible
  // à la casse ET aux accents). Pas de cap : la liste scrolle.
  const q = norm(draft);
  const options = themes.filter(
    (t) =>
      !value.some((s) => s.toLowerCase() === t.label.toLowerCase() || s.toLowerCase() === t.slug) &&
      (q === '' || norm(t.label).includes(q)),
  );

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <span className="text-xs font-medium text-gray-600">Thèmes (optionnel)</span>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
            >
              {name}
              <button type="button" onClick={() => remove(name)} aria-label={`Retirer ${name}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div ref={boxRef} className="relative">
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setDraft(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="Ajouter un thème — + ou Entrée pour créer"
            className="w-full rounded-lg border border-gray-300 px-2.5 py-1 text-xs"
          />
          <button
            type="button"
            onClick={commitDraft}
            aria-label="Créer le thème"
            className="shrink-0 rounded-lg border border-gray-300 p-1.5 text-gray-500 hover:border-indigo-300 hover:text-indigo-700"
          >
            <Plus size={14} />
          </button>
        </div>

        {open && (
          <div className="absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {options.length > 0 ? (
              options.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => {
                    add(t.label);
                    setDraft(''); // vide le filtre, garde la liste ouverte pour enchaîner
                  }}
                  className="block w-full px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {t.label}
                </button>
              ))
            ) : (
              <p className="px-2.5 py-1.5 text-[11px] text-gray-400">
                {draft.trim() ? 'Aucun thème existant — + pour le créer.' : 'Aucun thème disponible.'}
              </p>
            )}
          </div>
        )}
      </div>

      {draft.trim() && (
        <p className="text-[11px] text-gray-400">
          « {draft.trim()} » sera pris en compte au dépôt.
        </p>
      )}

      {value.length > 0 && (
        <label className="block text-[11px] text-gray-500">
          Granularité
          <select
            value={granularity}
            onChange={(e) => onGranularityChange(e.target.value as Gran)}
            className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1 text-[11px]"
          >
            <option value="auto">Auto (l'agent décide)</option>
            <option value="resource">Ressource entière</option>
            <option value="chunk">Sections concernées</option>
          </select>
        </label>
      )}

      <p className="text-[11px] text-gray-400">
        Un thème inédit sera créé et réutilisable par les autres. Laisse vide :
        l'agent déduit les thèmes du contenu.
      </p>
    </div>
  );
});
ThemePicker.displayName = 'ThemePicker';

export default ThemePicker;
```

## Décisions

- **Levier A (combobox maison) retenu.** Alternatives écartées :
  - **Levier B — garder la `datalist` native + auto-ajout quand le texte correspond pile à
    un thème connu.** Écarté : fragile (l'auto-ajout se déclenche dès que la frappe ressemble
    à un nom existant), la `datalist` native n'est ni stylable ni fiabilisable, et ne délivre
    pas vraiment « clic = ajout » → demi-résultat bancal.
  - **Levier C — liste à cases à cocher (multi-select).** Écarté : casse l'esthétique
    « bulles », lourd, et la création d'un thème inédit s'y intègre mal.
- **Périmètre : thèmes UNIQUEMENT.** Le sélecteur de Liens (`LinkPicker.tsx`) souffre du même
  défaut (pastilles `suggestions.slice(0, 8)` + `datalist`) mais **n'est PAS touché** — choix
  explicite d'Arthur (principe « ne toucher que le nécessaire »). Pourra être aligné plus tard.
- **Ouverture de la liste : dès le `focus` du champ** (pas seulement à la première frappe) —
  au plus proche de la demande « tout passe par la scrollbar » d'Arthur. Alternative écartée :
  ouvrir seulement à la frappe (plus discret mais moins conforme à l'intention).
- **Après un ajout au clic : la liste reste ouverte + le filtre est vidé** → ajouts multiples
  enchaînables. Alternative écartée : refermer après chaque ajout (obligerait à re-cliquer le
  champ pour chaque thème).
- **Fermeture sur clic-dehors + Échap uniquement, PAS sur `blur`.** Raison : fermer sur `blur`
  déclencherait le bug classique « `blur` avant `click` » et empêcherait le clic sur une ligne
  d'aboutir.
- **Pas de navigation clavier flèches ↑/↓ dans la liste** pour l'instant — clic (existants) +
  Entrée (création du tapé) suffisent. Garder simple ; ajout ultérieur possible.
- **Filtrage insensible aux accents** via un helper `norm` local (NFD + suppression des
  diacritiques, sans slugify) plutôt que `localSlug` (qui colle les mots et retire les espaces,
  inadapté à un `includes` de recherche).

## Hors périmètre

- `web/components/upload/LinkPicker.tsx` (sélecteur d'entités/liens) — non touché, malgré le
  même défaut.
- Toute modification serveur / API (`/api/themes` déjà en place et suffisant).
- `web/components/upload/UploadForm.tsx` — non touché (props de `ThemePicker` inchangées).
- Navigation clavier (flèches ↑/↓, surlignage d'une ligne active) dans la liste déroulante.

## Todo

- [x] **Réécrire `web/components/upload/ThemePicker.tsx`** selon l'implémentation de référence
  ci-dessus : ajouter l'état `open` + `boxRef` + le helper `norm` + le `useEffect` de
  fermeture au clic-dehors ; remplacer la `datalist` et les pastilles `suggestions` par la
  liste déroulante `options` (conteneur `relative`/`absolute`, `max-h-56 overflow-y-auto`) ;
  conserver bulles/granularité/aide/`flush`/props.
  **Vérif :** `npm run lint` (dans `web/`) et `npx tsc --noEmit` passent sans erreur sur le
  fichier ; `grep -n "datalist\|theme-options\|suggestions" web/components/upload/ThemePicker.tsx`
  ne renvoie plus rien.
- [x] **Vérifier le rendu réel dans l'app** (`/upload`). Lancer l'app (cf.
  `docs/code-workflow.md` / skill `run` — dev Next `npm run dev` dans `web/`, ou coquille
  Electron) et ouvrir le formulaire de dépôt.
  **Vérif — cocher chaque comportement observé :**
  - Cliquer dans le champ « Ajouter un thème » → la liste des thèmes existants s'ouvre,
    scrollable si longue, sans aucune pastille « + Nom » sous la barre.
  - Taper quelques lettres (avec un accent, ex. « ml » ou « inté ») → la liste se filtre
    correctement, insensible à la casse et aux accents.
  - Cliquer une ligne de la liste → le thème apparaît **immédiatement** en bulle violette en
    haut, sans presser « + » ; la liste reste ouverte et le champ est vidé ; on peut en
    cliquer un second dans la foulée.
  - Taper un nom **inédit** puis « + » (ou Entrée) → il devient une bulle violette.
  - Taper un nom qui **existe déjà** puis « + » → ajouté sans erreur (pas de doublon).
  - Cliquer ailleurs dans la page, ou presser Échap → la liste se referme ; recliquer le
    champ la rouvre.
  - Retirer une bulle via sa croix → le thème réapparaît dans la liste déroulante.
  - Déposer un document avec 1-2 thèmes sélectionnés → ils partent bien dans la requête
    (le `flush` du brouillon non validé fonctionne toujours).

## Bilan

### Ce qui a été fait
- **`web/components/upload/ThemePicker.tsx` réécrit** à l'identique de l'implémentation de
  référence de la spec : état `open` + `boxRef` + helper `norm` (NFD, insensible aux accents) +
  `useEffect` de fermeture au clic-dehors (`document mousedown` comparé au `ref`) ; `datalist`
  native et pastilles `suggestions.slice(0,10)` remplacées par une **liste déroulante maison**
  `options` (conteneur `relative`/`absolute`, `max-h-56 overflow-y-auto`) où chaque ligne est un
  `<button>` avec son `onClick` → clic = ajout immédiat ; « + »/Entrée réservés à la **création
  d'un thème tapé**. Bulles, granularité, textes d'aide, poignée `flush()`/`ThemePickerHandle` et
  signature des props : **inchangés**. Aucun changement serveur.
- **Vérifications exécutées (preuves, pas affirmations) :**
  - `grep` des résidus (`datalist`/`theme-options`/`suggestions`) → **0 occurrence**.
  - `tsc --noEmit` (typecheck complet du projet) → **0 erreur**.
  - Suite de tests existante `npm test` → **205/205** (helpers partagés `addName`/`flush` intacts).
  - **Harnais DOM sur le VRAI composant** (jsdom + Testing Library) → **9/9** comportements de la
    checklist démontrés : ouverture au focus (12 thèmes, non cappé, sans pastille « + Nom » ;
    conteneur `max-h-56 overflow-y-auto` présent), filtrage insensible casse+accents
    (« inte » → « Intégration continue », « SECU » → « Sécurité »), clic = bulle immédiate + liste
    reste ouverte + champ vidé + enchaînement, « + »/Entrée = création d'un inédit, dédup
    casse-insensible sans doublon, Échap + clic-dehors ferment / re-focus rouvre, retrait d'une
    bulle → réapparition dans la liste, `flush()` ramasse le brouillon non validé.

### Déviations par rapport au plan (et pourquoi)
- **Preuve du comportement : harnais DOM au lieu d'un clic manuel dans `/upload` live.** Le plan
  prévoyait « lancer l'app et ouvrir le formulaire ». Deux obstacles d'ENVIRONNEMENT (aucun lié au
  code) : (1) `web/node_modules` avait été **vidé par une autre session** vers 15h26 → dépendances
  réinstallées via `npm ci` (état sain, restauré depuis le lockfile) ; (2) un `next dev` concurrent
  (pid 52722, autre session) tournait mais renvoyait **HTTP 500** sur `/upload` (corrompu par cette
  suppression) — je n'y ai pas touché (règle « ne pas corrompre le `.next`/serveur d'une autre
  session »). Monter une instance Next isolée juste pour cliquer à la main aurait été disproportionné
  alors qu'un **harnais DOM déterministe exerçant le vrai composant** prouve exactement les mêmes
  comportements, de façon répétable. Les outils de test DOM (jsdom + Testing Library) ont été
  installés en **`--no-save` (non committés)** ; `package.json`/lockfile inchangés.
- **`npm run lint` non exécuté (impossible dans ce repo).** Le projet n'a **aucune config ESLint**
  (`eslint`/`eslint-config-next` absents ; `next lint` ne fait que proposer un assistant de setup
  interactif). Scaffolder ESLint de zéro était hors périmètre (ajout de paquets + config + lint de
  tout le codebase, remontant des soucis préexistants sans lien). La qualité est prouvée par le
  **typecheck complet (`tsc` = 0 erreur)** à la place.

### Limites honnêtes de la preuve
- Le harnais jsdom prouve la **logique et les interactions** du composant, pas le rendu **visuel**
  réel (apparence de l'ascenseur, superposition `z-10`) : ces aspects CSS sont vérifiés seulement par
  la présence des classes (`max-h-56 overflow-y-auto`, `absolute`), pas par un pixel rendu.
- Le chemin de **submit de bout en bout** (`UploadForm` → `FormData` → `POST /api/upload`) n'est pas
  ré-exercé ici : `UploadForm.tsx` est inchangé et le `flush()` (dont dépend l'envoi du brouillon)
  est prouvé côté composant (test 8) + déjà couvert par la validation du 2026-07-22.
