/**
 * Tests de la boucle agentique (runWikiAgent) avec client Anthropic mocké :
 * un « scénario » = la suite des tours renvoyés par le faux stream, qui émet
 * les mêmes séquences d'événements bruts que le proxy LiteLLM réel (bloc texte
 * vide avant un tool_use, input_json_delta fragmenté, « Premature close » après
 * message_stop). Les outils, eux, s'exécutent contre le vrai wiki/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ITERATIONS, buildSystemPrompt, runWikiAgent } from '../chat-agent';

interface FakeTurn {
  text?: string;
  toolUses?: Array<{ id: string; name: string; input: unknown }>;
  prematureClose?: boolean; // erreur APRÈS message_stop (quirk LiteLLM toléré)
  failBeforeStop?: boolean; // erreur AVANT message_stop (vraie erreur amont)
}

function fakeStream(turn: FakeTurn) {
  return {
    async *[Symbol.asyncIterator]() {
      let index = 0;
      // Le proxy réel émet un bloc texte (parfois vide) avant les tool_use.
      const text = turn.text ?? (turn.toolUses?.length ? '' : undefined);
      if (text !== undefined) {
        yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } as any;
        const mid = Math.ceil(text.length / 2);
        for (const d of [text.slice(0, mid), text.slice(mid)]) {
          yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: d } } as any;
        }
        yield { type: 'content_block_stop', index } as any;
        index++;
      }
      for (const tu of turn.toolUses ?? []) {
        yield {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: tu.id, name: tu.name, input: {} },
        } as any;
        const json = JSON.stringify(tu.input);
        const mid = Math.ceil(json.length / 2);
        yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(0, mid) } } as any;
        yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(mid) } } as any;
        yield { type: 'content_block_stop', index } as any;
        index++;
      }
      if (turn.failBeforeStop) throw new Error('ECONNRESET amont');
      yield {
        type: 'message_delta',
        delta: { stop_reason: turn.toolUses?.length ? 'tool_use' : 'end_turn' },
      } as any;
      yield { type: 'message_stop' } as any;
      if (turn.prematureClose) throw new Error('Premature close');
    },
  };
}

/** Client mocké : rejoue `turns` dans l'ordre (le dernier se répète), trace les appels. */
function makeClient(turns: FakeTurn[]) {
  const calls: any[] = [];
  const client = {
    messages: {
      stream(params: any) {
        calls.push(params);
        return fakeStream(turns[Math.min(calls.length - 1, turns.length - 1)]);
      },
    },
  };
  return { client, calls };
}

const baseOpts = (client: any, callbacks: Partial<import('../chat-agent').AgentCallbacks> = {}) => ({
  system: 'système de test',
  messages: [{ role: 'user' as const, content: 'question' }],
  client,
  model: 'claude-test',
  callbacks: {
    onText: callbacks.onText ?? (() => {}),
    onStep: callbacks.onStep ?? (() => {}),
  },
});

// ————————————————————————————————————————————————————————————————

test('réponse directe sans outil : 1 itération, deltas transmis', async () => {
  const { client, calls } = makeClient([{ text: 'Réponse directe. SOURCES: []' }]);
  const received: string[] = [];
  const r = await runWikiAgent(baseOpts(client, { onText: (d) => received.push(d) }));
  assert.equal(r.iterations, 1);
  assert.equal(r.rawText, 'Réponse directe. SOURCES: []');
  assert.equal(received.join(''), r.rawText);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'claude-test');
  assert.ok(Array.isArray(calls[0].tools) && calls[0].tools.length === 2);
});

test('un tour tool_use puis réponse : step émis, tool_result correct, écho assistant', async () => {
  const { client, calls } = makeClient([
    { toolUses: [{ id: 'tu_1', name: 'read_wiki_page', input: { path: 'index.md' } }] },
    { text: 'Voilà. SOURCES: []' },
  ]);
  const steps: any[] = [];
  const r = await runWikiAgent(baseOpts(client, { onStep: (s) => steps.push(s) }));
  assert.equal(r.iterations, 2);
  assert.deepEqual(steps, [
    { label: 'Lecture de index.md', tool: 'read_wiki_page', path: 'index.md' },
  ]);
  // 2e appel : historique = user + écho assistant (tool_use seul, SANS le bloc
  // texte vide émis par le proxy — l'API refuse les blocs texte vides) + user.
  const msgs = calls[1].messages;
  assert.equal(msgs.length, 3);
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].content.length, 1);
  assert.equal(msgs[1].content[0].type, 'tool_use');
  assert.deepEqual(msgs[1].content[0].input, { path: 'index.md' }); // JSON refragmenté recollé
  assert.equal(msgs[2].role, 'user');
  const results = msgs[2].content.filter((b: any) => b.type === 'tool_result');
  assert.equal(results.length, 1);
  assert.equal(results[0].tool_use_id, 'tu_1');
  assert.equal(results[0].is_error, false);
  assert.ok(results[0].content.length > 100); // vrai contenu d'index.md
});

