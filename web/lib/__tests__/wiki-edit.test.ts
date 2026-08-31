/**
 * Tests du cœur déterministe d'ÉDITION (`wiki-edit.ts`) — fonctions PURES.
 * Lancé par `npm --prefix web run test` (node:test + tsx, zéro dépendance).
 * Fixtures inline fidèles au format réel d'une page ressource ingérée.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setInlineArray,
  reconcileChunkAnnotations,
  buildEditedResourceContent,
} from '../wiki-edit';
import { splitFrontmatter, parseResourceMeta } from '../wiki-mutate';

// ————————————————————————————————————————————————————————————————
// setInlineArray

test('setInlineArray remplace une liste existante par la liste complète', () => {
  const fm = 'slug: x\ntopics: [a, b, c]\nentities: [z]';
  assert.equal(setInlineArray(fm, 'topics', ['a', 'd']), 'slug: x\ntopics: [a, d]\nentities: [z]');
});

test('setInlineArray écrit une liste vide []', () => {
  const fm = 'topics: [a, b]\nentities: [z]';
  assert.equal(setInlineArray(fm, 'entities', []), 'topics: [a, b]\nentities: []');
});

test('setInlineArray crée `entities` juste après `topics` si absent', () => {
  const fm = 'slug: x\ntopics: [a]\nurl: ""';
  assert.equal(setInlineArray(fm, 'entities', ['e1']), 'slug: x\ntopics: [a]\nentities: [e1]\nurl: ""');
});

test('setInlineArray ajoute une clé absente en fin (hors entities)', () => {
  const fm = 'slug: x\nurl: ""';
  assert.equal(setInlineArray(fm, 'topics', ['a', 'b']), 'slug: x\nurl: ""\ntopics: [a, b]');
});

// ————————————————————————————————————————————————————————————————
// reconcileChunkAnnotations

test('reconcileChunkAnnotations retire un slug hors ensemble et préserve le verbatim', () => {
  const body = [
    '## Section 1',
    '`topics: [a, b]`',
    '`entities: [e1, e2]`',
    '',
    'Texte verbatim inchangé, avec des mots.',
    '## Section 2',
    '`entities: [e2]`',
  ].join('\n');
  const out = reconcileChunkAnnotations(body, new Set(['a']), new Set(['e2']));
  assert.equal(
    out,
    [
      '## Section 1',
      '`topics: [a]`',
      '`entities: [e2]`',
      '',
      'Texte verbatim inchangé, avec des mots.',
      '## Section 2',
      '`entities: [e2]`',
    ].join('\n'),
  );
});

test('reconcileChunkAnnotations vide une annotation devenue sans slug retenu', () => {
  const body = '## S\n`topics: [x, y]`\n`entities: [e]`';
  const out = reconcileChunkAnnotations(body, new Set(), new Set());
  assert.equal(out, '## S\n`topics: []`\n`entities: []`');
});

test('reconcileChunkAnnotations ne touche AUCUNE ligne non-annotation', () => {
  const body = 'Une ligne `topics:` en prose (pas une annotation) reste.\n> Par [[..]]';
  assert.equal(reconcileChunkAnnotations(body, new Set(), new Set()), body);
});

// ————————————————————————————————————————————————————————————————
// buildEditedResourceContent

const OLD = [
  '---',
  'slug: ma-ressource',
  'title: "Ancien titre"',
  'author: "Alice"',
  'date: "2026-06"',
  'source_type: article',
  'origin: externe',
  'topics: [finops-ia, developer-experience]',
  'entities: [claude-code, stackblitz]',
  'url: "https://exemple.test"',
  'source_file: "ma-ressource.txt"',
  '---',
  '',
  '> Par [[../authors/alice|Alice]] · Thèmes : [[../themes/finops-ia|FinOps IA]]',
  '',
  '## Intro',
  '`topics: [finops-ia]`',
  '`entities: [claude-code, stackblitz]`',
  '',
  'Le corps verbatim de la ressource, mot pour mot.',
  '',
  '## Détails',
  '`topics: [developer-experience]`',
  '',
  'Encore du texte verbatim.',
  '',
].join('\n');

test('buildEditedResourceContent : titre/date/origine/type/url modifiés au frontmatter', () => {
  const out = buildEditedResourceContent(OLD, {
    title: 'Nouveau titre',
    author: 'Alice',
    date: '2026-07-15',
    source_type: 'podcast',
    origin: 'interne',
    url: 'https://nouveau.test',
    topics: ['finops-ia', 'developer-experience'],
    entities: ['claude-code', 'stackblitz'],
  });
  const { fm } = splitFrontmatter(out);
  assert.match(fm, /^title: "Nouveau titre"$/m);
  assert.match(fm, /^date: "2026-07-15"$/m);
  assert.match(fm, /^source_type: podcast$/m);
  assert.match(fm, /^origin: interne$/m);
  assert.match(fm, /^url: "https:\/\/nouveau\.test"$/m);
});

test('buildEditedResourceContent : slug et source_file JAMAIS modifiés', () => {
  const out = buildEditedResourceContent(OLD, {
    title: 'X', author: '', date: '2026', source_type: 'note', origin: 'interne', url: '',
    topics: [], entities: [],
  });
  const { fm } = splitFrontmatter(out);
  assert.match(fm, /^slug: ma-ressource$/m);
  assert.match(fm, /^source_file: "ma-ressource\.txt"$/m);
});

test('buildEditedResourceContent : ajout+retrait de thèmes et entités, chunks réconciliés', () => {
  // On retire developer-experience et stackblitz, on ajoute rag et cursor.
  const out = buildEditedResourceContent(OLD, {
    title: 'Ancien titre', author: 'Alice', date: '2026-06', source_type: 'article', origin: 'externe',
    url: 'https://exemple.test',
    topics: ['finops-ia', 'rag'],
    entities: ['claude-code', 'cursor'],
  });
  const meta = parseResourceMeta(out, 'ma-ressource');
  // meta.topics/entities = frontmatter ∪ annotations : doivent valoir EXACTEMENT les nouveaux ensembles.
  assert.deepEqual([...meta.topics].sort(), ['finops-ia', 'rag']);
  assert.deepEqual([...meta.entities].sort(), ['claude-code', 'cursor']);
  // developer-experience et stackblitz ont disparu partout (frontmatter + chunks).
  assert.ok(!out.includes('developer-experience'), 'developer-experience résiduel');
  assert.ok(!out.includes('stackblitz'), 'stackblitz résiduel');
  // L'annotation de section « Détails » (topics devenus vides) est bien vidée, pas supprimée.
  assert.match(out, /## Détails\n`topics: \[\]`/);
  // Le corps verbatim est intact.
  assert.ok(out.includes('Le corps verbatim de la ressource, mot pour mot.'));
  assert.ok(out.includes('Encore du texte verbatim.'));
});

test('buildEditedResourceContent : auteur vidé → author: "" au frontmatter', () => {
  const out = buildEditedResourceContent(OLD, {
    title: 'Ancien titre', author: '', date: '2026-06', source_type: 'article', origin: 'externe',
    url: 'https://exemple.test', topics: ['finops-ia'], entities: ['claude-code'],
  });
  const { fm } = splitFrontmatter(out);
  assert.match(fm, /^author: ""$/m);
});
