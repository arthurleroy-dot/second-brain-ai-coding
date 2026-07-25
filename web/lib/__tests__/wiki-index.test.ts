/**
 * Tests du moteur de RÉGÉNÉRATION des index dérivés (`wiki-index.ts`) — fonctions pures.
 * Lancé par `npm --prefix web run test` (node:test + tsx). Assertions sur CHAÎNES EXACTES :
 * format « pixel-exact » de `index.md` + pages `by-date/`, et robustesse du salvage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, type FileOp } from '../wiki-mutate';
import {
  buildIndex,
  buildByDate,
  salvageDigests,
  expectedByDatePaths,
  type ResourceCard,
  type IndexInput,
} from '../wiki-index';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// typeLabel façon `wikiTypeLabel` : DEUX source_types bruts (`report-pdf` ET `report_pdf`)
// tombent sur le MÊME libellé canonique → teste le dédoublonnage de sous-sections.
const typeLabel = (st: string): string => {
  const m: Record<string, string> = {
    article: 'Article',
    'report-pdf': 'Rapport PDF',
    report_pdf: 'Rapport PDF',
    'personal-notes': 'Note perso',
    'meeting-notes': 'Réunion',
  };
  return m[st] ?? 'Inconnu';
};
const typeOrder = ['Article', 'Rapport PDF', 'Tweet', 'Réunion', 'Interview', 'Présentation', 'Transcript', 'Note perso', 'Inconnu'];

const card = (c: Partial<ResourceCard> & { slug: string }): ResourceCard => ({
  title: c.slug,
  author: '',
  date: '',
  source_type: 'article',
  origin: '',
  topics: [],
  entities: [],
  ...c,
});

const RESOURCES: ResourceCard[] = [
  card({ slug: 'a-year-only', title: 'A Year Only', author: 'McKinsey', date: '2026', source_type: 'report-pdf', origin: 'externe', topics: ['finops-ia'], entities: ['claude-code'] }),
  card({ slug: 'b-month', title: 'B Month', author: 'McKinsey', date: '2026-04', source_type: 'report_pdf', origin: 'externe', topics: ['finops-ia', 'agentic-coding'], entities: ['claude-code'] }),
  card({ slug: 'c-note', title: 'C Note', author: '', date: '', source_type: 'personal-notes', origin: 'interne', topics: ['finops-ia'], entities: [] }),
  card({ slug: 'd-article', title: 'D Article', author: 'CNBC', date: '2026-06', source_type: 'article', origin: 'externe', topics: [], entities: ['n8n'] }),
];

const ENTITIES = [
  { slug: 'claude-code', label: 'Claude Code' },
  { slug: 'n8n', label: 'n8n' },
  { slug: 'databricks', label: 'Databricks' }, // 0 ressource → énumérée quand même
];
const THEMES = [
  { slug: 'finops-ia', label: 'FinOps IA' },
  { slug: 'agentic-coding', label: 'Agentic Coding' },
  { slug: 'empty-theme', label: 'Empty Theme' }, // 0 ressource → énuméré quand même
];

const baseInput = (over: Partial<IndexInput> = {}): IndexInput => ({
  resources: RESOURCES,
  entities: ENTITIES,
  themes: THEMES,
  today: '2026-07-25',
  typeLabel,
  slugifyAuthor: slugify,
  typeOrder,
  resourceDigests: {},
  authorDigests: {},
  ...over,
});

const linesOf = (s: string) => s.split('\n');

// ————————————————————————————————————————————————————————————————
// buildIndex

test('buildIndex : frontmatter — compteurs exacts (R/T/A/E) + blank après ---', () => {
  const idx = buildIndex(baseInput());
  const { fm } = splitFrontmatter(idx);
  assert.equal(
    fm,
    ['type: index', 'last_updated: "2026-07-25"', 'resource_count: 4', 'theme_count: 3', 'author_count: 2', 'entity_count: 3'].join('\n'),
  );
  // Ligne vide entre le frontmatter fermant et « ## Thèmes ».
  assert.match(idx, /^---\ntype: index[\s\S]*?\n---\n\n## Thèmes \(3\)\n\n- /);
});

test('buildIndex : Thèmes — 1 bullet/registre, tri c desc, pluriel, 0 ressource', () => {
  const idx = buildIndex(baseInput());
  const L = linesOf(idx);
  const i = L.indexOf('## Thèmes (3)');
  assert.ok(i !== -1);
  assert.equal(L[i + 1], '');
  assert.equal(L[i + 2], '- [[themes/finops-ia|FinOps IA]] — 3 ressources');
  assert.equal(L[i + 3], '- [[themes/agentic-coding|Agentic Coding]] — 1 ressource');
  assert.equal(L[i + 4], '- [[themes/empty-theme|Empty Theme]] — 0 ressource');
});

test('buildIndex : Entités — FIX CENTRAL, TOUTES les entités du registre, slug émis tel quel', () => {
  const idx = buildIndex(baseInput());
  // 3 bullets = 3 entités du registre (pas de plafond).
  assert.equal((idx.match(/^- \[\[entities\//gm) ?? []).length, 3);
  assert.ok(idx.includes('- [[entities/claude-code|Claude Code]] — 2 ressources'));
  assert.ok(idx.includes('- [[entities/n8n|n8n]] — 1 ressource')); // n8n, PAS n9n
  assert.ok(idx.includes('- [[entities/databricks|Databricks]] — 0 ressource'));
  assert.ok(!idx.includes('n9n'));
});

test('buildIndex : Auteurs — count · dates distinctes triées · digest (salvage)', () => {
  const idx = buildIndex(baseInput({ authorDigests: { mckinsey: 'factory agentique ; 2 shifts' } }));
  assert.ok(idx.includes('## Auteurs (2)'));
  // McKinsey (2 ressources, dates 2026 & 2026-04) trié avant CNBC (1) ; digest salvé.
  assert.ok(idx.includes('- [[authors/mckinsey|McKinsey]] — 2 ressources · 2026 & 2026-04 · factory agentique ; 2 shifts'));
  assert.ok(idx.includes('- [[authors/cnbc|CNBC]] — 1 ressource · 2026-06'));
});

test('buildIndex : Ressources — dédoublonnage de type + ordre ALL_TYPES + date desc + digest', () => {
  const idx = buildIndex(baseInput({ resourceDigests: { 'a-year-only': 'token invisible' } }));
  // report-pdf ET report_pdf → UNE seule sous-section « Rapport PDF (2) ».
  assert.equal((idx.match(/^### Rapport PDF \(/gm) ?? []).length, 1);
  assert.ok(idx.includes('### Rapport PDF (2)'));
  assert.ok(idx.includes('### Article (1)'));
  assert.ok(idx.includes('### Note perso (1)'));
  // Ordre des sous-sections : Article < Rapport PDF < Note perso (ALL_TYPES).
  assert.ok(idx.indexOf('### Article (1)') < idx.indexOf('### Rapport PDF (2)'));
  assert.ok(idx.indexOf('### Rapport PDF (2)') < idx.indexOf('### Note perso (1)'));
  // Dans Rapport PDF : b-month (2026-04) AVANT a-year-only (2026 ⚠), digest de a.
  assert.ok(idx.includes('- [[resources/b-month|B Month]] — McKinsey · 2026-04'));
  assert.ok(idx.includes('- [[resources/a-year-only|A Year Only]] — McKinsey · 2026 ⚠ · token invisible'));
  assert.ok(idx.indexOf('|B Month]]') < idx.indexOf('|A Year Only]]'));
});

test('buildIndex : ressource sans date ni auteur → bullet « — » (parts vides)', () => {
  const idx = buildIndex(baseInput());
  const L = linesOf(idx);
  assert.ok(L.includes('- [[resources/c-note|C Note]] — '));
});

test('buildIndex : Index par date — 1 an, chemin toujours <Y>/<Y>, (dont M …), aucune corruption', () => {
  const idx = buildIndex(baseInput());
  assert.ok(idx.includes('## Index par date'));
  assert.ok(idx.includes('- [[by-date/2026/2026|2026]] — 3 ressources (dont 1 date exacte inconnue)'));
  assert.ok(!/by-date\/2027/.test(idx));
  assert.ok(!/by-date\/2025\/2026/.test(idx));
});

test('buildIndex : Index par type statique + Origine triée', () => {
  const idx = buildIndex(baseInput());
  assert.match(idx, /## Index par type\n\n→ \[\[types\]\]/);
  assert.ok(idx.includes('## Origine (2)'));
  assert.ok(idx.includes('- [[origin/externe|Externe]] — 3 ressources'));
  assert.ok(idx.includes('- [[origin/interne|Interne]] — 1 ressource'));
});

test('buildIndex : exactement 4 séparateurs --- (Thèmes/Entités/Auteurs/Ressources)', () => {
  const idx = buildIndex(baseInput());
  // Séparateurs du CORPS (hors les 2 délimiteurs `---` du frontmatter).
  const { rest } = splitFrontmatter(idx);
  const seps = linesOf(rest).filter((l) => l === '---').length;
  assert.equal(seps, 4);
});

// ————————————————————————————————————————————————————————————————
// buildByDate

test('buildByDate : page mois entière (frontmatter + table, pipe échappé, source_type brut)', () => {
  const ops = buildByDate(RESOURCES);
  const month = upsert(ops, 'wiki/by-date/2026/2026-04/2026-04.md');
  assert.equal(
    month,
    '---\ntype: by-date\nperiod: "2026-04"\nresource_count: 1\n---\n\n' +
      '| Ressource | Auteur | Type | Origin | Topics |\n|-----------|--------|------|--------|--------|\n' +
      '| [[../../../resources/b-month\\|B Month]] | McKinsey | report_pdf | externe | finops-ia, agentic-coding |\n',
  );
});

test('buildByDate : page année — table « année seulement » + « Par mois » triés asc', () => {
  const ops = buildByDate(RESOURCES);
  const year = upsert(ops, 'wiki/by-date/2026/2026.md');
  assert.ok(year.includes('period: "2026"'));
  assert.ok(year.includes('resource_count: 3')); // a + b + d (c-note sans date, ignorée)
  assert.ok(year.includes('## Date précise inconnue (année seulement)'));
  // a-year-only dans la table année (pipe échappé, source_type brut report-pdf).
  assert.ok(year.includes('| [[../../resources/a-year-only\\|A Year Only]] | McKinsey | report-pdf | externe | finops-ia |'));
  assert.ok(year.includes('## Par mois'));
  const iApril = year.indexOf('2026-04/2026-04|2026-04');
  const iJune = year.indexOf('2026-06/2026-06|2026-06');
  assert.ok(iApril !== -1 && iJune !== -1 && iApril < iJune); // tri asc
  assert.ok(year.includes('- [[by-date/2026/2026-04/2026-04|2026-04]] — 1 ressource (McKinsey)'));
  assert.ok(year.includes('- [[by-date/2026/2026-06/2026-06|2026-06]] — 1 ressource (CNBC)'));
});

test('buildByDate : ressource sans date ignorée ; expectedByDatePaths cohérent', () => {
  const ops = buildByDate(RESOURCES);
  const paths = ops.map((o) => o.path).sort();
  assert.deepEqual(paths, [
    'wiki/by-date/2026/2026-04/2026-04.md',
    'wiki/by-date/2026/2026-06/2026-06.md',
    'wiki/by-date/2026/2026.md',
  ]);
  const expected = expectedByDatePaths(RESOURCES);
  assert.ok(expected.has('wiki/by-date/2026/2026.md'));
  assert.ok(expected.has('wiki/by-date/2026/2026-04/2026-04.md'));
  assert.ok(!expected.has('wiki/by-date/2027/2026.md'));
});

// ————————————————————————————————————————————————————————————————
// salvageDigests

test('salvageDigests : ressource (strip auteur + date±⚠) et auteur (strip count + dates)', () => {
  const prior = [
    '## Ressources (2)',
    '',
    '### Rapport PDF (1)',
    '',
    '- [[resources/a-year-only|A Year Only]] — McKinsey · 2026 ⚠ · factory agentique ; 2 shifts',
    '- [[resources/d-article|D Article]] — CNBC · 2026-06', // pas de digest → omis
    '- [[resources/c-note|C Note]] — ', // vide → omis
    '',
    '## Auteurs (2)',
    '',
    '- [[authors/mckinsey|McKinsey]] — 2 ressources · 2026 & 2026-04 · factory agentique',
    '- [[authors/cnbc|CNBC]] — 1 ressource · 2026-06', // pas de digest → omis
  ].join('\n');
  const { resourceDigests, authorDigests } = salvageDigests(prior, RESOURCES);
  assert.equal(resourceDigests['a-year-only'], 'factory agentique ; 2 shifts');
  assert.ok(!('d-article' in resourceDigests));
  assert.ok(!('c-note' in resourceDigests));
  assert.equal(authorDigests['mckinsey'], 'factory agentique');
  assert.ok(!('cnbc' in authorDigests));
});

test('salvageDigests : round-trip — salvage(buildIndex) rend les mêmes digests (idempotence)', () => {
  const resourceDigests = { 'a-year-only': 'token invisible ; ex 2' };
  const authorDigests = { mckinsey: 'factory agentique ; 3 enablers' };
  const idx = buildIndex(baseInput({ resourceDigests, authorDigests }));
  const salvaged = salvageDigests(idx, RESOURCES);
  assert.equal(salvaged.resourceDigests['a-year-only'], 'token invisible ; ex 2');
  assert.equal(salvaged.authorDigests['mckinsey'], 'factory agentique ; 3 enablers');
});

// ————————————————————————————————————————————————————————————————
// helpers de test

function upsert(ops: FileOp[], path: string): string {
  const op = ops.find((o) => o.path === path);
  assert.ok(op && 'content' in op, `op absente pour ${path}`);
  return (op as { path: string; content: string }).content;
}
