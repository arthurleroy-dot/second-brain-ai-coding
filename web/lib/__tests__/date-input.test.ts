/**
 * Tests de `validateDateInput(raw, today)` — fonction PURE, sans fs ni LLM
 * (modèle : ingest-force.test.ts). `today` figé à '2026-08-31'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateDateInput } from '../date-input';

const TODAY = '2026-08-31';

// ————————————————————————————————————————————————————————————————
// Formes valides + granularité + non-futur

test('année seule → ok / year / non-futur', () => {
  assert.deepEqual(validateDateInput('2026', TODAY), {
    ok: true,
    granularity: 'year',
    isFuture: false,
  });
});

test('mois → ok / month / non-futur', () => {
  assert.deepEqual(validateDateInput('2026-08', TODAY), {
    ok: true,
    granularity: 'month',
    isFuture: false,
  });
});

test('jour = aujourd’hui → ok / day / non-futur', () => {
  assert.deepEqual(validateDateInput('2026-08-31', TODAY), {
    ok: true,
    granularity: 'day',
    isFuture: false,
  });
});

test('mois passé → ok / non-futur', () => {
  assert.deepEqual(validateDateInput('2025-03', TODAY), {
    ok: true,
    granularity: 'month',
    isFuture: false,
  });
});

// ————————————————————————————————————————————————————————————————
// Futur (avertissement non bloquant côté UI)

test('année future → ok / futur', () => {
  const r = validateDateInput('2027', TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.isFuture, true);
});

test('mois futur (début après aujourd’hui) → ok / futur', () => {
  const r = validateDateInput('2026-09', TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.isFuture, true);
});

test('jour futur → ok / futur', () => {
  const r = validateDateInput('2026-09-01', TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.isFuture, true);
});

// ————————————————————————————————————————————————————————————————
// Erreurs de forme

test('vide → erreur', () => {
  const r = validateDateInput('', TODAY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Renseigne/);
});

test('vide après trim → erreur', () => {
  assert.equal(validateDateInput('   ', TODAY).ok, false);
});

test('séparateur « / » → erreur de format', () => {
  const r = validateDateInput('2026/08', TODAY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Format attendu/);
});

test('texte libre → erreur de format', () => {
  assert.equal(validateDateInput('aug 2026', TODAY).ok, false);
});

test('mois à 1 chiffre → erreur de format', () => {
  assert.equal(validateDateInput('2026-8', TODAY).ok, false);
});

// ————————————————————————————————————————————————————————————————
// Erreurs de calendrier

test('mois 13 → erreur (mois)', () => {
  const r = validateDateInput('2026-13', TODAY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Mois invalide/);
});

test('30 février → erreur (jour)', () => {
  const r = validateDateInput('2026-02-30', TODAY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Jour invalide/);
});

test('29 février année bissextile → ok', () => {
  assert.deepEqual(validateDateInput('2024-02-29', TODAY), {
    ok: true,
    granularity: 'day',
    isFuture: false,
  });
});

test('29 février année non bissextile → erreur (jour)', () => {
  const r = validateDateInput('2023-02-29', TODAY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Jour invalide/);
});

test('année trop ancienne → erreur (année)', () => {
  const r = validateDateInput('1800', TODAY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Année invalide/);
});

test('année trop lointaine → erreur (année)', () => {
  const r = validateDateInput('3000', TODAY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Année invalide/);
});
