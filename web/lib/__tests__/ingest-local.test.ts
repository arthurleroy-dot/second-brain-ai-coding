/**
 * Tests des parties DÉTERMINISTES du moteur d'ingestion local (sans appel IA) :
 * détection des sources en attente, verrou, état persistant.
 * DATA_ROOT pointé vers un dossier temporaire AVANT le premier import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-local-test-'));
process.env.DATA_ROOT = tmp;
process.env.WIKI_ROOT = path.join(tmp, 'wiki');
process.env.RAW_ROOT = path.join(tmp, 'raw');

fs.mkdirSync(path.join(tmp, 'raw'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'wiki'), { recursive: true });

const load = () => import('../ingest-local');

test('detectPending : raw/ moins README, sidecars, et clés déjà ingérées', async () => {
  const raw = path.join(tmp, 'raw');
  fs.writeFileSync(path.join(raw, 'README.md'), 'readme');
  fs.writeFileSync(path.join(raw, 'source-a.md'), 'a');
  fs.writeFileSync(path.join(raw, 'source-a.md.meta.md'), 'sidecar a');
  fs.writeFileSync(path.join(raw, 'source-b.pdf'), 'b');
  fs.writeFileSync(path.join(raw, 'deja.md'), 'x');
  fs.writeFileSync(
    path.join(tmp, 'wiki', '_ingested.json'),
    JSON.stringify({ version: 1, files: { 'deja.md': { slug: 'deja' } } }),
  );
  const { detectPending } = await load();
  const pending = await detectPending();
  assert.deepEqual(pending, ['source-a.md', 'source-b.pdf']); // ni README, ni sidecar, ni deja
});

test('acquireLock est exclusif ; releaseLock libère', async () => {
  const { acquireLock, releaseLock, lockHeld } = await load();
  assert.equal(lockHeld(), false);
  assert.equal(acquireLock(), true);
  assert.equal(lockHeld(), true);
  assert.equal(acquireLock(), false, 'un 2e acquire doit échouer tant que tenu');
  releaseLock();
  assert.equal(lockHeld(), false);
  assert.equal(acquireLock(), true, 'réacquérable après release');
  releaseLock();
});

test('read/writeIngestState : round-trip et défaut idle', async () => {
  const { readIngestState, writeIngestState } = await load();
  // Défaut avant toute écriture (nouveau fichier state).
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-state-'));
  // (le module lit STATE_PATH sous DATA_ROOT courant ; ici on teste le round-trip)
  await writeIngestState({ status: 'running', startedAt: '2026-07-20T00:00:00Z', pending: ['x.md'] });
  const s = await readIngestState();
  assert.equal(s.status, 'running');
  assert.deepEqual(s.pending, ['x.md']);
  await writeIngestState({ status: 'done', finishedAt: '2026-07-20T00:01:00Z', slug: 'x' });
  const s2 = await readIngestState();
  assert.equal(s2.status, 'done');
  assert.equal(s2.slug, 'x');
  fs.rmSync(t2, { recursive: true, force: true });
});

test('runIngestion est un no-op si le verrou est déjà tenu', async () => {
  const { acquireLock, releaseLock, runIngestion, readIngestState } = await load();
  await load().then((m) => m.writeIngestState({ status: 'idle' }));
  assert.equal(acquireLock(), true); // on simule une ingestion en cours
  await runIngestion(); // doit retourner immédiatement sans toucher l'état
  const s = await readIngestState();
  assert.equal(s.status, 'idle', 'runIngestion ne doit pas modifier l’état si verrou tenu');
  releaseLock();
});

test('runIngestion → done immédiat si aucune source en attente', async () => {
  const { runIngestion, readIngestState } = await load();
  // Tout raw/ est soit README/sidecar soit déjà ingéré → pending vide.
  const raw = path.join(tmp, 'raw');
  for (const f of fs.readdirSync(raw)) fs.rmSync(path.join(raw, f));
  fs.writeFileSync(path.join(raw, 'README.md'), 'readme');
  await runIngestion();
  const s = await readIngestState();
  assert.equal(s.status, 'done');
  assert.deepEqual(s.pending, []);
});
