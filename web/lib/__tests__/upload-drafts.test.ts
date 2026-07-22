import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addName, mergeLinkDrafts, mergeThemeDraft } from '../upload-drafts';

test('addName : ajoute un nom trimé, ignore vide/espaces, dédup casse-insensible', () => {
  assert.deepEqual(addName([], 'Septeo'), ['Septeo']);
  assert.deepEqual(addName(['Septeo'], '  Acme '), ['Septeo', 'Acme']);
  // vide / espaces → liste inchangée (même référence, pas de copie)
  const l = ['Septeo'];
  assert.equal(addName(l, ''), l);
  assert.equal(addName(l, '   '), l);
  // doublon insensible à la casse → liste inchangée (même référence)
  const dup = ['Septeo'];
  assert.equal(addName(dup, 'septeo'), dup);
  assert.deepEqual(addName(['Septeo'], 'SEPTEO'), ['Septeo']);
});

test('mergeLinkDrafts : brouillon tapé non validé → présent dans le résultat fusionné', () => {
  const value = { clients: ['Acme'] };
  const drafts = { clients: 'Septeo', personnes: 'Julien Ye' };
  const merged = mergeLinkDrafts(value, drafts);
  assert.deepEqual(merged, { clients: ['Acme', 'Septeo'], personnes: ['Julien Ye'] });
  // immutabilité : la valeur d'origine n'est pas mutée
  assert.deepEqual(value, { clients: ['Acme'] });
});

test('mergeLinkDrafts : dédup insensible à la casse (déjà présent → pas de doublon)', () => {
  const merged = mergeLinkDrafts({ clients: ['Septeo'] }, { clients: 'septeo' });
  assert.deepEqual(merged, { clients: ['Septeo'] });
});

test('mergeLinkDrafts : brouillon vide/espaces → ignoré, aucune clé créée', () => {
  // type OUVERT sans brouillon (chaîne vide) → la clé ne doit PAS apparaître
  const merged = mergeLinkDrafts({}, { clients: '', personnes: '   ' });
  assert.deepEqual(merged, {});
});

test('mergeLinkDrafts : multi-types — chacun fusionne son propre brouillon ; type sans brouillon → clé absente', () => {
  const value = { personnes: ['Alice'] };
  const drafts = { personnes: 'Bob', clients: 'Septeo', outils: '' };
  const merged = mergeLinkDrafts(value, drafts);
  assert.deepEqual(merged, { personnes: ['Alice', 'Bob'], clients: ['Septeo'] });
  assert.ok(!('outils' in merged), 'type ouvert sans brouillon → clé absente');
});

test('mergeThemeDraft : brouillon fusionné à une liste vide → liste à 1 élément', () => {
  assert.deepEqual(mergeThemeDraft([], 'Harness engineering'), ['Harness engineering']);
});

test('mergeThemeDraft : dédup casse-insensible et vide ignoré', () => {
  assert.deepEqual(mergeThemeDraft(['Veille'], 'veille'), ['Veille']);
  const l = ['Veille'];
  assert.equal(mergeThemeDraft(l, '  '), l);
});
