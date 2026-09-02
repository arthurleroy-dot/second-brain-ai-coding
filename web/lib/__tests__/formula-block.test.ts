/**
 * Greffe chirurgicale d'un bloc formule (révision IA des formules). On vérifie : listing
 * (0 / 1 / N blocs, index + LaTeX corrects), greffe du BON index sans toucher aux autres,
 * index hors bornes (no-op), et non-régression du reste du corps + du marqueur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFormulaBlocks, graftFormulaBlock, FORMULA_MARKER } from '../formula-block';

const fBlock = (latex: string) => `$$\n${latex}\n$$\n${FORMULA_MARKER}`;

const LATEX_A = 'A = \\begin{bmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\end{bmatrix}';
const LATEX_B = 'B = \\begin{bmatrix} 7 & 8 \\\\ 9 & 0 \\end{bmatrix}';

const DOC = [
  '---',
  'slug: matrices',
  'title: "Matrices"',
  'source_file: "matrices.txt"',
  '---',
  '',
  '> Par [[../authors/x|X]] · Thèmes : [[../themes/t|T]]',
  '',
  '## Première matrice',
  '`topics: [t]`',
  '',
  'Un peu de texte verbatim avant.',
  '',
  fBlock(LATEX_A),
  '',
  '## Un bloc de code (ne doit pas être vu comme une formule)',
  '`topics: [t]`',
  '',
  '```python',
  'def f():',
  '    return 1',
  '```',
  '',
  '## Deuxième matrice',
  '`topics: [t]`',
  '',
  fBlock(LATEX_B),
  '',
  'Texte verbatim final.',
  '',
].join('\n');

test('listing : 0 bloc dans un corps sans formule', () => {
  assert.deepEqual(listFormulaBlocks('# Titre\n\nJuste du texte, pas de maths.\n'), []);
});

test('listing : 1 bloc — index 0 + LaTeX intérieur exact', () => {
  const md = `Intro\n\n${fBlock(LATEX_A)}\n\nFin\n`;
  const blocks = listFormulaBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].index, 0);
  assert.equal(blocks[0].latex, LATEX_A);
});

test('listing : N blocs — dans l’ordre du document, indices 0..N-1', () => {
  const blocks = listFormulaBlocks(DOC);
  assert.equal(blocks.length, 2);
  assert.deepEqual(
    blocks.map((b) => b.index),
    [0, 1],
  );
  assert.equal(blocks[0].latex, LATEX_A);
  assert.equal(blocks[1].latex, LATEX_B);
});

test('greffe : remplace le BON index (1) sans toucher à l’autre (0)', () => {
  const NEW = 'B = \\begin{bmatrix} 7 & 8 \\\\ 9 & 1 \\end{bmatrix}';
  const out = graftFormulaBlock(DOC, 1, NEW);
  const blocks = listFormulaBlocks(out);
  assert.equal(blocks.length, 2, 'toujours 2 blocs');
  assert.equal(blocks[0].latex, LATEX_A, 'bloc 0 intact');
  assert.equal(blocks[1].latex, NEW, 'bloc 1 mis à jour');
  // Le marqueur reste présent DEUX fois (un par bloc).
  assert.equal((out.match(new RegExp(escapeForCount(FORMULA_MARKER), 'g')) || []).length, 2);
});

test('greffe : conserve les $$, le marqueur et le reste du corps', () => {
  const out = graftFormulaBlock(DOC, 0, 'X = 1');
  assert.ok(out.includes('$$\nX = 1\n$$'), 'nouveau LaTeX entre $$ propres');
  assert.ok(out.includes(FORMULA_MARKER), 'marqueur conservé');
  // Tout le reste (frontmatter, nav, code, texte, 2e bloc) inchangé.
  assert.ok(out.includes('slug: matrices') && out.includes('> Par [['), 'frontmatter + nav intacts');
  assert.ok(out.includes('```python') && out.includes('def f():'), 'bloc de code intact');
  assert.ok(out.includes(LATEX_B), '2e formule intacte');
  assert.ok(out.includes('Texte verbatim final.'), 'texte final intact');
  // L'ancien LaTeX du bloc 0 a bien disparu.
  assert.ok(!out.includes(LATEX_A), 'ancien LaTeX du bloc 0 retiré');
});

test('greffe : index hors bornes → corps inchangé', () => {
  assert.equal(graftFormulaBlock(DOC, 2, 'ZZZ'), DOC, 'index trop grand = no-op');
  assert.equal(graftFormulaBlock(DOC, -1, 'ZZZ'), DOC, 'index négatif = no-op');
  assert.equal(graftFormulaBlock('aucune formule ici', 0, 'ZZZ'), 'aucune formule ici', 'aucun bloc = no-op');
});

test('greffe : un newLatex avec espaces autour est nettoyé (bloc canonique)', () => {
  const out = graftFormulaBlock(DOC, 0, '\n\n  Y = 2  \n\n');
  assert.ok(out.includes('$$\nY = 2\n$$'), 'trim des blancs autour, LaTeX interne préservé');
});

/** Échappe pour un comptage RegExp (local au test — le helper a le sien). */
function escapeForCount(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
