/**
 * Greffe CHIRURGICALE d'un bloc figure dans une fiche ressource (rattrapage page par
 * page, cf. spec §D). Un bloc figure est une section `##` dont le corps contient la ligne
 * image `![…](/api/raw-image/<fichier>?page=N)` — l'**ancre de page**. Pour une page N :
 *   - si une section porte déjà l'ancre `?page=N` → on la **REMPLACE** en place ;
 *   - sinon → on **INSÈRE** le nouveau bloc en ordre de page parmi les autres blocs figure
 *     (avant le premier bloc de page > N), à défaut en fin de corps.
 * Ne touche à RIEN d'autre (frontmatter, nav, autres sections). Fonction PURE (testable).
 */

/** Ancre stricte d'une page donnée (le `(?!\d)` évite que page=3 matche page=30). */
function anchorRe(pageNumber: number): RegExp {
  return new RegExp(`/api/raw-image/[^\\s)]*[?&]page=${pageNumber}(?![0-9])`);
}
/** Numéro de page porté par une section (via sa ligne image), ou null. */
const PAGE_OF = /\/api\/raw-image\/[^\s)]*[?&]page=(\d+)(?![0-9])/;

interface Section {
  start: number;
  end: number;
  text: string;
}

/** Découpe les lignes en sections `##` (heading h2 inclus). Le frontmatter (pas de `## `) est ignoré. */
function h2Sections(lines: string[]): Section[] {
  const heads: number[] = [];
  for (let i = 0; i < lines.length; i++) if (/^##\s+/.test(lines[i])) heads.push(i);
  return heads.map((start, k) => {
    const end = k + 1 < heads.length ? heads[k + 1] : lines.length;
    return { start, end, text: lines.slice(start, end).join('\n') };
  });
}

/** Recolle `before` + `block` + `after` avec des séparations propres et un `\n` final. */
function joinParts(before: string, block: string, after: string): string {
  const parts = [before.replace(/\n+$/, ''), block.trim(), after.replace(/^\n+/, '')].filter((p) => p.length > 0);
  let out = parts.join('\n\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

export function graftFigureBlock(md: string, pageNumber: number, newBlock: string): string {
  const lines = md.split('\n');
  const sections = h2Sections(lines);

  // 1) Remplacement en place si l'ancre `?page=N` existe déjà.
  const re = anchorRe(pageNumber);
  const target = sections.find((s) => re.test(s.text));
  if (target) {
    return joinParts(lines.slice(0, target.start).join('\n'), newBlock, lines.slice(target.end).join('\n'));
  }

  // 2) Insertion en ordre de page : avant le premier bloc figure de page > N, sinon en fin.
  let insertAt = lines.length;
  for (const s of sections) {
    const m = s.text.match(PAGE_OF);
    if (m && Number(m[1]) > pageNumber) {
      insertAt = s.start;
      break;
    }
  }
  return joinParts(lines.slice(0, insertAt).join('\n'), newBlock, lines.slice(insertAt).join('\n'));
}

/** Vrai si la fiche contient déjà un bloc figure pour cette page (ancre présente). */
export function hasFigureForPage(md: string, pageNumber: number): boolean {
  return anchorRe(pageNumber).test(md);
}
