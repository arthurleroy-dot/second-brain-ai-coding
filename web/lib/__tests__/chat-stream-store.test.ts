/**
 * Tests du store de streaming (lissage machine à écrire, bouton Stop,
 * checklist des étapes, purge « Nouvelle discussion »).
 *
 * Environnement simulé : fetch renvoie un corps NDJSON piloté à la main
 * (FakeBody), requestAnimationFrame est une file vidée par frame(), et
 * l'horloge du drain (performance.now) n'avance que via frame(ms) — le
 * comportement temporel est donc entièrement déterministe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ————————————————————————————————————————————————————————————————
// Mocks d'environnement navigateur (posés AVANT tout appel au store — le store
// lit ces globals à l'exécution, pas à l'import).

let now = 0;
let rafSeq = 0;
const rafCbs = new Map<number, (ts: number) => void>();

(globalThis as any).requestAnimationFrame = (cb: (ts: number) => void) => {
  rafSeq += 1;
  rafCbs.set(rafSeq, cb);
  return rafSeq;
};
(globalThis as any).cancelAnimationFrame = (id: number) => {
  rafCbs.delete(id);
};
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => now },
  configurable: true,
  writable: true,
});

/** Avance l'horloge de `ms` puis exécute les callbacks rAF en attente. */
function frame(ms = 33) {
  now += ms;
  const cbs = [...rafCbs.values()];
  rafCbs.clear();
  for (const cb of cbs) cb(now);
}

/** Laisse la boucle de lecture asynchrone du store traiter ce qui est arrivé. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Corps de réponse NDJSON piloté à la main, sensible au signal d'abort. */
class FakeBody {
  private enc = new TextEncoder();
  private chunks: Uint8Array[] = [];
  private waiters: Array<{ resolve: (r: unknown) => void; reject: (e: unknown) => void }> = [];
  private closed = false;
  private signal: AbortSignal | undefined;

  bind(signal: AbortSignal | undefined) {
    this.signal = signal;
    signal?.addEventListener('abort', () => {
      for (const w of this.waiters.splice(0)) w.reject(new Error('The operation was aborted.'));
    });
  }

  push(evt: object) {
    this.chunks.push(this.enc.encode(JSON.stringify(evt) + '\n'));
    this.pump();
  }

  close() {
    this.closed = true;
    this.pump();
  }

  private pump() {
    while (this.waiters.length > 0) {
      if (this.chunks.length > 0) {
        this.waiters.shift()!.resolve({ done: false, value: this.chunks.shift()! });
      } else if (this.closed) {
        this.waiters.shift()!.resolve({ done: true, value: undefined });
      } else {
        break;
      }
    }
  }

  getReader() {
    return {
      read: () =>
        new Promise((resolve, reject) => {
          if (this.signal?.aborted) {
            reject(new Error('The operation was aborted.'));
            return;
          }
          this.waiters.push({ resolve, reject });
          this.pump();
        }),
    };
  }
}

let nextBody: FakeBody;
(globalThis as any).fetch = async (_url: unknown, init: { signal?: AbortSignal }) => {
  const body = nextBody;
  body.bind(init?.signal);
  if (init?.signal?.aborted) throw new Error('The operation was aborted.');
  return { ok: true, body };
};

// Import APRÈS la mise en place des mocks (par clarté ; le store ne lit les
// globals qu'à l'exécution).
import {
  abortMessage,
  getEphemeralKey,
  getState,
  resetEphemeralKey,
  seedIfAbsent,
  sendMessage,
} from '../chat-stream-store';

function lastMessage(key: string) {
  const msgs = getState(key)?.messages ?? [];
  return msgs[msgs.length - 1];
}

/**
 * Démarre un envoi et attend que la lecture du flux soit branchée. La promesse
 * de sendMessage est renvoyée DANS un objet : la retourner nue la ferait
 * adopter par `begin` (aplatissement des promesses), et `await begin(...)`
 * attendrait alors la fin complète de l'envoi — blocage circulaire.
 */
async function begin(key: string, question = 'q'): Promise<{ done: Promise<void> }> {
  seedIfAbsent(key, []);
  nextBody = new FakeBody();
  const done = sendMessage(key, null, question, undefined);
  await settle();
  return { done };
}

// ————————————————————————————————————————————————————————————————

test('lissage : un gros paquet est révélé progressivement, pas d’un bloc', async () => {
  const KEY = 'k-lissage';
  const { done: p } = await begin(KEY);

  const big = 'A'.repeat(300);
  nextBody.push({ type: 'delta', text: big });
  await settle();

  // Le paquet est arrivé d'un coup mais RIEN n'est encore affiché : la file
  // attend le premier tick du drain.
  assert.equal(lastMessage(KEY).content, '');

  frame();
  await settle();
  const shown1 = lastMessage(KEY).content.length;
  assert.ok(shown1 > 0 && shown1 < 300, `1er tick : fraction attendue, obtenu ${shown1}/300`);

  frame();
  await settle();
  const shown2 = lastMessage(KEY).content.length;
  assert.ok(shown2 > shown1 && shown2 < 300, `2e tick : progression attendue (${shown1}→${shown2})`);

  nextBody.push({ type: 'done', text: big, sources: [] });
  nextBody.close();
  await p;
  await settle();

  // Le fetch est terminé mais la file n'est pas vidée : le streaming reste
  // affiché comme actif jusqu'à la fin de l'animation.
  assert.equal(getState(KEY)!.streaming, true, 'streaming doit rester true pendant le drain');

  for (let i = 0; i < 200 && getState(KEY)!.streaming; i++) {
    frame();
    await settle();
  }
  assert.equal(getState(KEY)!.streaming, false);
  assert.equal(lastMessage(KEY).content, big, 'réconciliation finale = texte canonique');
});