test('« Premature close » APRÈS message_stop : toléré, la boucle continue', async () => {
  const { client } = makeClient([
    {
      toolUses: [{ id: 'tu_1', name: 'list_wiki_folder', input: { path: 'resources' } }],
      prematureClose: true,
    },
    { text: 'Fini malgré le proxy. SOURCES: []', prematureClose: true },
  ]);
  const r = await runWikiAgent(baseOpts(client));
  assert.equal(r.iterations, 2);
  assert.equal(r.rawText, 'Fini malgré le proxy. SOURCES: []');
});

test('erreur AVANT la fin du message avec texte déjà émis : remontée à l’appelant', async () => {
  const { client, calls } = makeClient([{ text: 'tronq', failBeforeStop: true }]);
  await assert.rejects(() => runWikiAgent(baseOpts(client)), /ECONNRESET/);
  assert.equal(calls.length, 1); // pas de retry : du texte est déjà parti
});

test('flux mort sans AUCUN événement : une retentative invisible, puis succès', async () => {
  let callCount = 0;
  const good = fakeStream({ text: 'Réponse. SOURCES: []' });
  const client = {
    messages: {
      stream() {
        callCount++;
        if (callCount === 1) {
          return {
            async *[Symbol.asyncIterator]() {
              throw new Error('Premature close');
            },
          };
        }
        return good;
      },
    },
  };
  const r = await runWikiAgent(baseOpts(client));
  assert.equal(callCount, 2);
  assert.equal(r.rawText, 'Réponse. SOURCES: []');
});

test('flux mort deux fois de suite : l’erreur remonte', async () => {
  const client = {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            throw new Error('Premature close');
          },
        };
      },
    },
  };
  await assert.rejects(() => runWikiAgent(baseOpts(client)), /Premature close/);
});

test('outil en erreur (page inexistante) : la boucle continue et aboutit', async () => {
  const { client, calls } = makeClient([
    { toolUses: [{ id: 'tu_e', name: 'read_wiki_page', input: { path: 'resources/absente.md' } }] },
    { text: 'Corrigé. SOURCES: []' },
  ]);
  const r = await runWikiAgent(baseOpts(client));
  assert.equal(r.iterations, 2);
  assert.equal(r.rawText, 'Corrigé. SOURCES: []');
  const results = calls[1].messages[2].content.filter((b: any) => b.type === 'tool_result');
  assert.equal(results[0].is_error, true);
  assert.match(results[0].content, /introuvable/);
});

test('deux tool_use dans un tour : deux steps, UN SEUL message user de résultats', async () => {
  const { client, calls } = makeClient([
    {
      toolUses: [
        { id: 'tu_a', name: 'read_wiki_page', input: { path: 'index.md' } },
        { id: 'tu_b', name: 'list_wiki_folder', input: { path: 'resources' } },
      ],
    },
    { text: 'OK. SOURCES: []' },
  ]);
  const steps: any[] = [];
  await runWikiAgent(baseOpts(client, { onStep: (s) => steps.push(s) }));
  assert.equal(steps.length, 2);
  assert.equal(steps[1].label, 'Exploration du dossier resources');
  const msgs = calls[1].messages;
  assert.equal(msgs.length, 3); // un seul message user de résultats
  const results = msgs[2].content.filter((b: any) => b.type === 'tool_result');
  assert.deepEqual(results.map((r: any) => r.tool_use_id), ['tu_a', 'tu_b']);
});

