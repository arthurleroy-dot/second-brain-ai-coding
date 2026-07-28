/**
 * Tests de la découpe du markdown en cours de streaming
 * (`splitStreamingMarkdown`) : préfixe engagé (blocs terminés, rendu stable)
 * vs bloc actif (en cours, rendu en texte brut).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitStreamingMarkdown } from '../streaming-markdown';

test('1. chaîne sans \\n\\n → committed vide, active = tout', () => {
  const { committed, active } = splitStreamingMarkdown('Le deuxième pilier concerne');
  assert.equal(committed, '');
  assert.equal(active, 'Le deuxième pilier concerne');
});

test('2. un bloc terminé + un en cours → coupe au \\n\\n inclus', () => {
  const { committed, active } = splitStreamingMarkdown('Bonjour.\n\nJe vais');
  assert.equal(committed, 'Bonjour.\n\n');
  assert.equal(active, 'Je vais');
});

test('3. plusieurs \\n\\n → coupe au dernier', () => {
  const { committed, active } = splitStreamingMarkdown('A\n\nB\n\nC');
  assert.equal(committed, 'A\n\nB\n\n');
  assert.equal(active, 'C');
});

test('4. fence de code ouvert → active commence à la ligne d’ouverture', () => {
  const { committed, active } = splitStreamingMarkdown('texte\n\n```js\nconst a');
  assert.equal(committed, 'texte\n\n');
  assert.equal(active, '```js\nconst a');
});

test('5. fence de code refermé → committed contient le bloc complet, active = la suite', () => {
  const { committed, active } = splitStreamingMarkdown('```js\ncode\n```\n\nSuite');
  assert.equal(committed, '```js\ncode\n```\n\n');
  assert.equal(active, 'Suite');
});

test('6. tableau en cours (sans \\n\\n) → tout en active', () => {
  const { committed, active } = splitStreamingMarkdown('| a | b |\n| - | - |');
  assert.equal(committed, '');
  assert.equal(active, '| a | b |\n| - | - |');
});

// ————————————————————————————————————————————————————————————————
// Invariant CENTRAL (cause n°1) : révélé caractère par caractère comme le fait
// le drain, le préfixe « committed » envoyé à ReactMarkdown ne se RÉÉCRIT jamais
// — chaque committed est un préfixe du suivant. C'est exactement ce qui supprime
// le « claquement » : un bloc formaté une fois n'est plus jamais reformaté.
test('invariant : committed ne se réécrit jamais + committed+active = contenu', () => {
  const message =
    '# FinOps selon McKinsey\n\n' +
    'Le FinOps repose sur **trois piliers** distincts :\n\n' +
    '- visibilité des coûts\n' +
    '- allocation aux équipes\n' +
    '- optimisation continue\n\n' +
    'Exemple de configuration :\n\n' +
    '```yaml\nbudget:\n  alert: 80%\n  hard_cap: 100%\n```\n\n' +
    'En résumé, la discipline prime sur l’outil.';

  let prevCommitted = '';
  for (let k = 0; k <= message.length; k++) {
    const partial = message.slice(0, k);
    const { committed, active } = splitStreamingMarkdown(partial);

    // (a) Reconstruction sans perte : les deux zones recouvrent tout le partiel.
    assert.equal(committed + active, partial, `perte à k=${k}`);

    // (b) committed est TOUJOURS un préfixe du contenu déjà reçu.
    assert.ok(partial.startsWith(committed), `committed non-préfixe à k=${k}`);

    // (c) Monotonie/immuabilité : le committed précédent est un préfixe du
    //     nouveau → le texte déjà « monté » en markdown ne change plus jamais.
    assert.ok(
      committed.startsWith(prevCommitted),
      `committed réécrit à k=${k} : « ${JSON.stringify(prevCommitted)} » → « ${JSON.stringify(committed)} »`,
    );
    prevCommitted = committed;
  }

  // À la toute fin, tant qu'il n'y a pas de `\n\n` final, le dernier paragraphe
  // reste « actif » (brut) — c'est le comportement voulu : il ne se formatera
  // qu'au snap final (finishDrain → markdown complet).
  const end = splitStreamingMarkdown(message);
  assert.ok(end.active.startsWith('En résumé'), 'dernier bloc encore actif avant le snap final');
});
