'use client';

// useScrollRestoration — restaure la position de défilement d'un conteneur
// scrollable quand on quitte une page puis y revient.
//
// Même problème que `usePersistentState` : la page est démontée à la navigation,
// donc son `scrollTop` est perdu. On mémorise la position dans une `Map` au niveau
// module (survit à la navigation SPA), et on la ré-applique au (re)montage.
//
// SUBTILITÉ 1 (pourquoi pas « set au montage ») : nos pages chargent leurs données
// APRÈS le montage (fetch dans un useEffect). Au premier rendu la liste est vide →
// le conteneur n'est pas assez haut pour honorer la position sauvegardée (le
// navigateur clampe `scrollTop` à 0). On RÉ-APPLIQUE donc la position tant que le
// contenu grandit, dans une fenêtre bornée, et on CESSE dès que l'utilisateur amorce
// lui-même un défilement (pour ne pas le combattre — cf. lessons.md « un auto-scroll
// doit être conditionné »).
//
// SUBTILITÉ 2 (pourquoi PAS « save au démontage ») : au démontage lors d'une
// navigation, le navigateur a déjà remis `scrollTop` à 0 — sauvegarder à ce moment
// écraserait la bonne valeur (constaté en pilotage Chrome). On enregistre donc la
// position EN CONTINU via l'écouteur `scroll` (dernière position réelle), jamais au
// cleanup.
//
// Usage : `const ref = useScrollRestoration<HTMLDivElement>('sources:scroll');`
// puis poser `ref` sur le conteneur `overflow-y-auto` racine de la page.
//
// CONVENTION DE CLÉS identique à usePersistentState : `'<page>:scroll'`, stable et
// immuable une fois en place (la renommer = perdre la position mémorisée).

import { useEffect, useRef } from 'react';

const scrollStore = new Map<string, number>();

// Nombre max de frames de tentative de restauration (~1,5 s à 60 fps) : couvre
// l'arrivée asynchrone des données locales sans boucler indéfiniment si le contenu
// reste plus court que la position visée.
const MAX_FRAMES = 90;

export function useScrollRestoration<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const saved = scrollStore.get(key) ?? 0;
    // Phase « restauration » tant qu'on a une position non nulle à réappliquer.
    let restoring = saved > 0;

    // Source de vérité continue : chaque défilement met à jour la position — SAUF
    // pendant la restauration, où c'est NOUS qui pilotons `scrollTop` (sinon on
    // écraserait la cible avec la valeur clampée d'une liste encore vide).
    const onScroll = () => {
      if (restoring) return;
      scrollStore.set(key, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // Fin de restauration : on fige la position atteinte et on repasse en mode
    // « enregistrement continu ».
    const finishRestore = () => {
      restoring = false;
      scrollStore.set(key, el.scrollTop);
    };

    // L'utilisateur amorce un défilement (molette / tactile / clavier) : on cesse
    // immédiatement de restaurer. On écoute ces intentions RÉELLES plutôt que
    // l'événement `scroll` (que nos propres `scrollTop = saved` déclenchent aussi).
    const cancelOnUser = () => {
      if (restoring) finishRestore();
    };

    let raf = 0;
    if (restoring) {
      el.addEventListener('wheel', cancelOnUser, { passive: true });
      el.addEventListener('touchstart', cancelOnUser, { passive: true });
      window.addEventListener('keydown', cancelOnUser);

      let frames = 0;
      const tryRestore = () => {
        if (!restoring) return;
        el.scrollTop = saved;
        frames += 1;
        if (el.scrollTop >= saved - 1) {
          // La position a « pris » : le contenu est assez haut.
          finishRestore();
          return;
        }
        if (frames < MAX_FRAMES) {
          raf = requestAnimationFrame(tryRestore);
        } else {
          // Le contenu n'a jamais atteint la hauteur voulue (moins d'items
          // qu'avant) : on s'arrête sur la position maximale atteinte.
          finishRestore();
        }
      };
      raf = requestAnimationFrame(tryRestore);
    }

    return () => {
      // NE PAS sauvegarder ici : au démontage (navigation), le navigateur a déjà
      // remis scrollTop à 0 → on écraserait la bonne valeur. `onScroll` tient déjà
      // scrollStore à jour en continu, et `finishRestore` fige la position après une
      // restauration. Le cleanup se contente de retirer les écoutes.
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', cancelOnUser);
      el.removeEventListener('touchstart', cancelOnUser);
      window.removeEventListener('keydown', cancelOnUser);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);

  return ref; // à poser sur le conteneur scrollable
}