test('cap d’itérations : nudge injecté, terminaison ≤ MAX_ITERATIONS appels', async () => {
  // Le modèle boucle indéfiniment sur un outil.
  const { client, calls } = makeClient([
    { toolUses: [{ id: 'tu_x', name: 'list_wiki_folder', input: { path: 'resources' } }] },
  ]);
  const r = await runWikiAgent(baseOpts(client));
  assert.ok(calls.length <= MAX_ITERATIONS);
  assert.equal(r.iterations, MAX_ITERATIONS);
  // Le nudge apparaît dans les messages du dernier appel…
  const lastMsgs = calls[calls.length - 1].messages;
  const hasNudge = lastMsgs.some(
    (m: any) =>
      Array.isArray(m.content) &&
      m.content.some((b: any) => b.type === 'text' && /Limite d'exploration atteinte/.test(b.text)),
  );
  assert.ok(hasNudge);
  // …et `tools` est présent à chaque appel (jamais retiré).
  assert.ok(calls.every((c) => Array.isArray(c.tools) && c.tools.length === 2));
});

test('deadline dépassée : nudge dès la première itération, puis réponse', async () => {
  const { client, calls } = makeClient([
    { toolUses: [{ id: 'tu_1', name: 'read_wiki_page', input: { path: 'index.md' } }] },
    { text: 'Réponse sous contrainte. SOURCES: []' },
  ]);
  const r = await runWikiAgent({ ...baseOpts(client), deadlineMs: Date.now() - 1 });
  assert.equal(r.iterations, 2);
  const userMsg = calls[1].messages[2];
  const nudge = userMsg.content.find((b: any) => b.type === 'text');
  assert.match(nudge.text, /Limite d'exploration atteinte/);
});

test('outil appelé malgré le nudge : un tool_result d’erreur puis sortie avec le texte accumulé', async () => {
  // Deadline passée → nudge après le tour 1 ; le modèle s'obstine (tours 2 et 3).
  const { client, calls } = makeClient([
    {
      text: 'Début.',
      toolUses: [{ id: 'tu_1', name: 'read_wiki_page', input: { path: 'index.md' } }],
    },
  ]);
  const r = await runWikiAgent({ ...baseOpts(client), deadlineMs: Date.now() - 1 });
  // tour 1 (exec + nudge) → tour 2 (erreur « Limite atteinte ») → tour 3 : sortie.
  assert.equal(calls.length, 3);
  assert.ok(r.rawText.includes('Début.'));
  const errResults = calls[2].messages[4].content.filter((b: any) => b.type === 'tool_result');
  assert.equal(errResults[0].is_error, true);
  assert.match(errResults[0].content, /Limite atteinte/);
});

test('abort (bouton Stop) : signal transmis au SDK, erreur remontée SANS retentative', async () => {
  const controller = new AbortController();
  const optionsSeen: any[] = [];
  let callCount = 0;
  const client = {
    messages: {
      stream(_params: any, options?: any) {
        callCount++;
        optionsSeen.push(options);
        // L'abort survient pendant le stream : celui-ci meurt à la racine —
        // cas qui, SANS abort, déclencherait la retentative invisible.
        controller.abort();
        return {
          async *[Symbol.asyncIterator]() {
            throw new Error('Request was aborted.');
          },
        };
      },
    },
  };
  await assert.rejects(
    () => runWikiAgent({ ...baseOpts(client), signal: controller.signal }),
    /aborted/,
  );
  assert.equal(callCount, 1); // abort → jamais de retry, même flux mort à la racine
  assert.equal(optionsSeen[0]?.signal, controller.signal); // signal bien propagé au SDK
});

test('signal déjà aborté en entrée de boucle : sortie immédiate, zéro appel API', async () => {
  const controller = new AbortController();
  controller.abort();
  const { client, calls } = makeClient([{ text: 'ne doit jamais partir' }]);
  const r = await runWikiAgent({ ...baseOpts(client), signal: controller.signal });
  assert.equal(calls.length, 0);
  assert.equal(r.rawText, '');
});

// ————————————————————————————————————————————————————————————————
// buildSystemPrompt

test('buildSystemPrompt : bloc FILTRES seulement si filtres actifs', () => {
  const sans = buildSystemPrompt('');
  assert.ok(!sans.includes('FILTRES ACTIFS'));
  assert.ok(sans.includes('COMMENCE TOUJOURS ICI'));
  assert.ok(sans.includes('SOURCES:'));
  const avec = buildSystemPrompt('type ∈ {Article}');
  assert.ok(avec.includes('FILTRES ACTIFS (CONTRAINTE ABSOLUE) : type ∈ {Article}.'));
});
