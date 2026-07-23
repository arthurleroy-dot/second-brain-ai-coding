/**
 * Tests du store de suivi d'ingestion (`ingest-view-store.ts`) — volet FLUX :
 * la boucle de lecture NDJSON de `connectStream` peuple `view.steps`, dérive
 * reading→done (l'étape N+1 coche la N) et transforme les `delta` en compteur de
 * caractères (`detail`). Le polling terminal reste l'autorité de state/slug/cost.
 *
 * Environnement simulé (repris de chat-stream-store.test.ts) : `fetch` mocké,
 * routé par URL — `/api/ingest-stream` renvoie un corps NDJSON piloté à la main
 * (FakeBody), `/api/ingest-status` renvoie un JSON d'état contrôlable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Corps NDJSON piloté à la main, sensible à l'abort et au cancel du reader. */
class FakeBody {
  private enc = new TextEncoder();
  private chunks: Uint8Array[] = [];
  private waiters: Array<{ resolve: (r: unknown) => void; reject: (e: unknown) => void }> = [];
  private closed = false;
  private canceled = false;
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
      } else if (this.closed || this.canceled) {
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
          if (this.canceled || this.signal?.aborted) {
            resolve({ done: true, value: undefined });
            return;
          }
          this.waiters.push({ resolve, reject });
          this.pump();
        }),
      cancel: async () => {
        this.canceled = true;
        this.pump();
      },
    };
  }
}

let streamBody: FakeBody;
let statusResponse: Record<string, unknown> = { state: 'processing' };

(globalThis as any).fetch = async (url: unknown, init?: { signal?: AbortSignal }) => {
  const u = String(url);
  if (u.includes('/api/ingest-stream')) {
    const body = streamBody;
    body.bind(init?.signal);
    return { ok: true, body };
  }
  // /api/ingest-status (mode file-scoped ou global) : renvoie l'état contrôlé.
  return { ok: true, json: async () => statusResponse };
};

/** Laisse les fetch mockés + la boucle de lecture asynchrone se propager. */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// Import APRÈS la mise en place des mocks.
import { startTracking, getView, clear } from '../ingest-view-store';

test('flux step,step,done : dérivation reading→done, les 2 étapes finissent cochées', async () => {
  streamBody = new FakeBody();
  statusResponse = { state: 'processing' };

  startTracking('f.pdf'); // pollOnce (→ processing) + connectStream
  await settle();
  assert.equal(getView()!.state, 'processing');

  streamBody.push({ type: 'step', id: 1, phase: 'extract', label: 'Extraction du texte', file: 'f.pdf' });
  await settle();
  assert.deepEqual(getView()!.steps.map((s) => s.status), ['reading'], 'la 1re étape démarre en lecture');

  streamBody.push({ type: 'step', id: 2, phase: 'analyze', label: 'Analyse', file: 'f.pdf' });
  await settle();
  assert.deepEqual(getView()!.steps.map((s) => s.status), ['done', 'reading'], 'l’arrivée de la 2 coche la 1');
  assert.deepEqual(getView()!.steps.map((s) => s.phase), ['extract', 'analyze']);

  // Terminal : done → toutes cochées ; le polling bascule l'état à ingested.
  statusResponse = { state: 'ingested', slug: 'demo', fileCostUsd: 0.1 };
  streamBody.push({ type: 'done' });
  streamBody.close();
  await settle();

  const v = getView()!;
  assert.equal(v.state, 'ingested', 'le polling (autorité terminale) bascule l’état');
  assert.equal(v.slug, 'demo');
  assert.ok(v.steps.length === 2 && v.steps.every((s) => s.status === 'done'), 'les 2 étapes conservées, toutes cochées');
  assert.ok(v.steps.every((s) => s.detail === undefined), 'les detail sont nettoyés au terminal');
  clear();
});

test('un delta met à jour le detail (compteur de caractères) de la dernière étape reading', async () => {
  streamBody = new FakeBody();
  statusResponse = { state: 'processing' };

  startTracking('g.pdf');
  await settle();

  streamBody.push({ type: 'step', id: 1, phase: 'analyze', label: 'Analyse', file: 'g.pdf' });
  await settle();
  assert.equal(getView()!.steps[0].detail, undefined, 'pas de detail avant le premier delta');

  streamBody.push({ type: 'delta', text: 'x'.repeat(1240) });
  await settle();
  const s1 = getView()!.steps[0];
  assert.equal(s1.status, 'reading');
  assert.ok(s1.detail && s1.detail.includes('1 240'), `compteur attendu (1 240), obtenu: ${s1.detail}`);

  streamBody.push({ type: 'delta', text: 'yy' }); // cumul
  await settle();
  assert.ok(getView()!.steps[0].detail!.includes('1 242'), 'le compteur est cumulatif');

  clear();
});