test('Stop en plein flux : partiel conservé tel quel, aucun message d’erreur', async () => {
  const KEY = 'k-stop';
  const { done: p } = await begin(KEY);

  nextBody.push({ type: 'delta', text: 'Début de réponse ' });
  nextBody.push({ type: 'delta', text: 'coupée net.' });
  await settle();
  frame();
  await settle();

  abortMessage(KEY);
  await p;
  await settle();

  const st = getState(KEY)!;
  assert.equal(st.loading, false);
  assert.equal(st.streaming, false);
  const m = lastMessage(KEY);
  assert.equal(m.role, 'assistant');
  assert.equal(m.content, 'Début de réponse coupée net.', 'la file est figée, rien n’est perdu');
  assert.ok(!m.content.includes('⚠️'), 'pas de message d’erreur sur un Stop volontaire');
});

test('Stop avant le premier token : pas de bulle assistant, la question reste', async () => {
  const KEY = 'k-stop-early';
  const { done: p } = await begin(KEY, 'ma question');

  abortMessage(KEY);
  await p;

  const st = getState(KEY)!;
  assert.equal(st.messages.length, 1, 'seul le message utilisateur subsiste');
  assert.equal(st.messages[0].role, 'user');
  assert.equal(st.messages[0].content, 'ma question');
  assert.equal(st.loading, false);
  assert.equal(st.streaming, false);
});

test('flux terminé sans done (coupure amont) : partiel flushé, streaming éteint', async () => {
  const KEY = 'k-fin-sans-done';
  const { done: p } = await begin(KEY);

  nextBody.push({ type: 'delta', text: 'partiel' });
  await settle();
  nextBody.close(); // le serveur ferme sans événement 'done'
  await p;
  await settle();

  const m = lastMessage(KEY);
  assert.equal(m.content, 'partiel', 'fin sans done : la file est flushée d’un coup');
  assert.equal(getState(KEY)!.streaming, false);
  assert.ok(!m.content.includes('⚠️'));
});

test('checklist : reading → done au fil des étapes, attachée au message au done', async () => {
  const KEY = 'k-steps';
  const { done: p } = await begin(KEY);

  nextBody.push({ type: 'step', label: 'Lecture de index.md', tool: 'read_wiki_page', path: 'index.md' });
  await settle();
  assert.deepEqual(
    getState(KEY)!.steps.map((s) => s.status),
    ['reading'],
    'la 1re étape démarre en lecture',
  );

  nextBody.push({ type: 'step', label: 'Exploration du dossier resources', tool: 'list_wiki_folder', path: 'resources' });
  await settle();
  assert.deepEqual(
    getState(KEY)!.steps.map((s) => s.status),
    ['done', 'reading'],
    'l’arrivée de l’étape 2 coche la 1',
  );

  nextBody.push({ type: 'delta', text: 'Réponse.' });
  await settle();
  assert.deepEqual(
    getState(KEY)!.steps.map((s) => s.status),
    ['done', 'done'],
    'le premier texte coche tout',
  );
  assert.equal(lastMessage(KEY).role, 'assistant');

  nextBody.push({ type: 'done', text: 'Réponse.', sources: [] });
  nextBody.close();
  await p;
  await settle();

  assert.deepEqual(getState(KEY)!.steps, [], 'liste live vidée au done');
  const m = lastMessage(KEY);
  assert.equal(m.steps?.length, 2, 'trace repliable attachée au message');
  assert.ok(m.steps!.every((s) => s.status === 'done'));

  for (let i = 0; i < 50 && getState(KEY)!.streaming; i++) {
    frame();
    await settle();
  }
  assert.equal(lastMessage(KEY).content, 'Réponse.');
  assert.equal(lastMessage(KEY).steps?.length, 2, 'la trace survit à la réconciliation');
});

test('« Nouvelle discussion » pendant un flux : abort + purge, aucune entrée orpheline', async () => {
  const KEY = getEphemeralKey();
  const { done: p } = await begin(KEY);

  nextBody.push({ type: 'delta', text: 'abc' });
  await settle();
  frame();
  await settle();

  resetEphemeralKey();
  assert.notEqual(getEphemeralKey(), KEY, 'la clé éphémère a tourné');
  assert.equal(getState(KEY), undefined, 'l’ancienne entrée est purgée');

  await p;
  await settle();
  frame();
  await settle();
  assert.equal(
    getState(KEY),
    undefined,
    'ni le finally ni le drain ne recréent l’entrée purgée',
  );
});
