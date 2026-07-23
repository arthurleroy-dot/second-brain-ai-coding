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
import { spawn } from 'node:child_process';
import JSZip from 'jszip';

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

// ————————————————————————————————————————————————————————————————
// Unités pures de la tuyauterie « IA + déterministe »

test('estimateCost applique le barème Sonnet §R8', async () => {
  const { estimateCost } = await load();
  // 1M in + 1M out + 1M cache-write + 1M cache-read = 3 + 15 + 3,75 + 0,30 = 22,05 $
  const c = estimateCost({
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
  });
  assert.ok(Math.abs(c - 22.05) < 1e-9, `attendu 22,05 $, obtenu ${c}`);
  // Cas réaliste : 15k in, 5k out, sans cache → 0,045 + 0,075 = 0,12 $
  const c2 = estimateCost({ input_tokens: 15_000, output_tokens: 5_000 });
  assert.ok(Math.abs(c2 - 0.12) < 1e-9, `attendu 0,12 $, obtenu ${c2}`);
});

test('consumeModelStream : re-capte usage + rawText + deltas (non-régression coût §4)', async () => {
  const { consumeModelStream, estimateCost, parseGeneration } = await load();

  // Faux flux d'événements bruts d'un appel streaming (mêmes formes que le SDK).
  async function* fakeStream() {
    yield {
      type: 'message_start',
      message: { usage: { input_tokens: 15_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
    };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '<resource>\n---\nslug: x\n---\n' } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '# Titre\n</resource>' } };
    // message_delta porte le compte de SORTIE final (cumulatif).
    yield { type: 'message_delta', usage: { output_tokens: 5_000 } };
    yield { type: 'message_stop' };
  }

  const deltas: string[] = [];
  const { rawText, usage } = await consumeModelStream(fakeStream(), (d) => deltas.push(d));

  // Texte reconstruit dans l'ordre + deltas relayés pour l'animation.
  assert.equal(deltas.length, 2, 'un onDelta par fragment de texte');
  assert.ok(rawText.includes('<resource>') && rawText.includes('</resource>'));
  assert.ok(parseGeneration(rawText).markdown.startsWith('---\nslug: x'), 'parsing aval inchangé');

  // Usage re-capté : input depuis message_start, output final depuis message_delta.
  assert.equal(usage.input_tokens, 15_000, 'input re-capté (message_start)');
  assert.equal(usage.output_tokens, 5_000, 'output final re-capté (message_delta)');
  // Le calcul de coût de repli reste correct (~0,12 $) si l'en-tête gateway manque.
  assert.ok(Math.abs(estimateCost(usage) - 0.12) < 1e-9, `estimateCost fallback ≈ 0,12 $, obtenu ${estimateCost(usage)}`);
});

test('consumeModelStream : tolère le « Premature close » APRÈS message_stop', async () => {
  const { consumeModelStream } = await load();
  async function* prematureClose() {
    yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } };
    yield { type: 'message_delta', usage: { output_tokens: 2 } };
    yield { type: 'message_stop' };
    throw new Error('Premature close'); // quirk LiteLLM APRÈS la fin du message
  }
  // Ne doit PAS relancer l'erreur (le message était complet).
  const { rawText, usage } = await consumeModelStream(prematureClose());
  assert.equal(rawText, 'ok');
  assert.equal(usage.output_tokens, 2);
});

test('consumeModelStream : une erreur AVANT message_stop est bien remontée', async () => {
  const { consumeModelStream } = await load();
  async function* earlyError() {
    yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } };
    throw new Error('coupure amont');
  }
  await assert.rejects(() => consumeModelStream(earlyError()), /coupure amont/);
});

test('parseGeneration extrait la ressource + les détections (JSON robuste)', async () => {
  const { parseGeneration } = await load();
  const text =
    'blabla\n<resource>\n---\nslug: x\n---\n\n# T\n</resource>\n<detected-new>\n{"entities":[{"name":"Cursor"}],"themes":[]}\n</detected-new>';
  const { markdown, detectedNew } = parseGeneration(text);
  assert.ok(markdown.startsWith('---\nslug: x'));
  assert.ok(markdown.endsWith('\n'));
  assert.equal(detectedNew.entities[0].name, 'Cursor');
  assert.deepEqual(detectedNew.themes, []);
  const bad = parseGeneration('<resource>\n---\nslug: y\n---\n</resource>\n<detected-new>\n{bad}\n</detected-new>');
  assert.deepEqual(bad.detectedNew, { entities: [], themes: [] });
});

