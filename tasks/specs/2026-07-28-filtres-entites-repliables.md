# Filtres par entités repliables derrière un bouton « Entités » (page /sources)

## Contexte

Sur la page `/sources` (la liste filtrable des ressources ; libellée « Sources »
dans la sidebar mais tout le vocabulaire utilisateur dit « ressource »), la barre
de filtres affiche **en permanence** un menu déroulant par **type d'entité**
(Outils, Entreprises, Modèles, Personnes, …). Ces menus sont générés dynamiquement
depuis le registre `/api/entities`.

Demande d'origine de l'utilisateur (Arthur, non-développeur) : « dans la page
ressources, il y a tous les filtres d'entités … quand on aura un nombre d'entités
énorme, la barre de filtres va être gigantesque. J'ai envie d'un petit bouton
"Afficher les filtres par entités" ; les filtres n'apparaissent que quand on
appuie dessus. »

**Diagnostic technique précis** (issu de l'audit) :
- Les entités d'un même type sont déjà **cachées à l'intérieur** de leur menu
  déroulant `<select>`. Avoir beaucoup d'entités d'un même type ne rallonge donc
  PAS la barre — cela allonge seulement la liste interne du menu.
- Ce qui rallonge la barre horizontalement, c'est le **nombre de _types_
  d'entités** : chaque `entity_type` distinct ajoute un `<select>` de plus sur la
  rangée `flex flex-wrap`. Le système de types est **ouvert** (chaque ingestion
  peut créer un nouveau type via `_candidates.json`), donc le nombre de menus
  croît sans borne.
- État actuel : **19 entités, 5 types** → 5 menus d'entités + 5 filtres cœur
  (Type, Auteur, Origine, Date, Thème) = **10 `<select>`** sur une ligne qui
  déborde déjà. Le problème est surtout **futur**, mais la mécanique est déjà là.

Objectif : replier les menus par entité derrière un bouton « Entités » (repliés
par défaut), pour désencombrer la vue par défaut. **Aucune** logique de filtrage
ni de schéma d'URL n'est modifiée — c'est un changement d'affichage.

## Plan

**Levier retenu : A — disclosure inline (2ᵉ rangée dépliable).** Un seul fichier
touché : `web/components/sources/FilterBar.tsx`.

### Comportement cible
1. **Deux rangées** au lieu d'une seule rangée `flex flex-wrap` :
   - **Rangée 1** (toujours visible) : les 5 filtres cœur (Type, Auteur, Origine,
     Date, Thème) + un bouton **« Entités »** + le bouton **« Réinitialiser »**.
   - **Rangée 2** (conditionnelle) : les menus par type d'entité, chacun préfixé
     par le libellé de son type (ex. « Outils : [Tous ▾] »).
2. **Interrupteur local** : un booléen React `showEntityFilters` (état d'UI
   éphémère, PAS un filtre ; ne va donc PAS dans l'URL). C'est le premier état
   non-URL de ce composant — cohérent et assumé.
3. **Bouton « Entités »** :
   - Chevron `ChevronRight` (replié) / `ChevronDown` (déplié) de `lucide-react`
     (déjà en dépendance, `^0.460.0`).
   - **Compteur des filtres actifs** : libellé « Entités » quand aucun filtre
     entité n'est actif, « Entités (N) » sinon, avec `N = selectedEntities.length`.
     But : un filtre entité appliqué ne doit jamais devenir invisible une fois le
     panneau replié. Quand N > 0, le bouton prend un style « actif » (indigo).
   - Clic → bascule `showEntityFilters`.
4. **Rangée 2 conditionnelle** : affichée seulement si `showEntityFilters === true`.
   Réutilise la boucle `entityTypes.map` existante (les mêmes `<select>`), déplacée
   dans la 2ᵉ rangée. L'option vide passe de « Tous · {label} » à « Tous » puisque
   le libellé du type est désormais un texte visible qui préfixe le menu.
5. **Ouverture automatique au montage** : si on arrive sur la page avec un filtre
   entité déjà actif dans l'URL (`?entity=…` non vide — lien partagé, retour via la
   sidebar qui rejoue la dernière requête), le panneau s'ouvre tout seul. Sinon,
   replié. Implémenté via l'initialiseur paresseux de `useState` (lu **une seule
   fois** au montage — l'utilisateur garde ensuite la main sur le repli/dépli ;
   pas de réouverture forcée à chaque changement d'URL).
6. **Registre vide / aucun type affichable → pas de bouton** : si aucun type
   d'entité n'a d'entité à proposer, le bouton « Entités » n'apparaît pas (rien à
   déplier). Reprend la garde `opts.length === 0` déjà présente, remontée au niveau
   de la liste des types affichables.

### État actuel du fichier `web/components/sources/FilterBar.tsx`

Fichier complet actuel (194 lignes) — référence pour l'implémenteur :

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Source } from '@/types';
import { ALL_ORIGINS, originLabel, typeLabel } from '@/lib/ui';

