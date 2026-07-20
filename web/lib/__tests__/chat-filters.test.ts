/**
 * Tests de la validation dure des filtres du chat (module pur chat-filters).
 * Lancé par `npm --prefix web run test` (node:test + tsx, zéro dépendance ajoutée).
 * Point clé : sémantique d'intersection d'intervalles pour les dates à
 * granularité mixte ("2026", "2026-04", "2026-02-12").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateIntervalOf, sourcePassesFilters } from '../chat-filters';
import type { ChatFilterState, Source } from '../../types';

const src = (over: Partial<Source>): Source => ({
  slug: 's',
  title: 'S',
  type: 'article',
  author: null,
  date: null,
  url: null,
  deposited_by: null,
  topics: [],
  origin: null,
  needs_review: false,
  ...over,
});

// ————————————————————————————————————————————————————————————————
// dateIntervalOf — granularité mixte

test('dateIntervalOf couvre les trois granularités du frontmatter', () => {
  assert.deepEqual(dateIntervalOf('2026'), { start: '2026-01-01', end: '2026-12-31' });
  assert.deepEqual(dateIntervalOf('2026-04'), { start: '2026-04-01', end: '2026-04-31' });
  assert.deepEqual(dateIntervalOf('2026-02-12'), { start: '2026-02-12', end: '2026-02-12' });
});

test('dateIntervalOf : null et formats inattendus → null', () => {
  assert.equal(dateIntervalOf(null), null);
  assert.equal(dateIntervalOf(''), null);
  assert.equal(dateIntervalOf('avril 2026'), null);
});

// ————————————————————————————————————————————————————————————————
// Filtre date — intersection d'intervalles × modes

test('after : une ressource datée "2026" passe un filtre after 2026-03 (cas clé)', () => {
  const f: ChatFilterState = { date: { mode: 'after', from: '2026-03' } };
  assert.ok(sourcePassesFilters(src({ date: '2026' }), f));
  assert.ok(sourcePassesFilters(src({ date: '2026-04' }), f));
  assert.ok(sourcePassesFilters(src({ date: '2026-03-15' }), f));
  assert.ok(!sourcePassesFilters(src({ date: '2026-02-12' }), f));
  assert.ok(!sourcePassesFilters(src({ date: '2025' }), f));
});

test('before : intersection avec la borne haute', () => {
  const f: ChatFilterState = { date: { mode: 'before', to: '2026-03' } };
  assert.ok(sourcePassesFilters(src({ date: '2026' }), f)); // janv-mars 2026 possible
  assert.ok(sourcePassesFilters(src({ date: '2026-02-12' }), f));
  assert.ok(sourcePassesFilters(src({ date: '2026-03' }), f));
  assert.ok(!sourcePassesFilters(src({ date: '2026-04' }), f));
  assert.ok(!sourcePassesFilters(src({ date: '2027' }), f));
});

test('between : intersection avec les deux bornes', () => {
  const f: ChatFilterState = { date: { mode: 'between', from: '2025-06', to: '2026-01' } };
  assert.ok(sourcePassesFilters(src({ date: '2025' }), f));
  assert.ok(sourcePassesFilters(src({ date: '2026' }), f));
  assert.ok(sourcePassesFilters(src({ date: '2025-06-01' }), f));
  assert.ok(sourcePassesFilters(src({ date: '2026-01' }), f));
  assert.ok(!sourcePassesFilters(src({ date: '2025-05-31' }), f));
  assert.ok(!sourcePassesFilters(src({ date: '2026-02' }), f));
});

test('between avec borne manquante : la borne absente est ouverte', () => {
  const f: ChatFilterState = { date: { mode: 'between', from: '2026-01' } };
  assert.ok(sourcePassesFilters(src({ date: '2027' }), f));
  assert.ok(!sourcePassesFilters(src({ date: '2025' }), f));
});

test('date : ressource sans date (ou format inconnu) passe toujours', () => {
  const f: ChatFilterState = { date: { mode: 'after', from: '2026-01' } };
  assert.ok(sourcePassesFilters(src({ date: null }), f));
  assert.ok(sourcePassesFilters(src({ date: 'avril 2026' }), f));
});

// ————————————————————————————————————————————————————————————————
// Filtre types — résolution dossier → ResourceType

test('types : match direct et via dossier by-type', () => {
  assert.ok(sourcePassesFilters(src({ type: 'article' }), { types: ['article'] }));
  assert.ok(sourcePassesFilters(src({ type: 'report_pdf' }), { types: ['report_pdf'] }));
  assert.ok(!sourcePassesFilters(src({ type: 'tweet' }), { types: ['article'] }));
  assert.ok(sourcePassesFilters(src({ type: 'tweet' }), { types: ['article', 'tweet'] }));
});

test('types : valeurs irrésolubles ignorées (filtre sans effet)', () => {
  assert.ok(sourcePassesFilters(src({ type: 'article' }), { types: ['nimporte-quoi'] }));
});

// ————————————————————————————————————————————————————————————————
// Filtre auteurs — exact + 'unknown' ⇔ author null

test('authors : match exact, unknown = auteur null', () => {
  assert.ok(sourcePassesFilters(src({ author: 'McKinsey' }), { authors: ['McKinsey'] }));
  assert.ok(!sourcePassesFilters(src({ author: 'Anthropic' }), { authors: ['McKinsey'] }));
  assert.ok(sourcePassesFilters(src({ author: null }), { authors: ['unknown'] }));
  assert.ok(!sourcePassesFilters(src({ author: 'McKinsey' }), { authors: ['unknown'] }));
  assert.ok(sourcePassesFilters(src({ author: null }), { authors: ['unknown', 'McKinsey'] }));
  assert.ok(sourcePassesFilters(src({ author: 'McKinsey' }), { authors: ['unknown', 'McKinsey'] }));
});

// ————————————————————————————————————————————————————————————————
// Filtre origines — appartenance stricte

test('origins : appartenance stricte, origin null rejeté', () => {
  assert.ok(sourcePassesFilters(src({ origin: 'externe' }), { origins: ['externe'] }));
  assert.ok(!sourcePassesFilters(src({ origin: 'interne' }), { origins: ['externe'] }));
  assert.ok(!sourcePassesFilters(src({ origin: null }), { origins: ['externe'] }));
});

// ————————————————————————————————————————————————————————————————
// Axes combinés en ET ; sans filtres tout passe

test('axes combinés en ET', () => {
  const f: ChatFilterState = {
    types: ['report_pdf'],
    authors: ['McKinsey'],
    date: { mode: 'after', from: '2026-01' },
  };
  const ok = src({ type: 'report_pdf', author: 'McKinsey', date: '2026' });
  assert.ok(sourcePassesFilters(ok, f));
  assert.ok(!sourcePassesFilters({ ...ok, type: 'article' }, f));
  assert.ok(!sourcePassesFilters({ ...ok, author: null }, f));
  assert.ok(!sourcePassesFilters({ ...ok, date: '2025-11' }, f));
});

test('sans filtres (undefined ou vides) : tout passe', () => {
  assert.ok(sourcePassesFilters(src({}), undefined));
  assert.ok(sourcePassesFilters(src({}), {}));
  assert.ok(sourcePassesFilters(src({}), { types: [], authors: [], origins: [] }));
});
