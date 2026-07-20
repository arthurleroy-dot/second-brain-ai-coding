/**
 * Tests des outils de navigation du chat agentique (executeWikiTool), exécutés
 * contre le VRAI wiki/ du dépôt (cwd = web/, WIKI_ROOT = ../wiki). Lancé par
 * `npm --prefix web run test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeWikiTool } from '../chat-agent';

// ————————————————————————————————————————————————————————————————
// read_wiki_page

test('read_wiki_page lit index.md (contenu non vide, frontmatter/titre inclus)', async () => {
  const r = await executeWikiTool('read_wiki_page', { path: 'index.md' });
  assert.equal(r.isError, false);
  assert.ok(r.content.length > 100);
});

test('read_wiki_page normalise les préfixes wiki/ et /', async () => {
  const direct = await executeWikiTool('read_wiki_page', { path: 'index.md' });
  const prefixed = await executeWikiTool('read_wiki_page', { path: 'wiki/index.md' });
  const slashed = await executeWikiTool('read_wiki_page', { path: '/index.md' });
  assert.equal(prefixed.content, direct.content);
  assert.equal(slashed.content, direct.content);
});

test('read_wiki_page : page inexistante → is_error avec consigne de correction', async () => {
  const r = await executeWikiTool('read_wiki_page', { path: 'resources/nexiste-pas.md' });
  assert.equal(r.isError, true);
  assert.match(r.content, /introuvable/);
  assert.match(r.content, /list_wiki_folder/);
});

test('read_wiki_page : traversal ../raw et chemin absolu → is_error', async () => {
  const traversal = await executeWikiTool('read_wiki_page', { path: '../raw/quelconque.md' });
  assert.equal(traversal.isError, true);
  const absolute = await executeWikiTool('read_wiki_page', { path: '/etc/passwd.md' });
  assert.equal(absolute.isError, true);
});

test('read_wiki_page : non-.md (graph.json, canvas) → is_error', async () => {
  const graph = await executeWikiTool('read_wiki_page', { path: 'graph.json' });
  assert.equal(graph.isError, true);
  assert.match(graph.content, /\.md/);
  const canvas = await executeWikiTool('read_wiki_page', { path: 'Sans titre.canvas' });
  assert.equal(canvas.isError, true);
});

test('read_wiki_page : troncature effective avec maxChars bas', async () => {
  const r = await executeWikiTool('read_wiki_page', { path: 'index.md' }, 50);
  assert.equal(r.isError, false);
  assert.match(r.content, /CONTENU TRONQUÉ : \d+ caractères au total, 50 affichés/);
  assert.ok(r.content.startsWith((await executeWikiTool('read_wiki_page', { path: 'index.md' })).content.slice(0, 50)));
});

test('read_wiki_page : path manquant → is_error', async () => {
  const r = await executeWikiTool('read_wiki_page', {});
  assert.equal(r.isError, true);
});

// ————————————————————————————————————————————————————————————————
// list_wiki_folder

test('list_wiki_folder(resources) renvoie les 13 fiches', async () => {
  const r = await executeWikiTool('list_wiki_folder', { path: 'resources' });
  assert.equal(r.isError, false);
  const names = r.content.split('\n');
  assert.equal(names.length, 13);
  assert.ok(names.every((n) => n.endsWith('.md')));
});

test('list_wiki_folder : racine ("" et ".") filtrée du bruit', async () => {
  for (const path of ['', '.']) {
    const r = await executeWikiTool('list_wiki_folder', { path });
    assert.equal(r.isError, false);
    const names = r.content.split('\n');
    assert.ok(names.includes('index.md'));
    assert.ok(names.includes('resources'));
    assert.ok(!names.includes('_ingested.json'));
    assert.ok(!names.some((n) => n.endsWith('.canvas')));
  }
});

test('list_wiki_folder : dossier inexistant ou hors périmètre → is_error', async () => {
  const missing = await executeWikiTool('list_wiki_folder', { path: 'nexiste-pas' });
  assert.equal(missing.isError, true);
  assert.match(missing.content, /introuvable/);
  const traversal = await executeWikiTool('list_wiki_folder', { path: '../raw' });
  assert.equal(traversal.isError, true);
});

// ————————————————————————————————————————————————————————————————
// Outil inconnu

test('outil inconnu → is_error', async () => {
  const r = await executeWikiTool('grep_wiki', { path: 'x' });
  assert.equal(r.isError, true);
});
