import type { LinksValue } from '@/components/upload/LinkPicker';

/**
 * Helpers PURS de fusion des brouillons d'upload (aucune dépendance DOM/React).
 *
 * Pourquoi : dans LinkPicker/ThemePicker, un nom TAPÉ vit dans un état local du
 * picker (`drafts`/`draft`) et ne rejoint la valeur remontée au parent qu'après
 * validation explicite (`+`/Entrée). Soumettre sans valider perdait le brouillon.
 * Ces helpers matérialisent la règle de fusion (identique à `add`) pour qu'elle
 * soit testable sans DOM et réutilisée par les pickers ET par leur `flush()`.
 *
 * Sémantique alignée sur l'ancien `add` : trim, ignore vide, dédup insensible à
 * la casse. PAS de slugify — le serveur (`parseLinks`/`parseThemes`) slugifie.
 */

/**
 * Ajoute `name` (trimé) à `list` s'il est non vide et pas déjà présent
 * (comparaison `toLowerCase`). Retourne une NOUVELLE liste, ou `list` telle
 * quelle si le nom est vide/dupliqué.
 */
export function addName(list: string[], name: string): string[] {
  const n = name.trim();
  if (!n) return list;
  if (list.some((x) => x.toLowerCase() === n.toLowerCase())) return list;
  return [...list, n];
}

/**
 * Fusionne les brouillons tapés (`{ type → texte }`) dans la valeur des liens.
 * Pour chaque type présent dans `drafts`, applique `addName` sur son tableau.
 * Un type dont le brouillon est vide n'introduit PAS de clé (`merged.length` nul)
 * → aucun type vide n'est créé. Les types absents de `drafts` restent inchangés.
 * Retourne un nouvel objet.
 */
export function mergeLinkDrafts(value: LinksValue, drafts: Record<string, string>): LinksValue {
  const out: LinksValue = { ...value };
  for (const [type, raw] of Object.entries(drafts)) {
    const merged = addName(out[type] ?? [], raw);
    if (merged.length) out[type] = merged;
  }
  return out;
}

/**
 * Fusionne l'unique brouillon de thème dans la liste plate (mêmes règles).
 */
export function mergeThemeDraft(value: string[], draft: string): string[] {
  return addName(value, draft);
}
