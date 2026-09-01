/**
 * Greffe chirurgicale d'un bloc figure (rattrapage page par page). On vérifie les trois
 * cas : remplacement en place (ancre `?page=N` présente), insertion en ordre de page, et
 * qu'aucune AUTRE section n'est touchée (frontmatter, nav, blocs d'autres pages).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graftFigureBlock, hasFigureForPage } from '../figure-block';

const FILE = 'Deck%20X.pdf';
const figBlock = (n: number, title: string) =>
  `## ${title}\n\`topics: [t]\`\n\nLégende page ${n}. *(Figure — description machine, page ${n} de la source, non-verbatim.)*\n\n![${title}](/api/raw-image/${FILE}?page=${n})\n\n**Texte littéral :** « a » · « b »`;

const DOC = [
  '---',
  'slug: deck-x',
  'title: "Deck X"',
  'source_file: "Deck X.pdf"',
  '---',
  '',
  '> Par [[../authors/x|X]]',
  '',
  '## Intro',
  '`topics: [t]`',
  '',
  'Texte intro verbatim.',
  '',
  figBlock(3, 'Figure trois'),
  '',
  figBlock(7, 'Figure sept'),
  '',
].join('\n');

test('remplacement EN PLACE : seule la section de la page N change', () => {
  const nb = figBlock(3, 'Figure trois RETRAITÉE');
  const out = graftFigureBlock(DOC, 3, nb);
  assert.ok(out.includes('Figure trois RETRAITÉE'), 'nouveau bloc page 3 présent');
  assert.ok(!out.includes('## Figure trois\n'), 'ancien titre page 3 retiré');
  assert.ok(out.includes('## Figure sept'), 'page 7 intacte');
  assert.ok(out.includes('Texte intro verbatim.'), 'intro intacte');
  assert.ok(out.includes('slug: deck-x') && out.includes('> Par [['), 'frontmatter + nav intacts');
  // Une seule ancre page=3, toujours une ancre page=7.
  assert.equal((out.match(/\?page=3(?![0-9])/g) || []).length, 1);
  assert.equal((out.match(/\?page=7(?![0-9])/g) || []).length, 1);
});

test('insertion EN ORDRE : page 5 se place entre page 3 et page 7', () => {
  const out = graftFigureBlock(DOC, 5, figBlock(5, 'Figure cinq'));
  assert.ok(hasFigureForPage(out, 5));
  const i3 = out.indexOf('?page=3');
  const i5 = out.indexOf('?page=5');
  const i7 = out.indexOf('?page=7');
  assert.ok(i3 < i5 && i5 < i7, `ordre attendu 3<5<7, obtenu ${i3},${i5},${i7}`);
  // Les blocs 3 et 7 restent uniques et inchangés.
  assert.ok(out.includes('## Figure trois') && out.includes('## Figure sept'));
});

test('insertion en FIN : page 9 (au-delà de toutes) est appendue', () => {
  const out = graftFigureBlock(DOC, 9, figBlock(9, 'Figure neuf'));
  const i7 = out.indexOf('?page=7');
  const i9 = out.indexOf('?page=9');
  assert.ok(i7 < i9, 'page 9 après page 7');
  assert.ok(out.trimEnd().endsWith('« b »'), 'le nouveau bloc est bien le dernier');
});

test('hasFigureForPage : ancre stricte (page 3 ≠ page 30)', () => {
  assert.equal(hasFigureForPage(DOC, 3), true);
  assert.equal(hasFigureForPage(DOC, 30), false);
  assert.equal(hasFigureForPage(DOC, 4), false);
});
