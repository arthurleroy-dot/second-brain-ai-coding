/**
 * Greffe CHIRURGICALE d'un bloc formule dans une fiche ressource (révision IA des
 * formules, cf. spec `2026-09-02-rendu-code-et-formules-maths` §3.1). Analogue de
 * `figure-block.ts`, mais l'ancre n'est PAS une page : c'est l'**ordre d'apparition**
 * (index 0-based) des blocs formule dans le corps.
 *
 * Un bloc formule = un couple `$$…$$` (sur lignes propres) immédiatement suivi (lignes
 * vides tolérées) du **marqueur** `*(Formule reconstruite — non-verbatim.)*`. Ce couple
 * est ce qui distingue une formule RECONSTRUITE (révisable) d'un éventuel `$$…$$` non
 * marqué. Fonctions PURES (testables sans I/O ni appel IA).
 */

/** Marqueur canonique d'un bloc formule (identique au prompt d'ingestion et à la doc). */
export const FORMULA_MARKER = '*(Formule reconstruite — non-verbatim.)*';

/** Échappe une chaîne pour l'insérer littéralement dans une RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fabrique une RegExp FRAÎCHE (le drapeau `g` porte un `lastIndex` mutable — une
 * instance partagée entre `matchAll`/`replace` corromprait l'itération). Capture :
 *   groupe 1 = le LaTeX intérieur (entre les `$$`) ;
 *   groupe 2 = la « queue » (blancs + saut(s) de ligne + marqueur) → réinjectée telle
 *              quelle à la greffe pour préserver l'espacement exact.
 */
function formulaRe(): RegExp {
  return new RegExp(`\\$\\$\\n([\\s\\S]*?)\\n\\$\\$(\\s*\\n+${escapeRe(FORMULA_MARKER)})`, 'g');
}

export interface FormulaBlock {
  /** Index d'apparition (0-based) dans le corps — l'ancre stable de la révision. */
  index: number;
  /** LaTeX intérieur du bloc (ce qui est entre les `$$`), tel qu'écrit. */
  latex: string;
}

/** Liste les blocs formule (index dans l'ordre du document + LaTeX intérieur). Pure. */
export function listFormulaBlocks(md: string): FormulaBlock[] {
  const out: FormulaBlock[] = [];
  let index = 0;
  for (const m of md.matchAll(formulaRe())) {
    out.push({ index, latex: m[1] });
    index++;
  }
  return out;
}

/**
 * Remplace EN PLACE le LaTeX du bloc formule d'index `index` par `newLatex` (conserve
 * les `$$` et le marqueur, ainsi que l'espacement exact avant le marqueur). Ne touche à
 * RIEN d'autre. Pure. `index` hors bornes (ou négatif) → renvoie `md` inchangé.
 */
export function graftFormulaBlock(md: string, index: number, newLatex: string): string {
  const clean = newLatex.trim();
  let i = -1;
  return md.replace(formulaRe(), (full, _latex: string, tail: string) => {
    i++;
    if (i !== index) return full;
    return `$$\n${clean}\n$$${tail}`;
  });
}
