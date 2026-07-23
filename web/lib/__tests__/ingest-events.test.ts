/**
 * Tests de l'émetteur d'événements d'ingestion (`ingest-events.ts`) : buffer +
 * rejeu + broadcast. Module SINGLETON (état module-level) → chaque test appelle
 * `startRun()` en tête pour repartir d'un run propre, et désabonne ses subscribers
 * (le `Set` est partagé entre les tests).
 *
 * Pur mémoire : aucun mock d'environnement navigateur nécessaire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startRun,
  emitStep,
  emitDelta,
  emitDone,
  emitError,
  snapshot,
  subscribe,
  type IngestEvent,
} from '../ingest-events';

test('(a) rejeu ordonné : startRun + emitStep×3 → snapshot rejoue les 3 dans l’ordre', () => {
  startRun();
  emitStep('extract', 'Extraction du texte', 'a.pdf');
  emitStep('analyze', "Analyse et rédaction par l'IA", 'a.pdf');
  emitStep('write', 'Écriture dans le wiki', 'a.pdf');

  const snap = snapshot();
  assert.ok(snap, 'snapshot non nul après startRun');
  const steps = snap!.events.filter((e): e is Extract<IngestEvent, { type: 'step' }> => e.type === 'step');
  assert.deepEqual(steps.map((s) => s.phase), ['extract', 'analyze', 'write'], 'ordre des phases');
  assert.deepEqual(steps.map((s) => s.id), [1, 2, 3], 'ids séquentiels 1..3');
  assert.deepEqual(steps.map((s) => s.file), ['a.pdf', 'a.pdf', 'a.pdf'], 'file scopé sur chaque event');
  assert.equal(snap!.terminal, false, 'pas terminal tant qu’aucun done/error');
});

test('(b) subscriber tardif : ne reçoit que le futur ; le passé se rejoue via snapshot', () => {
  startRun();
  emitStep('extract', 'Extraction du texte');
  emitStep('analyze', 'Analyse');

  // La route reconstruit l'historique complet = snapshot() (passé) PUIS subscribe()
  // (futur), sans await entre les deux. On simule ce découpage.
  const snapBefore = snapshot()!;
  assert.equal(snapBefore.events.length, 2, 'les 2 steps déjà émis sont dans le buffer');

  const live: IngestEvent[] = [];
  const unsub = subscribe((e) => live.push(e));
  emitStep('write', 'Écriture');
  emitDone();
  unsub();

  assert.deepEqual(live.map((e) => e.type), ['step', 'done'], 'le subscriber ne voit QUE le futur');
  const full = [...snapBefore.events, ...live];
  assert.deepEqual(full.map((e) => e.type), ['step', 'step', 'step', 'done'], 'rejeu + live = suite complète, sans trou ni doublon');
});

test('(c) emitDone → terminal:true ; snapshot rejoue tout (step + delta + done)', () => {
  startRun();
  emitStep('extract', 'x');
  emitDelta('abc');
  emitDone();

  const snap = snapshot()!;
  assert.equal(snap.terminal, true, 'terminal marqué');
  assert.deepEqual(snap.events.map((e) => e.type), ['step', 'delta', 'done'], 'buffer complet conservé après done');
});

test('(c bis) emitError → terminal:true + message porté', () => {
  startRun();
  emitStep('extract', 'x');
  emitError('boom');

  const snap = snapshot()!;
  assert.equal(snap.terminal, true);
  const last = snap.events[snap.events.length - 1];
  assert.equal(last.type, 'error');
  assert.equal((last as Extract<IngestEvent, { type: 'error' }>).error, 'boom');
});

test('(d) startRun() remet le buffer ET la numérotation des steps à zéro', () => {
  startRun();
  emitStep('extract', 'a');
  emitStep('analyze', 'b');
  assert.equal(snapshot()!.events.length, 2);

  startRun(); // nouveau run : tout repart de zéro
  const snap = snapshot()!;
  assert.equal(snap.events.length, 0, 'buffer vidé');
  assert.equal(snap.terminal, false, 'terminal ré-armé à false');

  emitStep('extract', 'c');
  const first = snapshot()!.events[0] as Extract<IngestEvent, { type: 'step' }>;
  assert.equal(first.id, 1, 'stepSeq réinitialisé à 1');
});

test('(e) multi-subscribers : tous reçoivent le broadcast ; un unsub ne coupe pas les autres', () => {
  startRun();
  const a: IngestEvent[] = [];
  const b: IngestEvent[] = [];
  const unsubA = subscribe((e) => a.push(e));
  const unsubB = subscribe((e) => b.push(e));

  emitStep('extract', 'x');
  assert.equal(a.length, 1, 'A reçoit');
  assert.equal(b.length, 1, 'B reçoit');

  unsubA();
  emitDone();
  assert.equal(a.length, 1, 'A désabonné ne reçoit plus rien');
  assert.equal(b.length, 2, 'B continue de recevoir');
  unsubB();
});

test('(f) un subscriber qui throw n’empêche pas les autres de recevoir', () => {
  startRun();
  const b: IngestEvent[] = [];
  const unsubBad = subscribe(() => {
    throw new Error('subscriber cassé (flux fermé)');
  });
  const unsubB = subscribe((e) => b.push(e));

  emitStep('extract', 'x'); // ne doit PAS propager le throw
  assert.equal(b.length, 1, 'le broadcast atteint le bon subscriber malgré le mauvais');
  unsubBad();
  unsubB();
});
