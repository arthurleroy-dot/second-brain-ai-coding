/**
 * Transformations d'affichage du markdown du wiki avant rendu (react-markdown) :
 * - convertit les wikilinks Obsidian `[[../resources/slug#anchor|Label]]` en
 *   liens markdown vers les pages de la plateforme ;
 * - retire les lignes d'annotation de chunk (`topics:` / `entities:`) et le
 *   blockquote de navigation, qui sont des métadonnées affichées ailleurs.
 */

/** `[[cible|Label]]` ou `[[cible]]` → lien markdown vers la bonne route. */
export function wikilinksToMarkdown(md: string): string {
  return md.replace(/\[\[([^\]]+)\]\]/g, (_full, inner: string) => {
    const [target, labelRaw] = String(inner).split('|');
    const label = (labelRaw ?? target).trim();
    // Cible du type "../resources/slug#anchor" ou "resources/slug"
    const cleaned = target.trim().replace(/^\.\.\//, '').replace(/^\//, '');
    const [pathPart] = cleaned.split('#');
    const seg = pathPart.split('/');
    const kind = seg.length > 1 ? seg[0] : '';
    const slug = seg[seg.length - 1];

    if (kind === 'resources') return `[${label}](/sources/${slug})`;
    if (kind === 'themes') return `[${label}](/wiki/${slug})`;
    if (kind === 'entities') return `[${label}](/entities/${slug})`;
    // authors / by-date : pas de page dédiée → texte simple.
    return label;
  });
}

/** Retire les lignes `topics:` / `entities:` backtickées et le blockquote de nav. */
export function stripChunkAnnotations(md: string): string {
  return md
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^`(topics|entities):\s*\[[^\]]*\]`$/.test(t)) return false;
      if (/^>\s*Par\s+/i.test(t)) return false; // blockquote de navigation
      return true;
    })
    .join('\n');
}

/** Prépare le corps d'une ressource pour l'affichage prose. */
export function resourceBodyForDisplay(body: string): string {
  return wikilinksToMarkdown(stripChunkAnnotations(body)).trim();
}

/** Prépare une page thématique/vue dérivée pour l'affichage prose. */
export function derivedPageForDisplay(body: string): string {
  return wikilinksToMarkdown(body).trim();
}
