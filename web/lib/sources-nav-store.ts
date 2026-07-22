'use client';

// Mémorise la DERNIÈRE query string de /sources (les filtres y vivent dans l'URL).
//
// But : quand on revient sur « Sources » via la barre latérale — dont le lien
// pointe vers `/sources` NU — on veut retrouver les filtres précédents. L'URL
// reste la SOURCE UNIQUE de vérité des filtres (aucune duplication d'état) ; ce
// store ne fait que retenir la dernière query pour reconstruire le lien du menu.
//
// Store module-level (comme chat-stream-store / ingest-view-store) : il survit à
// la navigation SPA, et la barre latérale — montée une seule fois dans le layout,
// jamais remontée — s'y abonne via `useSyncExternalStore` pour garder son lien à
// jour. Un rechargement complet le remet à zéro (état en mémoire) : c'est voulu.

let lastQuery = '';
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Abonnement pour `useSyncExternalStore` (barre latérale). */
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Dernière query string de /sources (sans le `?`), '' si aucune. */
export function getSourcesQuery(): string {
  return lastQuery;
}

/** Enregistre la query courante de /sources (appelé par SourceList). */
export function setSourcesQuery(q: string): void {
  if (q === lastQuery) return; // référence stable → pas de re-render inutile
  lastQuery = q;
  emit();
}
