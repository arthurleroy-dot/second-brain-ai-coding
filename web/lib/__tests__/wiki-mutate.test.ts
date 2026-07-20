/**
 * Tests du moteur déterministe de mutation du wiki (fonctions pures).
 * Lancé par `npm --prefix web run test` (node:test + tsx, zéro dépendance ajoutée).
 * Fixtures inline, fidèles aux formats réels du wiki.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  headingSlug,
  splitFrontmatter,
  withFrontmatter,
  setScalar,
  bumpScalarInt,
  patchInlineArray,
  removeResourceBlock,
  removeTableRow,
  countResourceBlocks,
  countTableRows,
  parseGraph,
  serializeGraph,
  purgeCandidate,
  removeManifestKey,
  addChunkLink,
  addThemeToNav,
  applyEntityDecision,
  applyThemeDecision,
  deleteResource,
  type FileOp,
} from '../wiki-mutate';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const typeLabel = (t: string) => (t === 'article' ? 'Article' : t === 'report-pdf' ? 'Rapport PDF' : t);

const upserts = (ops: FileOp[]) => ops.filter((o): o is { path: string; content: string } => 'content' in o);
const deletes = (ops: FileOp[]) => ops.filter((o): o is { path: string; delete: true } => 'delete' in o);
const byPath = (ops: FileOp[], p: string) => upserts(ops).find((o) => o.path === p);

// ————————————————————————————————————————————————————————————————
// headingSlug — round-trip contre des ancres réelles

test('headingSlug reproduit les ancres GitHub (accents conservés)', () => {
  assert.equal(headingSlug('Anthropic : Boris Cherny et le code 100% IA'), 'anthropic--boris-cherny-et-le-code-100-ia');
  assert.equal(headingSlug('Ouverture : le paradoxe de Jevons appliqué aux tokens'), 'ouverture--le-paradoxe-de-jevons-appliqué-aux-tokens');
  assert.equal(headingSlug("What's Happening"), 'whats-happening');
});

// ————————————————————————————————————————————————————————————————
// Frontmatter

test('splitFrontmatter / withFrontmatter round-trip', () => {
  const content = '---\nslug: x\ntopics: [a]\n---\n\n# Titre\n\ncorps';
  const { fm, rest } = splitFrontmatter(content);
  assert.equal(fm, 'slug: x\ntopics: [a]');
  assert.equal(withFrontmatter(fm, rest), content);
});

test('patchInlineArray ajoute, préserve et reste idempotent', () => {
  assert.equal(patchInlineArray('topics: [finops-ia]', 'topics', 'agentic-coding'), 'topics: [finops-ia, agentic-coding]');
  assert.equal(patchInlineArray('topics: [finops-ia]', 'topics', 'finops-ia'), 'topics: [finops-ia]');
  assert.equal(patchInlineArray('topics: []', 'topics', 'x'), 'topics: [x]');
  // aliases quotés préservés verbatim
  assert.equal(
    patchInlineArray('aliases: ["n8n.io", "n8n workflow"]', 'aliases', 'Cursor', { quote: true }),
    'aliases: ["n8n.io", "n8n workflow", "Cursor"]',
  );
});

test('patchInlineArray insère entities après topics si absent', () => {
  const fm = 'slug: x\ntopics: [a]\nurl: "u"';
  assert.equal(patchInlineArray(fm, 'entities', 'n8n'), 'slug: x\ntopics: [a]\nentities: [n8n]\nurl: "u"');
});

test('bumpScalarInt / setScalar', () => {
  assert.equal(bumpScalarInt('resource_count: 8', 'resource_count', -1), 'resource_count: 7');
  assert.equal(bumpScalarInt('resource_count: 0', 'resource_count', -1), 'resource_count: 0');
  assert.equal(setScalar('last_updated: "2026-01-01"', 'last_updated', '"2026-07-10"'), 'last_updated: "2026-07-10"');
});

// ————————————————————————————————————————————————————————————————
// Blocs de vues dérivées

const THEME = `---
type: theme
slug: finops-ia
label: FinOps IA
resource_count: 3
last_updated: "2026-07-03"
---

## [[../resources/alpha|Alpha]]
\`2026 · article · externe — A\`

- [[../resources/alpha#s1|S1]] — take 1

---

## [[../resources/beta|Beta]]
\`2026 · article · externe — B\`

- [[../resources/beta#s2|S2]] — take 2

---

## [[../resources/gamma|Gamma]]
\`2026 · article · externe — C\`

- [[../resources/gamma#s3|S3]] — take 3
`;

test('removeResourceBlock retire le bloc du milieu (séparateur ---)', () => {
  const out = removeResourceBlock(THEME, '##', 'beta');
  assert.ok(!out.includes('resources/beta'));
  assert.ok(out.includes('resources/alpha'));
  assert.ok(out.includes('resources/gamma'));
  assert.equal(countResourceBlocks(out, '##'), 2);
});

test('removeResourceBlock retire le premier et le dernier bloc', () => {
  assert.equal(countResourceBlocks(removeResourceBlock(THEME, '##', 'alpha'), '##'), 2);
  const last = removeResourceBlock(THEME, '##', 'gamma');
  assert.ok(!last.includes('resources/gamma'));
  assert.equal(countResourceBlocks(last, '##'), 2);
});

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

### [[../resources/alpha|Alpha]]
\`2026 · article — A\`
- Ressource entière : contexte alpha.

### [[../resources/beta|Beta]]
\`2026 · report-pdf — B\`
- [[../resources/beta#s2|S2]] — contexte beta.
`;

test('removeResourceBlock niveau ### retire une mention', () => {
  const out = removeResourceBlock(ENTITY, '###', 'alpha');
  assert.ok(!out.includes('resources/alpha'));
  assert.ok(out.includes('resources/beta'));
  assert.ok(out.includes('## Mentions'));
  assert.equal(countResourceBlocks(out, '###'), 1);
});

const AUTHOR = `---
type: author
slug: mckinsey
label: McKinsey
resource_count: 2
---

| Ressource | Date | Type | Origin | Topics |
|-----------|------|------|--------|--------|
| [[../resources/alpha\\|Alpha]] | 2026-05 | report-pdf | externe | agentic-coding |
| [[../resources/beta\\|Beta]] | 2026-04 | report-pdf | externe | finops-ia |
`;

test('removeTableRow retire une ligne (pipe échappé) et garde le header', () => {
  const out = removeTableRow(AUTHOR, 'alpha');
  assert.ok(!out.includes('resources/alpha'));
  assert.ok(out.includes('resources/beta'));
  assert.ok(out.includes('| Ressource | Date |'));
  assert.equal(countTableRows(out), 1);
});

// ————————————————————————————————————————————————————————————————
// Graphe

const GRAPH = JSON.stringify({
  generated: '2026-07-08',
  nodes: [
    { id: 'resource:alpha', type: 'resource', label: 'Alpha', date: '2026' },
    { id: 'entity:claude-code', type: 'entity', entity_type: 'tool', label: 'Claude Code' },
    { id: 'author:a', type: 'author', label: 'A' },
    { id: 'type:article', type: 'source_type', label: 'Article' },
  ],
  edges: [
    { source: 'resource:alpha', target: 'author:a', relation: 'written_by' },
    { source: 'resource:alpha', target: 'entity:claude-code', relation: 'mentions' },
  ],
});

test('parseGraph + serializeGraph → JSON valide et stable', () => {
  const g = parseGraph(GRAPH);
  const out = serializeGraph(g);
  const reparsed = JSON.parse(out); // ne doit pas jeter
  assert.equal(reparsed.nodes.length, 4);
  assert.equal(reparsed.edges.length, 2);
  assert.ok(out.includes('{"id": "resource:alpha", "type": "resource"')); // style spacé
});

// ————————————————————————————————————————————————————————————————
// Liaison chunk / nav

test('addChunkLink insère une ligne entities sous le heading', () => {
  const body = '## Contexte\n`topics: [finops-ia]`\n\nprose\n\n## Autre\ntexte';
  const out = addChunkLink(body, 'contexte', 'entities', 'n8n');
  assert.ok(out.includes('`topics: [finops-ia]`\n`entities: [n8n]`'));
  // idempotent
  assert.equal(addChunkLink(out, 'contexte', 'entities', 'n8n'), out);
});

test('addThemeToNav complète le blockquote', () => {
  const body = '> Par [[../authors/a|A]] · [[../by-date/2026/2026|2026]] · Thèmes : [[../themes/finops-ia|FinOps IA]]\n\ncorps';
  const out = addThemeToNav(body, 'agentic-coding', 'Agentic Coding');
  assert.ok(out.includes('· [[../themes/agentic-coding|Agentic Coding]]'));
});

// ————————————————————————————————————————————————————————————————
// JSON purge

const CANDS = JSON.stringify({
  version: 1,
  generated: '2026-07-09',
  candidates: [
    { name: 'Cursor', normalized: 'cursor', status: 'create', decision: {} },
    { name: 'Windsurf', normalized: 'windsurf', status: 'pending', decision: {} },
  ],
});

test('purgeCandidate retire par normalized', () => {
  const out = JSON.parse(purgeCandidate(CANDS, 'cursor'));
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].normalized, 'windsurf');
});

test('removeManifestKey retire la clé source_file', () => {
  const manifest = JSON.stringify({ version: 1, files: { 'a.pdf': { slug: 'alpha' }, 'b.md': { slug: 'beta' } } });
  const out = JSON.parse(removeManifestKey(manifest, 'a.pdf'));
  assert.deepEqual(Object.keys(out.files), ['b.md']);
});

// ————————————————————————————————————————————————————————————————
// applyEntityDecision — create

test('applyEntityDecision (create) relie, crée la page et met à jour le graphe', () => {
  const resource = `---
slug: alpha
title: "Alpha"
author: "A"
date: "2026"
source_type: article
origin: externe
topics: [finops-ia]
url: "u"
source_file: "a.md"
needs_review: false
---

> Par [[../authors/a|A]]

## Contexte
\`topics: [finops-ia]\`

Cursor est cité ici.
`;
  const ops = applyEntityDecision({
    action: 'create',
    candidate: { name: 'Cursor', normalized: 'cursor', variants: ['Cursor'], seen_in: [{ resource: 'alpha', section: 'contexte', context: 'Cursor cité' }] },
    decision: { target_slug: null, entity_type: 'tool', slug: 'cursor' },
    resources: { alpha: resource },
    entityPage: null,
    graph: GRAPH,
    candidatesJson: CANDS,
    today: '2026-07-10',
  });

  // page entité créée
  const page = byPath(ops, 'wiki/entities/cursor.md');
  assert.ok(page, 'page entité créée');
  assert.ok(page!.content.includes('entity_type: tool'));
  assert.ok(page!.content.includes('### [[../resources/alpha|Alpha]]'));

  // ressource reliée au niveau chunk
  const res = byPath(ops, 'wiki/resources/alpha.md');
  assert.ok(res!.content.includes('`entities: [cursor]`'));

  // graphe : node + edge mentions
  const graph = JSON.parse(byPath(ops, 'wiki/graph.json')!.content);
  assert.ok(graph.nodes.some((n: any) => n.id === 'entity:cursor'));
  assert.ok(graph.edges.some((e: any) => e.source === 'resource:alpha' && e.target === 'entity:cursor' && e.relation === 'mentions'));

  // candidate purgée
  const cands = JSON.parse(byPath(ops, 'wiki/entities/_candidates.json')!.content);
  assert.ok(!cands.candidates.some((c: any) => c.normalized === 'cursor'));
});

test('applyEntityDecision (reject) ne touche que le fichier candidates', () => {
  const ops = applyEntityDecision({
    action: 'reject',
    candidate: { name: 'Cursor', normalized: 'cursor', variants: [], seen_in: [] },
    decision: { target_slug: null, entity_type: null, slug: null },
    resources: {},
    entityPage: null,
    graph: GRAPH,
    candidatesJson: CANDS,
    today: '2026-07-10',
  });
  assert.equal(ops.length, 1);
  assert.equal((ops[0] as any).path, 'wiki/entities/_candidates.json');
});

// ————————————————————————————————————————————————————————————————
// applyThemeDecision — merge_alias

test('applyThemeDecision (merge_alias) ajoute alias + relie + purge', () => {
  const resource = `---
slug: alpha
title: "Alpha"
author: "A"
date: "2026"
source_type: article
origin: externe
topics: []
---

> Par [[../authors/a|A]]

## Contexte

prose
`;
  const themePage = `---
type: theme
slug: finops-ia
label: FinOps IA
resource_count: 1
last_updated: "2026-01-01"
---

## [[../resources/beta|Beta]]
\`2026 · article · externe — B\`

- [[../resources/beta#x|X]] — t
`;
  const themeCands = JSON.stringify({ version: 1, candidates: [{ name: 'AI FinOps', normalized: 'ai finops', status: 'merge_alias', decision: {} }] });
  const ops = applyThemeDecision({
    action: 'merge_alias',
    candidate: { name: 'AI FinOps', normalized: 'ai finops', variants: ['AI FinOps'], seen_in: [{ resource: 'alpha', section: null, context: 'finops' }] },
    decision: { target_slug: 'finops-ia', slug: null },
    resources: { alpha: resource },
    themePage,
    graph: GRAPH,
    candidatesJson: themeCands,
    index: '---\ntheme_count: 6\n---\n\n## Thèmes (6)\n',
    today: '2026-07-10',
  });

  const theme = byPath(ops, 'wiki/themes/finops-ia.md');
  assert.ok(theme!.content.includes('aliases: ["AI FinOps"]'));
  assert.ok(theme!.content.includes('resource_count: 2'));
  const res = byPath(ops, 'wiki/resources/alpha.md');
  assert.ok(res!.content.includes('topics: [finops-ia]'));
  const graph = JSON.parse(byPath(ops, 'wiki/graph.json')!.content);
  assert.ok(graph.edges.some((e: any) => e.target === 'theme:finops-ia' && e.relation === 'belongs_to_theme'));
});

// ————————————————————————————————————————————————————————————————
// deleteResource — intégration

test('deleteResource retire partout et laisse un graphe valide', () => {
  const resource = `---
slug: alpha
title: "Alpha"
author: "A"
date: "2026-05"
source_type: report-pdf
origin: externe
topics: [finops-ia]
entities: [claude-code]
url: "u"
source_file: "a.pdf"
needs_review: false
---

> Par [[../authors/a|A]]

## Contexte
\`topics: [finops-ia]\`
\`entities: [claude-code]\`

prose
`;
  const theme = `---
type: theme
slug: finops-ia
label: FinOps IA
resource_count: 2
last_updated: "2026-07-03"
---

## [[../resources/alpha|Alpha]]
\`2026-05 · report-pdf · externe — A\`

- [[../resources/alpha#contexte|Contexte]] — t

---

## [[../resources/beta|Beta]]
\`2026 · article · externe — B\`

- [[../resources/beta#x|X]] — t
`;
  const author = `---
type: author
slug: a
label: A
resource_count: 1
---

| Ressource | Date | Type | Origin | Topics |
|-----------|------|------|--------|--------|
| [[../resources/alpha\\|Alpha]] | 2026-05 | report-pdf | externe | finops-ia |
`;
  const origin = `---
type: origin
slug: externe
label: Externe
resource_count: 2
last_updated: "2026-07-09"
---

## [[../resources/alpha|Alpha]]
\`2026-05 · report-pdf · A\`

## [[../resources/beta|Beta]]
\`2026 · article · B\`
`;
  const month = `---
type: by-date
period: "2026-05"
resource_count: 1
---

| Ressource | Auteur | Type | Origin | Topics |
|-----------|--------|------|--------|--------|
| [[../../../resources/alpha\\|Alpha]] | A | report-pdf | externe | finops-ia |
`;
  const year = `---
type: by-date
period: "2026"
resource_count: 2
---

## Date précise inconnue (année seulement)

| Ressource | Auteur | Type | Origin | Topics |
|-----------|--------|------|--------|--------|
| [[../../resources/gamma\\|Gamma]] | G | article | externe | finops-ia |

## Par mois

- [[by-date/2026/2026-05/2026-05|2026-05]] — 1 ressource (A)
`;
  const entity = ENTITY.replace('resources/beta', 'resources/gamma'); // alpha + gamma
  const graph = JSON.stringify({
    generated: '2026-07-08',
    nodes: [
      { id: 'resource:alpha', type: 'resource', label: 'Alpha', date: '2026-05' },
      { id: 'resource:beta', type: 'resource', label: 'Beta', date: '2026' },
      { id: 'author:a', type: 'author', label: 'A' },
      { id: 'author:b', type: 'author', label: 'B' },
      { id: 'type:report-pdf', type: 'source_type', label: 'Rapport PDF' },
      { id: 'type:article', type: 'source_type', label: 'Article' },
      { id: 'theme:finops-ia', type: 'theme', label: 'FinOps IA' },
      { id: 'entity:claude-code', type: 'entity', entity_type: 'tool', label: 'Claude Code' },
      { id: 'date:2026', type: 'date', label: '2026', granularity: 'year' },
      { id: 'date:2026-05', type: 'date', label: '2026-05', granularity: 'month', year: '2026' },
    ],
    edges: [
      { source: 'resource:alpha', target: 'author:a', relation: 'written_by' },
      { source: 'resource:alpha', target: 'type:report-pdf', relation: 'has_type' },
      { source: 'resource:alpha', target: 'origin:externe', relation: 'has_origin' },
      { source: 'resource:alpha', target: 'theme:finops-ia', relation: 'belongs_to_theme' },
      { source: 'resource:alpha', target: 'entity:claude-code', relation: 'mentions', sections: ['contexte'] },
      { source: 'resource:alpha', target: 'date:2026-05', relation: 'published_on' },
      { source: 'resource:beta', target: 'author:b', relation: 'written_by' },
      { source: 'resource:beta', target: 'type:article', relation: 'has_type' },
      { source: 'date:2026-05', target: 'date:2026', relation: 'year_of' },
    ],
  });
  const manifest = JSON.stringify({ version: 1, files: { 'a.pdf': { slug: 'alpha' }, 'b.md': { slug: 'beta' } } });
  const index = `---
type: index
resource_count: 2
theme_count: 1
author_count: 2
---

## Thèmes (1)

- [[themes/finops-ia|FinOps IA]] — 2 ressources · x

## Auteurs (2)

- [[authors/a|A]] — 1 ressource · x
- [[authors/b|B]] — 1 ressource · x

## Ressources (2)

### Rapport PDF (1)

- [[resources/alpha|Alpha]] — A · 2026-05 · x

### Articles (1)

- [[resources/beta|Beta]] — B · 2026 · x

## Origine (2)

- [[origin/externe|Externe]] — 2 ressources
`;
  const types = `---
type: index
---

## report-pdf (1 ressources)

| Ressource | Auteur | Date | Origin |
|-----------|--------|------|--------|
| [[resources/alpha\\|Alpha]] | A | 2026-05 | externe |

## article (1 ressources)

| Ressource | Auteur | Date | Origin |
|-----------|--------|------|--------|
| [[resources/beta\\|Beta]] | B | 2026 | externe |
`;

  const ops = deleteResource({
    slug: 'alpha',
    resourceContent: resource,
    slugifyAuthor: slugify,
    typeLabel,
    views: {
      themes: { 'finops-ia': theme },
      authorPath: 'wiki/authors/a.md',
      authorContent: author,
      originPath: 'wiki/origin/externe.md',
      originContent: origin,
      entities: { 'claude-code': entity },
      yearPath: 'wiki/by-date/2026/2026.md',
      yearContent: year,
      monthPath: 'wiki/by-date/2026/2026-05/2026-05.md',
      monthContent: month,
      graph,
      manifest,
      index,
      types,
      metaExists: true,
    },
  });

  const del = deletes(ops).map((o) => o.path);
  // ressource + raw + sidecar supprimés
  assert.ok(del.includes('wiki/resources/alpha.md'));
  assert.ok(del.includes('raw/a.pdf'));
  assert.ok(del.includes('raw/a.pdf.meta.md'));
  // auteur orphelin (1 seule ressource) → page supprimée
  assert.ok(del.includes('wiki/authors/a.md'));
  // mois orphelin → page supprimée
  assert.ok(del.includes('wiki/by-date/2026/2026-05/2026-05.md'));

  // thème : bloc alpha retiré, resource_count recalculé à 1, beta conservé
  const th = byPath(ops, 'wiki/themes/finops-ia.md')!;
  assert.ok(!th.content.includes('resources/alpha'));
  assert.ok(th.content.includes('resources/beta'));
  assert.ok(th.content.includes('resource_count: 1'));

  // entité : mention alpha retirée, gamma conservée, page NON supprimée
  const en = byPath(ops, 'wiki/entities/claude-code.md')!;
  assert.ok(!en.content.includes('resources/alpha'));
  assert.ok(en.content.includes('resources/gamma'));

  // graphe valide : resource node + edges retirés ; author:a + type + date:2026-05 orphelins retirés ; année conservée
  const g = JSON.parse(byPath(ops, 'wiki/graph.json')!.content);
  const nodeIds = g.nodes.map((n: any) => n.id);
  assert.ok(!nodeIds.includes('resource:alpha'));
  assert.ok(!nodeIds.includes('author:a'), 'auteur orphelin retiré');
  assert.ok(!nodeIds.includes('type:report-pdf'), 'type orphelin retiré');
  assert.ok(!nodeIds.includes('date:2026-05'), 'mois orphelin retiré');
  assert.ok(nodeIds.includes('date:2026'), 'année conservée');
  assert.ok(nodeIds.includes('theme:finops-ia'), 'thème (registre) conservé');
  assert.ok(nodeIds.includes('entity:claude-code'), 'entité (registre) conservée');
  assert.ok(!g.edges.some((e: any) => e.source === 'resource:alpha' || e.target === 'resource:alpha'));
  assert.ok(!g.edges.some((e: any) => e.source === 'date:2026-05'), 'year_of du mois orphelin retiré');

  // manifeste : clé retirée
  const mani = JSON.parse(byPath(ops, 'wiki/_ingested.json')!.content);
  assert.deepEqual(Object.keys(mani.files), ['b.md']);

  // index : bullet alpha + auteur A retirés, Ressources (2)→(1), Auteurs (2)→(1)
  const idx = byPath(ops, 'wiki/index.md')!;
  assert.ok(!idx.content.includes('resources/alpha|'));
  assert.ok(!idx.content.includes('authors/a|'), 'bullet auteur orphelin retiré');
  assert.ok(idx.content.includes('## Ressources (1)'));
  assert.ok(idx.content.includes('## Auteurs (1)'));

  // by-date année : bullet du mois orphelin retiré, resource_count décrémenté
  const yr = byPath(ops, 'wiki/by-date/2026/2026.md')!;
  assert.ok(!yr.content.includes('2026-05/2026-05'), 'bullet mois orphelin retiré de l’année');
});