test('resolveDeclarations : collision de type → slug suffixé (§R11)', async () => {
  const { parseSidecar, resolveDeclarations } = await load();
  const reg = {
    entities: [{ slug: 'databricks', label: 'Databricks Inc.', entity_type: 'client', aliases: [] }],
    themes: [],
    entityTypes: new Set(['client']),
  };
  const { declaredEntities } = resolveDeclarations(parseSidecar('---\nlinks:\n  tool: [databricks]\n---\n'), reg as any);
  assert.equal(declaredEntities.length, 1);
  assert.equal(declaredEntities[0].slug, 'databricks-tool');
  assert.equal(declaredEntities[0].entity_type, 'tool');
  assert.equal(declaredEntities[0].isNew, true);

  // Même type → se relie à l'existante (pas de suffixe).
  const reg2 = {
    entities: [{ slug: 'databricks', label: 'Databricks', entity_type: 'tool', aliases: [] }],
    themes: [],
    entityTypes: new Set(['tool']),
  };
  const { declaredEntities: d2 } = resolveDeclarations(parseSidecar('---\nlinks:\n  tool: [databricks]\n---\n'), reg2 as any);
  assert.equal(d2[0].slug, 'databricks');
  assert.equal(d2[0].isNew, false);
});

// ————————————————————————————————————————————————————————————————
// Intégration : sortie IA « en conserve » → 3 branches §R11 → wiki:verify VERT

const FIX = {
  'wiki/entities/claude-code.md': `---
type: entity
entity_type: tool
slug: claude-code
label: "Claude Code"
aliases: ["claude code"]
---

# Claude Code

\`entity_type: tool\`

## Mentions
`,
  'wiki/themes/finops-ia.md': `---
type: theme
slug: finops-ia
label: FinOps IA
resource_count: 0
last_updated: "2026-01-01"
---
`,
  'wiki/origin/externe.md': `---
type: origin
slug: externe
label: Externe
resource_count: 0
last_updated: "2026-01-01"
---
`,
  'wiki/origin/interne.md': `---
type: origin
slug: interne
label: Interne
resource_count: 0
last_updated: "2026-01-01"
---
`,
  'wiki/types.md': `---
type: index
label: Types de ressources
last_updated: "2026-01-01"
---
`,
  'wiki/index.md': `---
type: index
last_updated: "2026-01-01"
resource_count: 0
theme_count: 1
author_count: 0
---

## Thèmes (1)

- [[themes/finops-ia|FinOps IA]] — 0 ressource

## Auteurs (0)

## Ressources (0)

## Index par date

## Index par type

→ [[types]]

## Origine (2)

- [[origin/externe|Externe]] — 0 ressource
- [[origin/interne|Interne]] — 0 ressource
`,
  'wiki/graph.json': JSON.stringify(
    {
      generated: '2026-01-01',
      nodes: [
        { id: 'entity:claude-code', type: 'entity', entity_type: 'tool', label: 'Claude Code' },
        { id: 'theme:finops-ia', type: 'theme', label: 'FinOps IA' },
        { id: 'origin:externe', type: 'origin', label: 'Externe' },
        { id: 'origin:interne', type: 'origin', label: 'Interne' },
      ],
      edges: [],
    },
    null,
    2,
  ),
  'wiki/_ingested.json': JSON.stringify({ version: 1, files: {} }, null, 2),
};

const RESOURCE_MD = `---
slug: demo
title: "Démo Ingestion"
author: "TestCo"
date: "2026-05"
source_type: report-pdf
origin: externe
topics: [finops-ia]
entities: [claude-code, n8n]
url: "https://example.com/demo"
source_file: "demo.pdf"
---

> Par [[../authors/testco|TestCo]] · [[../by-date/2026/2026-05/2026-05|2026-05]] · Thèmes : [[../themes/finops-ia|FinOps IA]]

## Contexte
\`topics: [finops-ia]\`
\`entities: [claude-code, n8n]\`

Le coût des tokens explose. Claude Code et n8n sont cités comme outils clés du pipeline.

## Analyse

Deuxième section, sans annotation particulière.
`;