// Formes minimales renvoyées par /api/themes et /api/entities (types locaux :
// on évite d'importer les interfaces définies dans le module serveur wiki-parser).
type ThemeOpt = { slug: string; label: string };
type EntityType = { slug: string; label: string };
type EntityOpt = { slug: string; label: string; entity_type: string };

export default function FilterBar({ sources }: { sources: Source[] }) {
  const router = useRouter();
  const params = useSearchParams();

  // Registres (tout le registre, pas seulement ce qui est présent sur les sources).
  const [themes, setThemes] = useState<ThemeOpt[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [entities, setEntities] = useState<EntityOpt[]>([]);

  useEffect(() => {
    fetch('/api/themes')
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => {});
    fetch('/api/entities')
      .then((r) => r.json())
      .then((d) => {
        setEntityTypes(d.types ?? []);
        setEntities(d.entities ?? []);
      })
      .catch(() => {});
  }, []);

  // slug d'entité → son type (pour piloter les menus par type).
  const entityById = useMemo(() => {
    const m = new Map<string, EntityOpt>();
    for (const e of entities) m.set(e.slug, e);
    return m;
  }, [entities]);

  // Types DÉRIVÉS des ressources présentes (comme authors/dates) — un type non
  // utilisé n'apparaît pas (règle « filtres = réalité » ; `tweet` disparaît).
  // La valeur du filtre = le slug kebab lui-même.
  const types = Array.from(new Set(sources.map((s) => s.type).filter(Boolean) as string[]))
    .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));

  const authors = Array.from(
    new Set(sources.map((s) => s.author).filter(Boolean) as string[]),
  ).sort();
  const dates = Array.from(
    new Set(sources.map((s) => (s.date ? s.date.slice(0, 7) : null)).filter(Boolean) as string[]),
  ).sort((a, b) => b.localeCompare(a));

  // Les options sont des `AAAA-MM`, mais un nœud date-année du graphe filtre sur
  // `AAAA` seul. On injecte la valeur courante si elle manque, sinon le menu
  // resterait vide (non auto-rempli) alors que la liste, elle, est bien filtrée.
  const currentDate = params.get('date') ?? '';
  const dateOptions =
    currentDate && !dates.includes(currentDate)
      ? [...dates, currentDate].sort((a, b) => b.localeCompare(a))
      : dates;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/sources?${next.toString()}`);
  };

  // Entités sélectionnées (liste plate de slugs, un par type via les menus).
  const selectedEntities = (params.get('entity') ?? '').split(',').filter(Boolean);

  // Valeur courante du menu d'un type = le slug sélectionné de ce type (ou '').
  const entityValueForType = (typeSlug: string) =>
    selectedEntities.find((slug) => entityById.get(slug)?.entity_type === typeSlug) ?? '';

  // Sélectionne (ou déselectionne) une entité pour un type : on remplace celle du
  // même type, on garde les autres. Le param `entity` reste type-agnostique.
  const setEntity = (typeSlug: string, entitySlug: string) => {
    const kept = selectedEntities.filter((slug) => entityById.get(slug)?.entity_type !== typeSlug);
    const nextList = entitySlug ? [...kept, entitySlug] : kept;
    const next = new URLSearchParams(params.toString());
    if (nextList.length) next.set('entity', nextList.join(','));
    else next.delete('entity');
    router.push(`/sources?${next.toString()}`);
  };

  const selectClass =
    'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectClass}
        value={params.get('type') ?? ''}
        onChange={(e) => setParam('type', e.target.value)}
      >
        <option value="">Tous les types</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {typeLabel(t)}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('author') ?? ''}
        onChange={(e) => setParam('author', e.target.value)}
      >
        <option value="">Tous les auteurs</option>
        {authors.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('origin') ?? ''}
        onChange={(e) => setParam('origin', e.target.value)}
      >
        <option value="">Toutes les origines</option>
        {ALL_ORIGINS.map((o) => (
          <option key={o} value={o}>
            {originLabel(o)}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('date') ?? ''}
        onChange={(e) => setParam('date', e.target.value)}
      >
        <option value="">Toutes les dates</option>
        {dateOptions.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={params.get('topic') ?? ''}
        onChange={(e) => setParam('topic', e.target.value)}
      >
        <option value="">Tous les thèmes</option>
        {themes.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Un menu par type de lien (Outil, Client, …) — ajouté automatiquement dès
          qu'un nouveau type apparaît dans le registre des entités. */}
      {entityTypes.map((t) => {
        const opts = entities.filter((e) => e.entity_type === t.slug);
        if (opts.length === 0) return null;
        return (
          <select
            key={t.slug}
            className={selectClass}
            value={entityValueForType(t.slug)}
            onChange={(e) => setEntity(t.slug, e.target.value)}
          >
            <option value="">Tous · {t.label}</option>
            {opts.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.label}
              </option>
            ))}
          </select>
        );
      })}

      {(params.toString() !== '') && (
        <button
          type="button"
          onClick={() => router.push('/sources')}
          className="text-xs text-gray-500 underline hover:text-gray-700"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
```

