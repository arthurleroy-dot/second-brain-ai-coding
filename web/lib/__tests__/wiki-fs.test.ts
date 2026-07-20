/**
 * Tests de la couche d'écriture locale (applyFileOps & co).
 * Lancé par `npm --prefix web run test` (node:test + tsx, zéro dépendance ajoutée).
 * Les racines WIKI_ROOT/RAW_ROOT sont pointées vers un dossier temporaire AVANT le
 * premier import du module (les constantes sont figées au chargement).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-fs-test-'));
process.env.WIKI_ROOT = path.join(tmp, 'wiki');
process.env.RAW_ROOT = path.join(tmp, 'raw');

// Import dynamique DANS les tests : le module lit process.env à son premier
// chargement, donc après les lignes ci-dessus (puis il est mis en cache).
const load = () => import('../wiki-fs');

test('applyFileOps refuse un chemin hors wiki/ et raw/ (throw, rien d’écrit)', async () => {
  const { applyFileOps } = await load();
  await assert.rejects(() => applyFileOps([{ path: 'web/hack.txt', content: 'x' }]), /refusé/);
  await assert.rejects(() => applyFileOps([{ path: 'docs/a.md', content: 'x' }]), /refusé/);
  await assert.rejects(() => applyFileOps([{ path: 'wiki/', content: 'x' }]), /refusé/);
});

test('applyFileOps refuse le path-traversal qui sort de la racine', async () => {
  const { applyFileOps } = await load();
  await assert.rejects(() => applyFileOps([{ path: 'wiki/../evil.md', content: 'x' }]), /périmètre|refusé/);
  await assert.rejects(() => applyFileOps([{ path: 'raw/../../etc/passwd', content: 'x' }]), /périmètre|refusé/);
});

test('un lot contenant une op invalide échoue AVANT toute écriture', async () => {
  const { applyFileOps, repoPathExists } = await load();
  await assert.rejects(() =>
    applyFileOps([
      { path: 'wiki/valide.md', content: 'ne doit pas exister' },
      { path: 'web/invalide.txt', content: 'x' },
    ]),
  );
  assert.equal(await repoPathExists('wiki/valide.md'), false);
});

test('écrit un .md sous wiki/ (dossiers créés) et le relit', async () => {
  const { applyFileOps, readRepoFile } = await load();
  await applyFileOps([{ path: 'wiki/resources/sous/dossier/test.md', content: '# Titre\ncontenu' }]);
  assert.equal(await readRepoFile('wiki/resources/sous/dossier/test.md'), '# Titre\ncontenu');
});

test('écrit un binaire dans raw/ et le relit à l’identique', async () => {
  const { applyFileOps, readRepoBinary } = await load();
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x01]);
  await applyFileOps([{ path: 'raw/doc.pdf', content: bytes }]);
  const back = await readRepoBinary('raw/doc.pdf');
  assert.ok(back && back.equals(bytes));
});

test('supprime un fichier existant, et ignore ENOENT sur un absent', async () => {
  const { applyFileOps, repoPathExists } = await load();
  await applyFileOps([{ path: 'wiki/a-supprimer.md', content: 'bye' }]);
  assert.equal(await repoPathExists('wiki/a-supprimer.md'), true);
  await applyFileOps([
    { path: 'wiki/a-supprimer.md', delete: true },
    { path: 'wiki/jamais-existe.md', delete: true }, // ENOENT ignoré
  ]);
  assert.equal(await repoPathExists('wiki/a-supprimer.md'), false);
});

test('resolveAvailableRawName suffixe -2, -3… en cas de collision', async () => {
  const { applyFileOps, resolveAvailableRawName } = await load();
  assert.equal(await resolveAvailableRawName('libre.pdf'), 'libre.pdf');
  await applyFileOps([{ path: 'raw/pris.pdf', content: 'x' }]);
  assert.equal(await resolveAvailableRawName('pris.pdf'), 'pris-2.pdf');
  await applyFileOps([{ path: 'raw/pris-2.pdf', content: 'x' }]);
  assert.equal(await resolveAvailableRawName('pris.pdf'), 'pris-3.pdf');
});

test('aucun fichier temporaire orphelin ne traîne après les écritures', async () => {
  await load();
  const leftovers: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.includes('.tmp-')) leftovers.push(p);
    }
  };
  walk(tmp);
  assert.deepEqual(leftovers, []);
});