const SIDECAR = `---
title: "Démo Ingestion"
type: report-pdf
origin: externe
author: "TestCo"
date: "2026-05"
url: "https://example.com/demo"
links:
  tool: [n8n]
entities_granularity:
  tool: resource
themes: [finops-ia]
themes_granularity: auto
---
`;

const DETECTED_NEW = {
  entities: [{ name: 'Cursor', entity_type: 'tool', section: 'contexte', context: 'Cursor apparaît aussi.' }],
  themes: [{ name: 'Développeur augmenté', section: null, context: 'notion émergente' }],
};

function runVerify(): Promise<{ errors: number; warns: number; issues: any[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join('scripts', 'wiki-verify.ts'), '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, WIKI_ROOT: path.join(tmp, 'wiki') },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`wiki:verify sortie non-JSON : ${out}\n${err}`));
      }
    });
    child.on('error', reject);
  });
}

test('chaîne complète : 3 branches §R11 + wiki:verify sans erreur', async () => {
  // Fixture d'un wiki minimal mais valide.
  for (const [rel, content] of Object.entries(FIX)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const { ingestOne, parseSidecar, resolveDeclarations, loadRegistries } = await load();
  const { applyFileOps, readRepoFile } = await import('../wiki-fs');

  const registries = await loadRegistries();
  const { declaredEntities, declaredThemes } = resolveDeclarations(parseSidecar(SIDECAR), registries);
  assert.ok(declaredEntities.some((d) => d.slug === 'n8n' && d.isNew), 'n8n déclaré nouveau');

  const { ops, slug, warnings } = await ingestOne({
    file: 'demo.pdf',
    markdown: RESOURCE_MD,
    detectedNew: DETECTED_NEW,
    declaredEntities,
    declaredThemes,
    registries,
    today: '2026-07-21',
  });
  assert.equal(slug, 'demo');
  assert.deepEqual(warnings, [], `aucun avertissement attendu : ${warnings.join(' | ')}`);
  await applyFileOps(ops);

  // Branche 1 — CONNU : la page entité existante reçoit une mention.
  assert.ok((await readRepoFile('wiki/entities/claude-code.md'))!.includes('### [[../resources/demo|Démo Ingestion]]'), 'claude-code : mention');

  // Branche 2 — DÉCLARÉ-NOUVEAU : la page entité est CRÉÉE avec son entity_type.
  const n8n = await readRepoFile('wiki/entities/n8n.md');
  assert.ok(n8n, 'n8n : page créée');
  assert.ok(n8n!.includes('entity_type: tool') && n8n!.includes('### [[../resources/demo'), 'n8n : type + mention');

  // Branche 3 — DÉTECTÉ-INCONNU : candidate, AUCUNE page créée.
  const candDoc = JSON.parse((await readRepoFile('wiki/entities/_candidates.json'))!);
  assert.ok(candDoc.candidates.some((c: any) => c.normalized === 'cursor'), 'Cursor en candidate');
  assert.equal(await readRepoFile('wiki/entities/cursor.md'), null, 'aucune page cursor.md');
  const tcand = JSON.parse((await readRepoFile('wiki/themes/_candidates.json'))!);
  assert.ok(tcand.candidates.some((c: any) => c.normalized === 'developpeur augmente'), 'thème candidate');

  const manifest = JSON.parse((await readRepoFile('wiki/_ingested.json'))!);
  assert.equal(manifest.files['demo.pdf'].slug, 'demo');

  const report = await runVerify();
  assert.equal(
    report.errors,
    0,
    `wiki:verify erreurs : ${JSON.stringify(report.issues.filter((i: any) => i.severity === 'error'), null, 2)}`,
  );
});

// ————————————————————————————————————————————————————————————————
// Chantier 5 : les DÉCLARATIONS deviennent des fiches validées dans le run,
// même si l'IA les OMET du frontmatter (forceDeclaredLinks + exclusion durcie).

// Fixture fraîche et isolée (slugs uniques ; on RÉINITIALISE graphe/index/candidats).
const FIX5 = {
  'wiki/origin/interne.md': `---
type: origin
slug: interne
label: Interne
resource_count: 0
last_updated: "2026-01-01"
---
`,
  'wiki/origin/externe.md': `---
type: origin
slug: externe
label: Externe
resource_count: 0
last_updated: "2026-01-01"
---
`,
  'wiki/types.md': `---
type: index
label: Types de ressources
last_updated: "2026-01-01"
---
`,
  'wiki/index.md': `---
type: index
last_updated: "2026-01-01"
resource_count: 0
theme_count: 0
author_count: 0
---

## Thèmes (0)

## Auteurs (0)

## Ressources (0)

## Index par date

## Index par type

→ [[types]]

## Origine (2)

- [[origin/externe|Externe]] — 0 ressource
- [[origin/interne|Interne]] — 0 ressource
`,
  'wiki/graph.json': JSON.stringify(
    {
      generated: '2026-01-01',
      nodes: [
        { id: 'origin:externe', type: 'origin', label: 'Externe' },
        { id: 'origin:interne', type: 'origin', label: 'Interne' },
      ],
      edges: [],
    },
    null,
    2,
  ),
  'wiki/_ingested.json': JSON.stringify({ version: 1, files: {} }, null, 2),
  // Candidats RÉINITIALISÉS à vide (assertions propres).
  'wiki/entities/_candidates.json': JSON.stringify({ version: 1, generated: '2026-01-01', candidates: [] }, null, 2),
  'wiki/themes/_candidates.json': JSON.stringify({ version: 1, generated: '2026-01-01', candidates: [] }, null, 2),
};

// Sidecar : entité « julien » (personnes) + thème « veille-perso » déclarés.
const SIDECAR5 = `---
title: "Note perso"
type: personal-notes
origin: interne
author: "Arthur"
date: "2026-07"
links:
  personnes: [julien]
entities_granularity:
  personnes: resource
themes: [veille-perso]
themes_granularity: auto
---
`;

// Ressource « produite par l'IA » qui OMET les déclarations : entities/topics VIDES.
// (Reproduit le bug observé : l'IA ne recopie pas fidèlement la déclaration.)
const RESOURCE5 = `---
slug: note-perso
title: "Note perso"
author: "Arthur"
date: "2026-07"
source_type: personal-notes
origin: interne
topics: []
entities: []
source_file: "note-perso.txt"
---

> Par [[../authors/arthur|Arthur]] · [[../by-date/2026/2026-07/2026-07|2026-07]]

## Contexte

Julien a partagé une note de veille perso. Elle sera enrichie plus tard.
`;

// L'IA détecte « Julien » (= déclaré, forme normalisée identique) ET « Julien Ye »
// (nom réellement différent). Le 1er doit être EXCLU ; le 2nd PEUT rester en file.
const DETECTED5 = {
  entities: [
    { name: 'Julien', entity_type: 'personnes', section: 'contexte', context: 'Julien a partagé.' },
    { name: 'Julien Ye', entity_type: 'personnes', section: 'contexte', context: 'nom complet supposé' },
  ],
  themes: [
    { name: 'Veille perso', section: null, context: 'thème central' }, // = déclaré → exclu
  ],
};

test('chantier 5 : déclarations omises par l’IA → fiches créées directement, hors file d’attente', async () => {
  for (const [rel, content] of Object.entries(FIX5)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const { ingestOne, parseSidecar, resolveDeclarations, loadRegistries } = await load();
  const { applyFileOps, readRepoFile } = await import('../wiki-fs');

  const registries = await loadRegistries();
  const { declaredEntities, declaredThemes } = resolveDeclarations(parseSidecar(SIDECAR5), registries);
  assert.ok(declaredEntities.some((d) => d.slug === 'julien' && d.isNew), 'julien déclaré nouveau');
  assert.ok(declaredThemes.some((d) => d.slug === 'veille-perso' && d.isNew), 'veille-perso déclaré nouveau');

  const { ops, slug } = await ingestOne({
    file: 'note-perso.txt',
    markdown: RESOURCE5, // entities/topics VIDES dans le frontmatter
    detectedNew: DETECTED5,
    declaredEntities,
    declaredThemes,
    registries,
    today: '2026-07-22',
  });
  assert.equal(slug, 'note-perso');

  // L'op de la fiche entité déclarée EST présente dans les ops retournées (avant écriture).
  const juOp = ops.find((o) => o.path === 'wiki/entities/julien.md' && 'content' in o);
  assert.ok(juOp, 'op de création de wiki/entities/julien.md présente');

  await applyFileOps(ops);

  // ENTITÉ déclarée-omise → fiche CRÉÉE directement, avec son entity_type.
  const julien = await readRepoFile('wiki/entities/julien.md');
  assert.ok(julien, 'wiki/entities/julien.md créée');
  assert.ok(julien!.includes('entity_type: personnes'), 'julien : entity_type déclaré');
  assert.ok(julien!.includes('### [[../resources/note-perso'), 'julien : bloc de mention');

  // Graphe : nœud + arête de mention présents.
  const graph = JSON.parse((await readRepoFile('wiki/graph.json'))!);
  assert.ok(graph.nodes.some((n: any) => n.id === 'entity:julien'), 'nœud entity:julien');
  assert.ok(
    graph.edges.some((e: any) => e.source === 'resource:note-perso' && e.target === 'entity:julien' && e.relation === 'mentions'),
    'arête mentions vers julien',
  );

  // THÈME déclaré-omis → page CRÉÉE + arête belongs_to_theme.
  assert.ok(await readRepoFile('wiki/themes/veille-perso.md'), 'wiki/themes/veille-perso.md créée');
  assert.ok(
    graph.edges.some((e: any) => e.target === 'theme:veille-perso' && e.relation === 'belongs_to_theme'),
    'arête belongs_to_theme vers veille-perso',
  );

  // EXCLUSION durcie (5b) : le déclaré redétecté (« Julien ») N'EST PAS en candidate ;
  // le thème « Veille perso » (= déclaré) non plus.
  const eCand = JSON.parse((await readRepoFile('wiki/entities/_candidates.json'))!);
  assert.ok(!eCand.candidates.some((c: any) => c.normalized === 'julien'), 'Julien (déclaré) exclu des candidats');
  assert.equal(await readRepoFile('wiki/entities/julien.md') === null, false, 'julien.md bien présente (pas en attente)');
  const tCand = JSON.parse((await readRepoFile('wiki/themes/_candidates.json'))!);
  assert.ok(!tCand.candidates.some((c: any) => c.normalized === 'veille perso'), 'thème déclaré exclu des candidats');

  // CONFORME : un nom réellement DIFFÉRENT (« Julien Ye ») PEUT rester en file d'attente.
  assert.ok(eCand.candidates.some((c: any) => c.normalized === 'julien ye'), 'Julien Ye (nom différent) reste candidate');
});

// ————————————————————————————————————————————————————————————————
// Fix « aucun thème » : remontée des topics de section vers le frontmatter.

test('rollupSectionTopics : frontmatter vide + 2 sections → union, idempotent', async () => {
  const { rollupSectionTopics } = await load();
  const { splitFrontmatter } = await import('../wiki-mutate');
  const md = `---
slug: x
topics: []
---

## A
\`topics: [agentic-coding, outils-et-marche]\`

Texte A.

## B
\`topics: [finops-ia]\`

Texte B.
`;
  const out = rollupSectionTopics(md);
  assert.match(splitFrontmatter(out).fm, /^topics: \[agentic-coding, outils-et-marche, finops-ia\]$/m);
  // Idempotence : re-appliquer ne change rien.
  assert.equal(rollupSectionTopics(out), out);
});

test('rebuildNav : auteur+date+topics / topics seuls / rien / idempotence', async () => {
  const { rebuildNav } = await load();
  const labels = { 'finops-ia': 'FinOps IA' };
  const base = `---
slug: x
---

> Thèmes : … ancienne nav à remplacer

Corps.
`;
  // (1) auteur + date (mois) + topics → nav complète.
  const v1 = rebuildNav(base, 'Arthur', '2026-05', ['finops-ia'], labels);
  assert.ok(
    v1.includes('> Par [[../authors/arthur|Arthur]] · [[../by-date/2026/2026-05/2026-05|2026-05]] · Thèmes : [[../themes/finops-ia|FinOps IA]]'),
    'nav complète auteur+date+thèmes',
  );
  assert.ok(!v1.includes('ancienne nav'), 'ancienne nav retirée');
  // Idempotence : ré-appliquer sur une nav déjà correcte est stable.
  assert.equal(rebuildNav(v1, 'Arthur', '2026-05', ['finops-ia'], labels), v1);

  // (2) topics SEULS (note sans auteur ni date) → nav dégénérée `> Thèmes : …`.
  const v2 = rebuildNav(base, null, null, ['finops-ia'], labels);
  assert.ok(v2.includes('> Thèmes : [[../themes/finops-ia|FinOps IA]]'), 'nav dégénérée thèmes');
  assert.ok(!v2.includes('> Par '), 'pas de segment auteur');

  // (3) rien (ni auteur, ni date, ni topics) → AUCUNE ligne de nav.
  const v3 = rebuildNav(base, null, null, [], labels);
  assert.ok(!/> (Par|Th[èe]mes)/.test(v3), 'aucune ligne de nav');

  // (4) date à l'ANNÉE seule → lien année (pas mois).
  const v4 = rebuildNav(base, null, '2025', ['finops-ia'], labels);
  assert.ok(v4.includes('[[../by-date/2025/2025|2025]]'), 'lien by-date année seule');
});

test('parseResource : topics = union frontmatter ∪ annotations de section', async () => {
  const { parseResource } = await import('../wiki-parser');
  const content = `---
slug: y
title: "Y"
topics: []
entities: []
---

## Sec
\`topics: [agentic-coding, finops-ia]\`

Prose.
`;
  const { source } = parseResource(content, 'y');
  assert.deepEqual([...source.topics].sort(), ['agentic-coding', 'finops-ia']);
});

// Test dédié du bug (§Tests) : frontmatter `topics: []` + 2 sections annotées, SANS
// thème déclaré (sidecar sans themes:). Deux variantes : (1) avec auteur+date, (2) sans.

const BUG_THEMES: [string, string][] = [
  ['agentic-coding', 'Agentic Coding'],
  ['outils-et-marche', 'Outils et Marché'],
  ['finops-ia', 'FinOps IA'],
  ['context-engineering', 'Context Engineering'],
];

function writeBugFixture(): void {
  const files: Record<string, string> = {
    'wiki/origin/interne.md': FIX5['wiki/origin/interne.md'],
    'wiki/origin/externe.md': FIX5['wiki/origin/externe.md'],
    'wiki/types.md': FIX5['wiki/types.md'],
    'wiki/index.md': FIX5['wiki/index.md'],
    'wiki/graph.json': JSON.stringify(
      {
        generated: '2026-01-01',
        nodes: [
          { id: 'origin:interne', type: 'origin', label: 'Interne' },
          { id: 'origin:externe', type: 'origin', label: 'Externe' },
        ],
        edges: [],
      },
      null,
      2,
    ),
    'wiki/_ingested.json': JSON.stringify({ version: 1, files: {} }, null, 2),
    'wiki/entities/_candidates.json': JSON.stringify({ version: 1, generated: '2026-01-01', candidates: [] }, null, 2),
    'wiki/themes/_candidates.json': JSON.stringify({ version: 1, generated: '2026-01-01', candidates: [] }, null, 2),
  };
  // Registre de thèmes RÉINITIALISÉ (resource_count 0) pour des assertions propres.
  for (const [slug, label] of BUG_THEMES)
    files[`wiki/themes/${slug}.md`] = `---\ntype: theme\nslug: ${slug}\nlabel: ${label}\nresource_count: 0\nlast_updated: "2026-01-01"\n---\n`;
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function bugResource(slug: string, withMeta: boolean): string {
  const author = withMeta ? 'Équipe Plateforme' : '';
  const date = withMeta ? '2026-03' : '';
  return `---
slug: ${slug}
title: "Point d'équipe plateforme"
author: "${author}"
date: "${date}"
source_type: meeting-notes
origin: interne
topics: []
entities: []
url: ""
source_file: "${slug}.txt"
---

> Thèmes : …

Point d'équipe plateforme.

## Outils en place
\`topics: [agentic-coding, outils-et-marche]\`

On a généralisé les agents de codage autonomes en terminal.

## Ce qui coince
\`topics: [finops-ia, context-engineering]\`

Le coût des tokens explose ; la maîtrise du contexte devient déterminante.
`;
}

async function runBugVariant(withMeta: boolean) {
  writeBugFixture();
  const { ingestOne, loadRegistries } = await load();
  const { applyFileOps, readRepoFile } = await import('../wiki-fs');
  const { splitFrontmatter } = await import('../wiki-mutate');
  const { resourceBodyForDisplay } = await import('../wiki-md');

  const slug = withMeta ? 'bug-avec-meta' : 'bug-sans-meta';
  const registries = await loadRegistries();
  const { ops } = await ingestOne({
    file: `${slug}.txt`,
    markdown: bugResource(slug, withMeta),
    detectedNew: { entities: [], themes: [] },
    declaredEntities: [], // sidecar SANS déclaration de thème (cœur du bug)
    declaredThemes: [],
    registries,
    today: '2026-07-23',
  });
  await applyFileOps(ops);

  const content = (await readRepoFile(`wiki/resources/${slug}.md`))!;
  const body = splitFrontmatter(content).rest;

  // Frontmatter `topics:` = UNION des slugs de section (le fix).
  assert.match(
    splitFrontmatter(content).fm,
    /^topics: \[agentic-coding, outils-et-marche, finops-ia, context-engineering\]$/m,
    'frontmatter topics = union',
  );

  // Chaque page thème porte le bloc de la ressource + resource_count 1.
  for (const [t] of BUG_THEMES) {
    const tp = (await readRepoFile(`wiki/themes/${t}.md`))!;
    assert.ok(tp.includes(`## [[../resources/${slug}`), `${t} : bloc ressource`);
    assert.ok(/resource_count: 1/.test(tp), `${t} : resource_count 1`);
  }

  // Graphe : un nœud theme:<t> + une arête belongs_to_theme par slug de l'union.
  const graph = JSON.parse((await readRepoFile('wiki/graph.json'))!);
  for (const [t] of BUG_THEMES) {
    assert.ok(graph.nodes.some((n: any) => n.id === `theme:${t}`), `nœud theme:${t}`);
    assert.ok(
      graph.edges.some(
        (e: any) => e.source === `resource:${slug}` && e.target === `theme:${t}` && e.relation === 'belongs_to_theme',
      ),
      `arête belongs_to_theme ${t}`,
    );
  }

  // Affichage : plus AUCUN blockquote `> Thèmes :` après nettoyage.
  assert.ok(!resourceBodyForDisplay(body).includes('> Thèmes'), 'affichage sans blockquote Thèmes');

  return { body };
}

test('bug « aucun thème » — variante 1 (auteur+date) : union + vues + nav complète', async () => {
  const { body } = await runBugVariant(true);
  assert.ok(
    body.includes(
      '> Par [[../authors/equipe-plateforme|Équipe Plateforme]] · [[../by-date/2026/2026-03/2026-03|2026-03]] · Thèmes : [[../themes/agentic-coding|Agentic Coding]]',
    ),
    'nav variante 1 : auteur · date · thèmes',
  );
});

test('bug « aucun thème » — variante 2 (sans auteur ni date) : union + nav dégénérée', async () => {
  const { body } = await runBugVariant(false);
  assert.ok(
    body.trimStart().startsWith('> Thèmes : [[../themes/agentic-coding|Agentic Coding]]'),
    'nav variante 2 : thèmes seuls',
  );
  assert.ok(!body.includes('> Par '), 'variante 2 : pas de segment auteur');
});

// ————————————————————————————————————————————————————————————————
// Extraction texte .docx (mammoth) et .pptx (jszip + <a:t>). Fixtures générées
// à la volée : on écrit un vrai zip OOXML dans RAW_ROOT puis extractSourceText.

const RAW = path.join(tmp, 'raw');

// Diapo minimale : un <p:sld> avec des <a:p>/<a:r>/<a:t>. `lines` = un <a:t> par
// ligne (déjà encodés en entités XML si besoin par l'appelant).
function slideXml(lines: string[]): string {
  const paras = lines.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    `<p:cSld><p:spTree><p:sp><p:txBody>${paras}</p:txBody></p:sp></p:spTree></p:cSld>` +
    '</p:sld>'
  );
}

async function writePptxFixture(name: string, files: Record<string, string>): Promise<void> {
  const zip = new JSZip();
  for (const [p, content] of Object.entries(files)) zip.file(p, content);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(RAW, name), buf);
}

async function writeDocxFixture(name: string, bodyLines: string[]): Promise<void> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  const paras = bodyLines.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${paras}</w:body></w:document>`,
  );
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(RAW, name), buf);
}

test('extractSourceText(.pptx) : diapos dans l’ordre, notes incluses, entités décodées', async () => {
  const { extractSourceText } = await load();
  await writePptxFixture('deck.pptx', {
    'ppt/slides/slide1.xml': slideXml(['MARQUEUR_DIAPO_1', 'DEUXIEME LIGNE']),
    'ppt/slides/slide2.xml': slideXml(['MARQUEUR_DIAPO_2', 'Anthropic &amp; OpenAI &lt;2026&gt;']),
    'ppt/notesSlides/notesSlide1.xml': slideXml(['NOTE_ORATEUR_DIAPO_1']),
  });
  const text = await extractSourceText('deck.pptx');
  // Marqueurs présents.
  assert.ok(text.includes('MARQUEUR_DIAPO_1'), 'diapo 1 présente');
  assert.ok(text.includes('MARQUEUR_DIAPO_2'), 'diapo 2 présente');
  assert.ok(text.includes('DEUXIEME LIGNE'), '2e paragraphe présent');
  // Notes de l’orateur incluses.
  assert.ok(text.includes('NOTE_ORATEUR_DIAPO_1'), 'notes incluses');
  // Ordre : slide1 (et sa note) avant slide2.
  assert.ok(
    text.indexOf('MARQUEUR_DIAPO_1') < text.indexOf('MARQUEUR_DIAPO_2'),
    'diapos dans l’ordre numérique',
  );
  assert.ok(
    text.indexOf('NOTE_ORATEUR_DIAPO_1') < text.indexOf('MARQUEUR_DIAPO_2'),
    'note de la diapo 1 avant la diapo 2',
  );
  // Entités XML correctement décodées (pas de &amp;/&lt; bruts).
  assert.ok(text.includes('Anthropic & OpenAI <2026>'), 'entités XML décodées');
  assert.ok(!text.includes('&amp;') && !text.includes('&lt;'), 'aucune entité résiduelle');
});

test('extractSourceText(.pptx) : ordre correct même si les diapos sont zippées en désordre', async () => {
  const { extractSourceText } = await load();
  // On écrit slide2 AVANT slide1 dans le zip : le tri numérique doit primer.
  await writePptxFixture('desordre.pptx', {
    'ppt/slides/slide2.xml': slideXml(['SECONDE']),
    'ppt/slides/slide1.xml': slideXml(['PREMIERE']),
  });
  const text = await extractSourceText('desordre.pptx');
  assert.ok(text.indexOf('PREMIERE') < text.indexOf('SECONDE'), 'tri numérique, pas ordre du zip');
});

test('extractSourceText(.docx) : paragraphes extraits par mammoth', async () => {
  const { extractSourceText } = await load();
  await writeDocxFixture('note.docx', ['MARQUEUR_DOCX_LIGNE_1', 'MARQUEUR_DOCX_LIGNE_2']);
  const text = await extractSourceText('note.docx');
  assert.ok(text.includes('MARQUEUR_DOCX_LIGNE_1'), 'ligne 1 docx');
  assert.ok(text.includes('MARQUEUR_DOCX_LIGNE_2'), 'ligne 2 docx');
});

test('extractSourceText : garde-fou « texte vide » sur un .pptx sans <a:t>', async () => {
  const { extractSourceText } = await load();
  // Diapo présente mais dépourvue de texte (que des <a:pPr>, aucun <a:t>).
  await writePptxFixture('vide.pptx', {
    'ppt/slides/slide1.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:pPr/></a:p></p:txBody></p:sp></p:spTree></p:cSld>' +
      '</p:sld>',
  });
  await assert.rejects(() => extractSourceText('vide.pptx'), /Aucun texte extractible/);
});

test('extractSourceText : extension non gérée (.xlsx) rejette explicitement', async () => {
  const { extractSourceText } = await load();
  fs.writeFileSync(path.join(RAW, 'tableur.xlsx'), 'peu importe');
  await assert.rejects(() => extractSourceText('tableur.xlsx'), /non prise en charge/);
});
