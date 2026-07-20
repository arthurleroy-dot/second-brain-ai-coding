/**
 * Tests de l'historique de chat local (conversations-store).
 * DATA_ROOT est pointé vers un dossier temporaire AVANT le premier import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-store-test-'));
process.env.DATA_ROOT = tmp;
process.env.WIKI_ROOT = path.join(tmp, 'wiki');
process.env.RAW_ROOT = path.join(tmp, 'raw');

const load = () => import('../conversations-store');

test('createConversation crée un fichier <uuid>.json et renvoie la conversation', async () => {
  const { createConversation } = await load();
  const conv = await createConversation();
  assert.ok(conv);
  assert.match(conv!.id, /^[0-9a-f-]{36}$/);
  assert.equal(conv!.title, 'Nouvelle discussion');
  assert.deepEqual(conv!.messages, []);
  const file = path.join(tmp, '.data', 'conversations', `${conv!.id}.json`);
  assert.ok(fs.existsSync(file));
});

test('saveMessage ajoute le message et met à jour updated_at', async () => {
  const { createConversation, saveMessage, getConversation } = await load();
  const conv = (await createConversation('Discussion X'))!;
  const before = conv.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  await saveMessage(conv.id, 'user', 'Bonjour', []);
  await saveMessage(conv.id, 'assistant', 'Salut', [
    { slug: 's', title: 'T', type: 'article', author: null, date: null, url: null, deposited_by: null, topics: [], needs_review: false },
  ]);
  const reloaded = (await getConversation(conv.id))!;
  assert.equal(reloaded.messages.length, 2);
  assert.equal(reloaded.messages[0].content, 'Bonjour');
  assert.equal(reloaded.messages[1].sources.length, 1);
  assert.ok(reloaded.updated_at > before);
  assert.ok(reloaded.messages[0].id && reloaded.messages[0].created_at);
});

test('getConversationHistory renvoie {role, content} dans l’ordre', async () => {
  const { createConversation, saveMessage, getConversationHistory } = await load();
  const conv = (await createConversation())!;
  await saveMessage(conv.id, 'user', 'Q1', []);
  await saveMessage(conv.id, 'assistant', 'R1', []);
  const hist = await getConversationHistory(conv.id);
  assert.deepEqual(hist, [
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'R1' },
  ]);
});

test('renameConversationIfDefault renomme au 1er message user, puis ne renomme plus', async () => {
  const { createConversation, renameConversationIfDefault, getConversation } = await load();
  const conv = (await createConversation())!;
  await renameConversationIfDefault(conv.id, 'Quelle est la meilleure approche pour X ?');
  let reloaded = (await getConversation(conv.id))!;
  assert.equal(reloaded.title, 'Quelle est la meilleure approche pour X ?');
  // Deuxième appel : titre déjà personnalisé → inchangé.
  await renameConversationIfDefault(conv.id, 'Autre message');
  reloaded = (await getConversation(conv.id))!;
  assert.equal(reloaded.title, 'Quelle est la meilleure approche pour X ?');
});

test('renameConversationIfDefault tronque à 60 caractères', async () => {
  const { createConversation, renameConversationIfDefault, getConversation } = await load();
  const conv = (await createConversation())!;
  const long = 'x'.repeat(100);
  await renameConversationIfDefault(conv.id, long);
  const reloaded = (await getConversation(conv.id))!;
  assert.equal(reloaded.title.length, 60);
});

test('listConversations trie par updated_at décroissant, messages vidés', async () => {
  const { createConversation, saveMessage, listConversations } = await load();
  const a = (await createConversation('A'))!;
  await new Promise((r) => setTimeout(r, 5));
  const b = (await createConversation('B'))!;
  await new Promise((r) => setTimeout(r, 5));
  await saveMessage(a.id, 'user', 'réveille A', []); // A devient le plus récent
  const list = await listConversations();
  const idx = (id: string) => list.findIndex((c) => c.id === id);
  assert.ok(idx(a.id) < idx(b.id), 'A (mis à jour en dernier) doit précéder B');
  assert.ok(list.every((c) => c.messages.length === 0), 'liste = métadonnées seules');
});

test('helpers robustes : id inconnu → valeurs neutres, pas d’exception', async () => {
  const { getConversation, getConversationHistory, saveMessage, renameConversationIfDefault } = await load();
  assert.equal(await getConversation('inconnu'), null);
  assert.deepEqual(await getConversationHistory('inconnu'), []);
  await saveMessage(null, 'user', 'x', []); // no-op
  await saveMessage('inconnu', 'user', 'x', []); // no-op
  await renameConversationIfDefault(null, 'x'); // no-op
  assert.ok(true);
});
