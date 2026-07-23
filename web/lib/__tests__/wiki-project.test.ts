/**
 * Tests du moteur de PROJECTION (`projectResource`) — fonctions pures.
 * Lancé par `npm --prefix web run test` (node:test + tsx).
 *
 * Trois familles :
 *   1. Unitaires — chaque vue/le graphe/le manifeste est correctement projeté.
 *   2. Round-trip — `deleteResource(projectResource(vide)) ≈ vide` (graphe + manifeste
 *      EXACTS, c'est ce que juge `wiki:verify`).
 *   3. Idempotence — projeter deux fois ne double rien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResourceMeta, splitFrontmatter, type FileOp, deleteResource, type DeleteViews } from '../wiki-mutate';
import { projectResource, addManifestKey, type ProjectViews } from '../wiki-project';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const typeLabel = (t: string) => (t === 'article' ? 'Article' : t === 'report-pdf' ? 'Rapport PDF' : t);
const TODAY = '2026-07-21';

const upserts = (ops: FileOp[]) => ops.filter((o): o is { path: string; content: string } => 'content' in o);
const byPath = (ops: FileOp[], p: string) => upserts(ops).find((o) => o.path === p);

// ————————————————————————————————————————————————————————————————
// Fixtures — un wiki « quasi vide » (registres présents, aucune ressource).

const RESOURCE = `---
slug: demo-resource
title: "Demo Resource"
author: "TestCo"
date: "2026-05"
source_type: report-pdf
origin: externe
topics: [finops-ia]
entities: [claude-code]
url: "https://example.com"
source_file: "demo.pdf"
---

> Par [[../authors/testco|TestCo]] · [[../by-date/2026/2026-05/2026-05|2026-05]] · Thèmes : [[../themes/finops-ia|FinOps IA]]

## Contexte
\`topics: [finops-ia]\`
\`entities: [claude-code]\`

Le coût des tokens explose. Claude Code consomme beaucoup.

## Analyse

Deuxième section sans annotation particulière.
`;

const THEME = `---
type: theme
slug: finops-ia
label: FinOps IA
resource_count: 0
last_updated: "2026-01-01"
---
`;

const ENTITY = `---
type: entity
entity_type: tool
slug: claude-code
label: "Claude Code"
aliases: ["claude code"]
---

# Claude Code

\`entity_type: tool\`

## Mentions
`;

const ORIGIN_EXT = `---
type: origin
slug: externe
label: Externe
resource_count: 0
last_updated: "2026-01-01"
---
`;
const ORIGIN_INT = `---
type: origin
slug: interne
label: Interne
resource_count: 0
last_updated: "2026-01-01"
---
`;
const TYPES = `---
type: index
label: Types de ressources
last_updated: "2026-01-01"
---
`;
const INDEX = `---
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
`;
const GRAPH = JSON.stringify({
  generated: '2026-01-01',
  nodes: [
    { id: 'theme:finops-ia', type: 'theme', label: 'FinOps IA' },
    { id: 'entity:claude-code', type: 'entity', entity_type: 'tool', label: 'Claude Code' },
    { id: 'origin:externe', type: 'origin', label: 'Externe' },
    { id: 'origin:interne', type: 'origin', label: 'Interne' },
  ],
  edges: [],
});
const MANIFEST = JSON.stringify({ version: 1, files: {} });

type State = Record<string, string>;

function freshState(): State {
  return {
    'wiki/themes/finops-ia.md': THEME,
    'wiki/entities/claude-code.md': ENTITY,
    'wiki/origin/externe.md': ORIGIN_EXT,
    'wiki/origin/interne.md': ORIGIN_INT,
    'wiki/types.md': TYPES,
    'wiki/index.md': INDEX,
    'wiki/graph.json': GRAPH,
    'wiki/_ingested.json': MANIFEST,
  };
}

function apply(state: State, ops: FileOp[]): void {
  for (const op of ops) {
    if ('delete' in op) delete state[op.path];
    else state[op.path] = op.content;
  }
}

function projectViews(
  state: State,
  resource: string,
  slug: string,
  cfg: { themeLabels: Record<string, string>; newEntities?: ProjectViews['newEntities'] },
): ProjectViews {
  const meta = parseResourceMeta(resource, slug);
  const rd = (p: string) => (p in state ? state[p] : null);
  const themes: Record<string, string | null> = {};
  for (const t of meta.topics) themes[t] = rd(`wiki/themes/${t}.md`);
  const entities: Record<string, string | null> = {};
  for (const e of meta.entities) entities[e] = rd(`wiki/entities/${e}.md`);
  const aslug = meta.author ? slugify(meta.author) : null;
  const date = meta.date ?? '';
  const year = date.slice(0, 4);
  const ym = date.slice(0, 7);
  const isMonth = date.length >= 7;
  return {
    themes,
    themeLabels: cfg.themeLabels,
    authorPath: aslug ? `wiki/authors/${aslug}.md` : null,
    authorContent: aslug ? rd(`wiki/authors/${aslug}.md`) : null,
    originPath: meta.origin ? `wiki/origin/${meta.origin}.md` : null,
    originContent: meta.origin ? rd(`wiki/origin/${meta.origin}.md`) : null,
    entities,
    newEntities: cfg.newEntities ?? {},
    yearPath: year ? `wiki/by-date/${year}/${year}.md` : null,
    yearContent: year ? rd(`wiki/by-date/${year}/${year}.md`) : null,
    monthPath: isMonth ? `wiki/by-date/${year}/${ym}/${ym}.md` : null,
    monthContent: isMonth ? rd(`wiki/by-date/${year}/${ym}/${ym}.md`) : null,
    graph: state['wiki/graph.json'],
    manifest: state['wiki/_ingested.json'],
    index: state['wiki/index.md'],
    types: rd('wiki/types.md'),
  };
}

function deleteViews(state: State, resource: string, slug: string): DeleteViews {
  const meta = parseResourceMeta(resource, slug);
  const rd = (p: string) => (p in state ? state[p] : null);
  const aslug = meta.author ? slugify(meta.author) : null;
  const date = meta.date ?? '';
  const year = date.slice(0, 4);
  const ym = date.slice(0, 7);
  const isMonth = date.length >= 7;
  const themes: Record<string, string> = {};
  for (const t of meta.topics) {
    const c = rd(`wiki/themes/${t}.md`);
    if (c !== null) themes[t] = c;
  }
  const entities: Record<string, string> = {};
  for (const e of meta.entities) {
    const c = rd(`wiki/entities/${e}.md`);
    if (c !== null) entities[e] = c;
  }
  return {
    themes,
    authorPath: aslug ? `wiki/authors/${aslug}.md` : null,
    authorContent: aslug ? rd(`wiki/authors/${aslug}.md`) : null,
    originPath: meta.origin ? `wiki/origin/${meta.origin}.md` : null,
    originContent: meta.origin ? rd(`wiki/origin/${meta.origin}.md`) : null,
    entities,
    yearPath: year ? `wiki/by-date/${year}/${year}.md` : null,
    yearContent: year ? rd(`wiki/by-date/${year}/${year}.md`) : null,
    monthPath: isMonth ? `wiki/by-date/${year}/${ym}/${ym}.md` : null,
    monthContent: isMonth ? rd(`wiki/by-date/${year}/${ym}/${ym}.md`) : null,
    graph: state['wiki/graph.json'],
    manifest: state['wiki/_ingested.json'],
    index: state['wiki/index.md'],
    types: rd('wiki/types.md'),
    metaExists: false,
  };
}

function graphSig(json: string): { nodes: string[]; edges: string[] } {
  const g = JSON.parse(json);
  return {
    nodes: g.nodes.map((n: any) => String(n.id)).sort(),
    edges: g.edges
      .map((e: any) => `${e.source}|${e.target}|${e.relation}|${(e.sections ?? []).join(',')}`)
      .sort(),
  };
}

const CFG = { themeLabels: { 'finops-ia': 'FinOps IA' } };

// ————————————————————————————————————————————————————————————————
// 1. Unitaires

test('projectResource : ressource écrite verbatim', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  assert.equal(byPath(ops, 'wiki/resources/demo-resource.md')!.content, RESOURCE);
});

test('projectResource : bloc thème ajouté + resource_count recalculé', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const theme = byPath(ops, 'wiki/themes/finops-ia.md')!.content;
  assert.ok(theme.includes('## [[../resources/demo-resource|Demo Resource]]'));
  assert.ok(theme.includes('`2026-05 · report-pdf · externe — TestCo`'));
  assert.ok(theme.includes('#contexte|Contexte]] — Le coût des tokens explose.'));
  assert.ok(theme.includes('resource_count: 1'));
});

test('projectResource : page auteur CRÉÉE (nouvel auteur)', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const author = byPath(ops, 'wiki/authors/testco.md')!.content;
  assert.ok(author.includes('type: author'));
  assert.ok(author.includes('resource_count: 1'));
  assert.ok(author.includes('| [[../resources/demo-resource\\|Demo Resource]] | 2026-05 | report-pdf | externe | finops-ia |'));
});

test('projectResource : entité (registre) reçoit une mention « Ressource entière »', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const ent = byPath(ops, 'wiki/entities/claude-code.md')!.content;
  assert.ok(ent.includes('### [[../resources/demo-resource|Demo Resource]]'));
  assert.ok(ent.includes('`2026-05 · report-pdf — TestCo`'));
  assert.ok(ent.includes('- Ressource entière : '));
});

test('projectResource : node resource + 7 arêtes présentes', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const { nodes, edges } = graphSig(byPath(ops, 'wiki/graph.json')!.content);
  assert.ok(nodes.includes('resource:demo-resource'));
  assert.ok(nodes.includes('author:testco'));
  assert.ok(nodes.includes('type:report-pdf'));
  assert.ok(nodes.includes('date:2026-05'));
  assert.ok(nodes.includes('date:2026'));
  const R = 'resource:demo-resource';
  assert.ok(edges.includes(`${R}|author:testco|written_by|`));
  assert.ok(edges.includes(`${R}|type:report-pdf|has_type|`));
  assert.ok(edges.includes(`${R}|origin:externe|has_origin|`));
  assert.ok(edges.includes(`${R}|theme:finops-ia|belongs_to_theme|`));
  assert.ok(edges.includes(`${R}|entity:claude-code|mentions|`)); // niveau ressource → pas de sections
  assert.ok(edges.includes(`${R}|date:2026-05|published_on|`));
  assert.ok(edges.includes(`date:2026-05|date:2026|year_of|`));
  assert.equal(edges.length, 7, '7 arêtes exactement');
});

test('projectResource : clé manifeste ajoutée', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const manifest = JSON.parse(byPath(ops, 'wiki/_ingested.json')!.content);
  assert.deepEqual(manifest.files['demo.pdf'], { slug: 'demo-resource', ingested_at: TODAY, run: 'local' });
});

test('projectResource : types.md — section créée + ligne', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const types = byPath(ops, 'wiki/types.md')!.content;
  assert.ok(types.includes('## report-pdf (1 ressource)'));
  assert.ok(types.includes('| [[resources/demo-resource\\|Demo Resource]] | TestCo | 2026-05 | externe |'));
});

test('projectResource : index — compteurs incrémentés + sous-section de type', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const idx = byPath(ops, 'wiki/index.md')!.content;
  const { fm } = splitFrontmatter(idx);
  assert.ok(fm.includes('resource_count: 1'));
  assert.ok(fm.includes('author_count: 1'));
  assert.ok(idx.includes('## Ressources (1)'));
  assert.ok(idx.includes('### Rapport PDF (1)'));
  assert.ok(idx.includes('- [[resources/demo-resource|Demo Resource]] — TestCo · 2026-05'));
  assert.ok(idx.includes('## Auteurs (1)'));
  assert.ok(idx.includes('- [[authors/testco|TestCo]] — 1 ressource'));
  assert.ok(idx.includes('- [[themes/finops-ia|FinOps IA]] — 1 ressource'));
  assert.ok(idx.includes('- [[origin/externe|Externe]] — 1 ressource'));
  assert.ok(idx.includes('- [[by-date/2026/2026|2026]] — 1 ressource'));
});

test('projectResource : by-date — page mois créée + bullet « Par mois » dans l’année', () => {
  const ops = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(freshState(), RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  const month = byPath(ops, 'wiki/by-date/2026/2026-05/2026-05.md')!.content;
  assert.ok(month.includes('period: "2026-05"'));
  assert.ok(month.includes('| [[../../../resources/demo-resource\\|Demo Resource]] | TestCo | report-pdf | externe | finops-ia |'));
  const year = byPath(ops, 'wiki/by-date/2026/2026.md')!.content;
  assert.ok(year.includes('## Par mois'));
  assert.ok(year.includes('- [[by-date/2026/2026-05/2026-05|2026-05]] — 1 ressource (TestCo)'));
});

// ————————————————————————————————————————————————————————————————
// 2. Round-trip : projeter puis supprimer → graphe + manifeste EXACTS

test('round-trip : deleteResource(projectResource(vide)) ramène graphe + manifeste à l’identique', () => {
  const state = freshState();
  const g0 = graphSig(state['wiki/graph.json']);

  const projOps = projectResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: projectViews(state, RESOURCE, 'demo-resource', CFG),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });
  apply(state, projOps);

  // Sanity : la ressource + ses vues existent après projection.
  assert.ok(state['wiki/resources/demo-resource.md']);
  assert.ok(state['wiki/authors/testco.md']);
  assert.ok(state['wiki/by-date/2026/2026-05/2026-05.md']);

  const delOps = deleteResource({
    slug: 'demo-resource',
    resourceContent: RESOURCE,
    views: deleteViews(state, RESOURCE, 'demo-resource'),
    slugifyAuthor: slugify,
    typeLabel,
  });
  apply(state, delOps);

  // Graphe + manifeste : retour à l'état vide EXACT.
  assert.deepEqual(graphSig(state['wiki/graph.json']), g0, 'graphe identique à l’état vide');
  assert.deepEqual(JSON.parse(state['wiki/_ingested.json']).files, {}, 'manifeste vide');

  // Fichiers créés → supprimés.
  assert.ok(!state['wiki/resources/demo-resource.md'], 'ressource supprimée');
  assert.ok(!state['wiki/authors/testco.md'], 'auteur orphelin supprimé');
  assert.ok(!state['wiki/by-date/2026/2026-05/2026-05.md'], 'mois orphelin supprimé');
  assert.ok(!state['wiki/by-date/2026/2026.md'], 'année orpheline supprimée');

  // Registres (jamais supprimés) : compteurs revenus à 0, aucune trace de la ressource.
  const theme = state['wiki/themes/finops-ia.md'];
  assert.ok(!theme.includes('resources/demo-resource'), 'thème : bloc retiré');
  assert.ok(theme.includes('resource_count: 0'), 'thème : count 0');
  assert.ok(!state['wiki/entities/claude-code.md'].includes('resources/demo-resource'), 'entité : mention retirée');
  assert.ok(splitFrontmatter(state['wiki/index.md']).fm.includes('resource_count: 0'), 'index : count 0');
});

// ————————————————————————————————————————————————————————————————
// 3. Idempotence : projeter deux fois ne double rien

test('idempotence : une seconde projection ne duplique rien', () => {
  const state = freshState();
  apply(
    state,
    projectResource({
      slug: 'demo-resource',
      resourceContent: RESOURCE,
      views: projectViews(state, RESOURCE, 'demo-resource', CFG),
      slugifyAuthor: slugify,
      typeLabel,
      today: TODAY,
    }),
  );
  const g1 = graphSig(state['wiki/graph.json']);

  // Seconde projection, en relisant les vues fraîches.
  apply(
    state,
    projectResource({
      slug: 'demo-resource',
      resourceContent: RESOURCE,
      views: projectViews(state, RESOURCE, 'demo-resource', CFG),
      slugifyAuthor: slugify,
      typeLabel,
      today: TODAY,
    }),
  );

  assert.deepEqual(graphSig(state['wiki/graph.json']), g1, 'graphe inchangé');
  assert.equal(Object.keys(JSON.parse(state['wiki/_ingested.json']).files).length, 1, 'une seule clé manifeste');
  // Un seul bloc thème, une seule ligne auteur, une seule ligne de mois.
  const theme = state['wiki/themes/finops-ia.md'];
  assert.equal((theme.match(/## \[\[\.\.\/resources\/demo-resource/g) ?? []).length, 1, 'un seul bloc thème');
  assert.ok(theme.includes('resource_count: 1'), 'thème count stable à 1');
  const author = state['wiki/authors/testco.md'];
  assert.equal((author.match(/resources\/demo-resource/g) ?? []).length, 1, 'une seule ligne auteur');
  assert.ok(state['wiki/types.md'].includes('## report-pdf (1 ressource)'), 'types stable à 1');
  const month = state['wiki/by-date/2026/2026-05/2026-05.md'];
  assert.equal((month.match(/resources\/demo-resource/g) ?? []).length, 1, 'une seule ligne mois');
  // Compteurs index + année stables (pas de double comptage).
  assert.ok(splitFrontmatter(state['wiki/index.md']).fm.includes('resource_count: 1'), 'index count stable à 1');
  assert.ok(state['wiki/index.md'].includes('## Ressources (1)'), 'index Ressources (1) stable');
  assert.ok(splitFrontmatter(state['wiki/by-date/2026/2026.md']).fm.includes('resource_count: 1'), 'année count stable à 1');
  assert.ok(state['wiki/by-date/2026/2026.md'].includes('— 1 ressource (TestCo)'), 'bullet mois stable à 1');
});

// ————————————————————————————————————————————————————————————————
// 4. addManifestKey (brique isolée)

test('addManifestKey ajoute/écrase la clé source_file', () => {
  const out = JSON.parse(addManifestKey('{"version":1,"files":{}}', 'x.pdf', { slug: 's', ingested_at: TODAY, run: 'local' }));
  assert.deepEqual(out.files['x.pdf'], { slug: 's', ingested_at: TODAY, run: 'local' });
});

// ————————————————————————————————————————————————————————————————
// 5. Multi-thèmes / multi-sections : chaque page thème ne reçoit QUE le bullet de sa
//    section ; resource_count exact ; une arête belongs_to_theme par topic.
//    (frontmatter déjà = union — c'est l'état produit en amont par `rollupSectionTopics`.)

const THEME_AGENTIC = `---
type: theme
slug: agentic-coding
label: Agentic Coding
resource_count: 0
last_updated: "2026-01-01"
---
`;

const RESOURCE_MULTI = `---
slug: multi
title: "Multi Thèmes"
author: "TestCo"
date: "2026-05"
source_type: report-pdf
origin: externe
topics: [finops-ia, agentic-coding]
entities: []
url: ""
source_file: "multi.pdf"
---

> Par [[../authors/testco|TestCo]] · [[../by-date/2026/2026-05/2026-05|2026-05]] · Thèmes : [[../themes/finops-ia|FinOps IA]], [[../themes/agentic-coding|Agentic Coding]]

## Coûts
\`topics: [finops-ia]\`

Le poste tokens explose et impose un suivi FinOps.

## Agents
\`topics: [agentic-coding]\`

Les agents autonomes écrivent le code de bout en bout.
`;

const GRAPH_MULTI = JSON.stringify({
  generated: '2026-01-01',
  nodes: [
    { id: 'theme:finops-ia', type: 'theme', label: 'FinOps IA' },
    { id: 'theme:agentic-coding', type: 'theme', label: 'Agentic Coding' },
    { id: 'origin:externe', type: 'origin', label: 'Externe' },
    { id: 'origin:interne', type: 'origin', label: 'Interne' },
  ],
  edges: [],
});

function multiState(): State {
  return {
    'wiki/themes/finops-ia.md': THEME,
    'wiki/themes/agentic-coding.md': THEME_AGENTIC,
    'wiki/origin/externe.md': ORIGIN_EXT,
    'wiki/origin/interne.md': ORIGIN_INT,
    'wiki/types.md': TYPES,
    'wiki/index.md': INDEX,
    'wiki/graph.json': GRAPH_MULTI,
    'wiki/_ingested.json': MANIFEST,
  };
}

const CFG_MULTI = { themeLabels: { 'finops-ia': 'FinOps IA', 'agentic-coding': 'Agentic Coding' } };

test('projectResource : multi-thèmes — chaque page thème n’a que le bullet de SA section', () => {
  const ops = projectResource({
    slug: 'multi',
    resourceContent: RESOURCE_MULTI,
    views: projectViews(multiState(), RESOURCE_MULTI, 'multi', CFG_MULTI),
    slugifyAuthor: slugify,
    typeLabel,
    today: TODAY,
  });

  const finops = byPath(ops, 'wiki/themes/finops-ia.md')!.content;
  const agentic = byPath(ops, 'wiki/themes/agentic-coding.md')!.content;

  // finops-ia : bloc ressource + bullet de la section « Coûts » SEULEMENT.
  // (l'ancre GitHub conserve les accents : headingSlug('Coûts') = 'coûts'.)
  assert.ok(finops.includes('## [[../resources/multi|Multi Thèmes]]'), 'finops : bloc ressource');
  assert.ok(finops.includes('#coûts|Coûts]] — Le poste tokens explose'), 'finops : bullet section Coûts');
  assert.ok(!finops.includes('#agents|Agents'), 'finops : PAS le bullet de la section Agents');
  assert.ok(finops.includes('resource_count: 1'), 'finops : resource_count 1');

  // agentic-coding : bloc ressource + bullet de la section « Agents » SEULEMENT.
  assert.ok(agentic.includes('## [[../resources/multi|Multi Thèmes]]'), 'agentic : bloc ressource');
  assert.ok(agentic.includes('#agents|Agents]] — Les agents autonomes'), 'agentic : bullet section Agents');
  assert.ok(!agentic.includes('#coûts|Coûts'), 'agentic : PAS le bullet de la section Coûts');
  assert.ok(agentic.includes('resource_count: 1'), 'agentic : resource_count 1');

  // Graphe : une arête belongs_to_theme + un nœud theme:<slug> par topic.
  const { nodes, edges } = graphSig(byPath(ops, 'wiki/graph.json')!.content);
  const R = 'resource:multi';
  for (const t of ['finops-ia', 'agentic-coding']) {
    assert.ok(nodes.includes(`theme:${t}`), `nœud theme:${t}`);
    assert.ok(edges.includes(`${R}|theme:${t}|belongs_to_theme|`), `arête belongs_to_theme ${t}`);
  }
});