### Modifications à apporter

**a) Import de l'icône** — ajouter en haut du fichier :

```tsx
import { ChevronRight, ChevronDown } from 'lucide-react';
```

**b) État local `showEntityFilters`** — l'ajouter après les `useState` des
registres (l'initialiseur paresseux lit l'URL une seule fois au montage) :

```tsx
// Panneau des filtres par entité : replié par défaut, MAIS auto-ouvert si on
// arrive avec un filtre entité déjà actif (état d'UI éphémère, hors URL).
const [showEntityFilters, setShowEntityFilters] = useState(
  () => (params.get('entity') ?? '').split(',').filter(Boolean).length > 0,
);
```

**c) Liste des types affichables** — la calculer une fois (remonte la garde
`opts.length === 0`) pour piloter à la fois la présence du bouton et le rendu de la
rangée 2. À placer après le calcul de `selectedEntities` :

```tsx
// Types d'entité qui ont au moins une entité à proposer (les autres n'ont aucun
// menu à afficher). Pilote la présence du bouton « Entités » ET la rangée 2.
const entityTypesWithOpts = entityTypes.filter((t) =>
  entities.some((e) => e.entity_type === t.slug),
);
```

**d) Nouveau `return`** — remplacer l'unique `<div className="flex flex-wrap …">`
par un conteneur en colonne à deux rangées. Les 5 filtres cœur restent identiques ;
la boucle des entités sort de la rangée 1 ; on ajoute le bouton « Entités » ; le
bouton « Réinitialiser » reste en rangée 1 :

