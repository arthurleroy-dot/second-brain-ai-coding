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
needs_review: false
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
needs_review: false
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
