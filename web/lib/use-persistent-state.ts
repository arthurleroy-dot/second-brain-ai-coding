'use client';

// usePersistentState — un `useState` dont l'état SURVIT à la navigation SPA.
//
// Problème résolu : la navigation de l'app est client-side (next/link), mais
// chaque page.tsx est DÉMONTÉE puis remontée à neuf quand on la quitte et qu'on y
// revient. Un `useState` classique repart donc de sa valeur initiale à chaque
// retour (filtre perdu, recherche effacée, onglet oublié). On adosse l'état à une
// `Map` AU NIVEAU MODULE : la SPA ne recharge jamais ce module, donc la Map
// survit d'une page à l'autre. Au (re)montage, on restaure la dernière valeur.
//
// Portée : la navigation SPA uniquement. Un rechargement COMPLET de l'app vide la
// Map (état en mémoire). C'est voulu — la demande ne concerne que « je retrouve
// ma place quand je vais d'une page à l'autre ». (Option non retenue ici : adosser
// à sessionStorage pour survivre au reload — à réserver aux états sérialisables.)
//
// CONVENTION DE CLÉS : chaîne stable `'<page>:<champ>'` (ex. `'sources:search'`,
// `'wiki:scroll'`). Comme les slugs du wiki, ces clés sont IMMUABLES une fois en
// place : les renommer = perdre l'état associé. Une clé n'a qu'un consommateur à
// la fois (la page précédente est démontée avant le retour), donc un `useState` +
// lazy-init depuis la Map suffit — pas besoin de `useSyncExternalStore`.

import { useCallback, useState } from 'react';

const store = new Map<string, unknown>(); // survit à la navigation SPA

export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (v: T | ((p: T) => T)) => void] {
  // Lazy init : restaure depuis le store au (re)montage, sinon valeur initiale.
  const [value, setValue] = useState<T>(() =>
    store.has(key) ? (store.get(key) as T) : initial,
  );
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        store.set(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, set];
}