```tsx
  return (
    <div className="flex flex-col gap-2">
      {/* Rangée 1 : filtres cœur + bouton Entités + Réinitialiser */}
      <div className="flex flex-wrap items-center gap-2">
        {/* … les 5 <select> Type / Auteur / Origine / Date / Thème INCHANGÉS … */}

        {entityTypesWithOpts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowEntityFilters((v) => !v)}
            aria-expanded={showEntityFilters}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${
              selectedEntities.length > 0
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 bg-white text-gray-700'
            }`}
          >
            {showEntityFilters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Entités{selectedEntities.length > 0 ? ` (${selectedEntities.length})` : ''}
          </button>
        )}

        {params.toString() !== '' && (
          <button
            type="button"
            onClick={() => router.push('/sources')}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {/* Rangée 2 : filtres par entité (repliable) */}
      {showEntityFilters && entityTypesWithOpts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {entityTypesWithOpts.map((t) => {
            const opts = entities.filter((e) => e.entity_type === t.slug);
            return (
              <label
                key={t.slug}
                className="flex items-center gap-1.5 text-sm text-gray-600"
              >
                <span>{t.label} :</span>
                <select
                  className={selectClass}
                  value={entityValueForType(t.slug)}
                  onChange={(e) => setEntity(t.slug, e.target.value)}
                >
                  <option value="">Tous</option>
                  {opts.map((e) => (
                    <option key={e.slug} value={e.slug}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
```

**Note d'intégration** : les 5 `<select>` cœur (Type, Auteur, Origine, Date,
Thème) sont recopiés **tels quels** dans la rangée 1 ; seule leur enveloppe change.
Les helpers `entityById`, `entityValueForType`, `setEntity`, `selectedEntities`,
`selectClass` restent inchangés. L'ancienne boucle `entityTypes.map` (rangée
unique, option « Tous · {label} ») est supprimée au profit de la rangée 2.

## Décisions

- **Levier A (disclosure inline, 2ᵉ rangée) plutôt que B (popover flottant) ou C
  (combobox recherchable).** Choisi par Arthur via previews. A répond exactement au
  besoin (désencombrer la vue par défaut), tient dans un seul fichier, ne touche à
  aucune logique risquée. B (panneau flottant) : écarté car aucun composant popover
  n'existe dans le projet (à construire, gestion Échap/clic-dehors) pour un gain
  visuel modeste à l'échelle actuelle. C (recherche + cases à cocher) : écarté car
  surdimensionné pour 19 entités aujourd'hui (ingénierie prématurée) — c'est
  l'évolution future quand un menu individuel deviendra trop long à scroller.
- **Compteur « Entités (N) » + style actif indigo.** Décidé par défaut (Arthur
  informé). Sans ce repère, un filtre entité appliqué puis replié deviendrait
  invisible → confusion. N = `selectedEntities.length`.
- **Ouverture auto au montage si `?entity=…` actif.** Décidé par défaut (Arthur
  informé). Évite d'arriver sur une page filtrée sans voir les menus qui filtrent.
  Implémenté par initialiseur paresseux de `useState` (lecture unique au montage,
  pas de réouverture forcée ensuite).
- **Pas de bouton « effacer les entités » dédié.** Le « Réinitialiser » global
  efface déjà tout (dont `entity`). Arthur a validé de rester simple.
- **`showEntityFilters` en `useState` local, pas dans l'URL.** C'est un état
  d'affichage éphémère, pas un filtre : il n'a pas à être partageable ni persisté.
  Assumé comme premier état non-URL de la barre.
- **Libellé de l'option vide : « Tous » (au lieu de « Tous · {label} »).** En
  rangée 2, le type est désormais un texte visible qui préfixe le menu (« Outils :
  [Tous ▾] ») ; répéter le label dans l'option serait redondant.

## Hors périmètre

- **Levier C — combobox recherchable** (champ de recherche + cases à cocher
  groupées par type + étiquettes d'entités actives). Évolution future, pas
  maintenant.
- **Le filtre Thème** reste un `<select>` unique en rangée 1 : un seul menu quel
  que soit le nombre de thèmes, donc aucun problème de croissance. Non touché.
- **Schéma d'URL** (`?entity=slug,slug`, type-agnostique), logique de filtrage
  (`SourceList.tsx`, ET entre entités sélectionnées), API `/api/entities`,
  registre des entités : **rien de tout cela n'est modifié.**
- **Sélection multiple d'entités du même type** : on garde le single-select par
  type (un menu = une entité au plus). Non modifié.
- Auto-fermeture du panneau quand on efface les entités : non — le panneau reste
  ouvert tant que l'utilisateur ne le replie pas (il est en train de l'utiliser).

## Todo

- [x] **1. Import de l'icône.** Ajouter `import { ChevronRight, ChevronDown } from 'lucide-react';`
  en tête de `web/components/sources/FilterBar.tsx`.
  *Vérif :* `npm run lint` n'est PAS configuré dans ce repo (ESLint pose une question
  interactive) → remplacé par `npx tsc --noEmit` (exit 0) ; les deux icônes sont
  utilisées dans le JSX, aucun import inutilisé.

- [x] **2. État local `showEntityFilters`** avec initialiseur paresseux basé sur
  `params.get('entity')` (voir bloc (b) du Plan).
  *Vérif :* `npx tsc --noEmit` exit 0.

- [x] **3. Liste `entityTypesWithOpts`** (voir bloc (c) du Plan), après
  `selectedEntities`.
  *Vérif :* `npx tsc --noEmit` exit 0.

- [x] **4. Réécrire le `return`** en conteneur `flex flex-col gap-2` à deux
  rangées (voir bloc (d)) : rangée 1 = 5 filtres cœur inchangés + bouton
  « Entités » (conditionné à `entityTypesWithOpts.length > 0`, compteur + style
  actif indigo, chevron) + « Réinitialiser » inchangé ; rangée 2 conditionnelle =
  menus par type préfixés « {label} : », option vide « Tous ». Supprimer l'ancienne
  boucle `entityTypes.map` en rangée unique.
  *Vérif :* `npx tsc --noEmit` exit 0 + le composant compile ET se rend correctement
  dans le `next dev` en cours (rendu DOM observé en CDP, cf. item 5). `npm run build`
  complet NON lancé : un `next dev` concurrent possède le `.next` partagé, un build
  le corromprait (leçon 2026-07-21). Voir Bilan.

- [x] **5. Vérification comportementale dans l'app** — prouvée en pilotant un Chrome
  headless en CDP (zéro dépendance) contre le `next dev` en cours (port 3000). DOM
  observé pour chaque scénario :
  - (a) **Replié par défaut** (`/sources`) : bouton « Entités » (texte exact `Entités`,
    sans compteur), chevron `lucide-chevron-right`, **0** menu par entité, style gris.
    NB : « Réinitialiser » absent car aucun filtre actif — comportement pré-existant
    inchangé (bouton conditionné à `params.toString() !== ''`).
  - (b) **Dépliage** : clic → chevron `lucide-chevron-down`, **5** menus par type
    (« Entreprises : », « Modèles : », « Objet mathematique : », « Personnes : »,
    « Outils : »). Re-clic → chevron `chevron-right`, 0 menu.
  - (c) **Compteur** : Outils → n8n (drive React `change`) → URL `?entity=n8n`, bouton
    `Entités (1)` + style indigo (`border-indigo-300 bg-indigo-50 text-indigo-700`),
    « Réinitialiser » apparaît. Liste : **23 → 2** ressources (filtrage prouvé).
    Replier → `Entités (1)` + indigo CONSERVÉS (filtre non masqué).
  - (d) **Ouverture auto** : `/sources?entity=n8n` en accès direct → chevron
    `chevron-down` (déjà déplié au montage), 5 menus, bouton `Entités (1)`.
  - (e) **Réinitialiser** → URL `/sources`, bouton repasse à `Entités` (compteur parti),
    style gris. Le panneau reste déplié (conforme à la décision « pas d'auto-fermeture »).

- [x] **6. Non-régression.** `npm run test` = **205 pass / 0 fail** — le changement est
  purement présentation, aucun test lib n'a bougé.

## Bilan

**Fait, conforme au plan.** Un seul fichier touché — `web/components/sources/FilterBar.tsx`
— exactement comme prévu. Les 4 modifications de code (import icônes, état
`showEntityFilters` à initialiseur paresseux, liste `entityTypesWithOpts`, `return` à
deux rangées) sont appliquées telles que décrites dans les blocs (a)–(d) du Plan.
Aucune logique de filtrage, aucun schéma d'URL, aucune API n'a été modifié. Tous les
comportements cibles sont **prouvés par pilotage réel du navigateur** (CDP sur le
`next dev` en cours) : repli par défaut, dépliage/repli, compteur « Entités (N) » +
style indigo persistants après repli, ouverture auto sur `?entity=…`, retour propre au
« Réinitialiser », et filtrage effectif de la liste (23 → 2).

**Déviations (mineures, assumées) :**
1. **`npm run lint` remplacé par `npx tsc --noEmit`.** ESLint n'est pas configuré dans
   ce repo — `next lint` ouvre un assistant de config interactif au lieu de linter. Le
   typecheck (`tsc --noEmit`, exit 0) couvre la sûreté de types ; les deux icônes
   importées sont utilisées (pas d'import mort).
2. **`npm run build` complet non exécuté.** Un `next dev` d'une autre session possédait
   le `.next` partagé au moment de l'implémentation ; lancer un build l'aurait corrompu
   (leçon 2026-07-21). Le composant étant purement présentation, sa correction est
   couverte par (a) le typecheck vert et (b) son **rendu réel** dans le `next dev` en
   cours — s'il s'affiche dans le DOM, c'est qu'il a compilé. Un build de prod
   n'apporterait rien de plus ici (pas de dépendance nouvelle, pas de code serveur, pas
   de changement de config). Si Arthur veut néanmoins la preuve d'un build de prod, la
   refaire une fois le serveur concurrent arrêté.

**Détail de rendu observé, non spécifié mais correct :** le libellé du type entité
« objet mathematique » s'affiche sans accent ni majuscule (« Objet mathematique : »),
car il vient tel quel du registre `/api/entities`. Hors périmètre de ce chantier
(affichage des libellés d'entités), à traiter séparément si Arthur le souhaite.
