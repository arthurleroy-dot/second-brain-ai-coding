/**
 * Tests des filets déterministes du dépôt LIVE (fonctions PURES, sans LLM ni fs) :
 * forceType / forceOrigin / forceDate. Chacune recouvre le frontmatter produit par
 * l'IA avant projection (§0/§A4/§B4/§C2 de la spec 2026-07-28-auto-date-origine-type).
 * DATA_ROOT pointé vers un tmp AVANT import (les fonctions ne lisent pas le fs, mais
 * le module évalue des constantes de chemin à l'import).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-force-'));
process.env.DATA_ROOT = tmp;
process.env.WIKI_ROOT = path.join(tmp, 'wiki');
process.env.RAW_ROOT = path.join(tmp, 'raw');

import { forceType, forceOrigin, forceDate } from '../ingest-local';
import { parseResourceMeta } from '../wiki-mutate';

// Map slug→origine minimale pour les tests forceOrigin.
const TYPE_ORIGINS: Record<string, 'interne' | 'externe'> = {
  article: 'externe',
  'personal-notes': 'interne',
};

function md(fm: string): string {
  return `---\n${fm}\n---\n\nCorps.\n`;
}

// ————————————————————————————————————————————————————————————————
// forceType — repli unknown si absent/vide, inchangé si présent

test('forceType : source_type vide → unknown', () => {
  const out = forceType(md('slug: x\nsource_type: ""'));
  assert.equal(parseResourceMeta(out, 'x').source_type, 'unknown');
});

test('forceType : source_type absent → clé créée à unknown', () => {
  const out = forceType(md('slug: x\ntitle: "T"'));
  assert.equal(parseResourceMeta(out, 'x').source_type, 'unknown');
  assert.match(out, /^source_type: unknown$/m);
});

test('forceType : source_type présent → inchangé', () => {
  const input = md('slug: x\nsource_type: article');
  const out = forceType(input);
  assert.equal(out, input); // strictement inchangé
  assert.equal(parseResourceMeta(out, 'x').source_type, 'article');
});

// ————————————————————————————————————————————————————————————————
// forceOrigin — cascade déclarée > type > externe (l'IA est ignorée)

test('forceOrigin : origine déclarée gagne même si le type dit l’inverse', () => {
  // Type article (externe par la map) MAIS déclaration interne → interne gagne.
  const out = forceOrigin(md('slug: x\nsource_type: article\norigin: externe'), 'interne', TYPE_ORIGINS);
  assert.equal(parseResourceMeta(out, 'x').origin, 'interne');
});

test('forceOrigin : sans déclaration, origine = map du type', () => {
  const a = forceOrigin(md('slug: x\nsource_type: article'), null, TYPE_ORIGINS);
  assert.equal(parseResourceMeta(a, 'x').origin, 'externe');
  const b = forceOrigin(md('slug: y\nsource_type: personal-notes'), null, TYPE_ORIGINS);
  assert.equal(parseResourceMeta(b, 'y').origin, 'interne');
});

test('forceOrigin : type hors map → externe', () => {
  const out = forceOrigin(md('slug: x\nsource_type: podcast'), null, TYPE_ORIGINS);
  assert.equal(parseResourceMeta(out, 'x').origin, 'externe');
});

test('forceOrigin : origine écrite par l’IA écrasée par la cascade type', () => {
  // L'IA a mis interne, mais aucune déclaration et type article → externe (map) écrase.
  const out = forceOrigin(md('slug: x\nsource_type: article\norigin: interne'), null, TYPE_ORIGINS);
  assert.equal(parseResourceMeta(out, 'x').origin, 'externe');
});

test('forceOrigin : clé origin créée si absente du frontmatter, NON quotée', () => {
  const out = forceOrigin(md('slug: x\nsource_type: personal-notes'), null, TYPE_ORIGINS);
  assert.match(out, /^origin: interne$/m); // créée, sans guillemets
  assert.equal(parseResourceMeta(out, 'x').origin, 'interne');
});

// ————————————————————————————————————————————————————————————————
// forceDate — cascade déclarée > IA > mois courant

const TODAY = '2026-07-28';

test('forceDate : date déclarée gagne', () => {
  const out = forceDate(md('slug: x\ndate: "2020-01"'), '2024-10', TODAY);
  assert.equal(parseResourceMeta(out, 'x').date, '2024-10');
});

test('forceDate : sinon date IA du frontmatter', () => {
  const out = forceDate(md('slug: x\ndate: "2023-05-12"'), null, TODAY);
  assert.equal(parseResourceMeta(out, 'x').date, '2023-05-12');
});

test('forceDate : sinon mois courant (AAAA-MM), clé créée si absente', () => {
  const out = forceDate(md('slug: x\ntitle: "T"'), null, TODAY);
  assert.equal(parseResourceMeta(out, 'x').date, '2026-07');
  assert.match(out, /^date: "2026-07"$/m); // quotée + clé créée
});

test('forceDate : date IA vide → mois courant', () => {
  const out = forceDate(md('slug: x\ndate: ""'), null, TODAY);
  assert.equal(parseResourceMeta(out, 'x').date, '2026-07');
});
