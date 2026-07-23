/**
 * Vérificateur déterministe du wiki — le « filet » contre les liens ratés.
 *
 * Balaye les ressources canoniques et le registre d'entités et signale, sans rien
 * modifier, les incohérences qu'un moteur d'ingestion (LLM ou TypeScript) a pu
 * laisser :
 *   - missed-link        : entité connue citée dans la prose mais non reliée
 *   - unknown-entity     : ressource reliée à un slug d'entité absent du registre
 *   - duplicate-entity   : deux entités partagent une même forme (label/alias)
 *   - candidate-collision: une candidate correspond déjà à une entité existante
 *   - graph-missing-node : node manquant (entity:/origin:/theme:/author:/type:/date:<slug>) dans graph.json
 *   - graph-missing-edge : lien manquant (mentions/has_origin/belongs_to_theme/written_by/has_type/published_on)
 *   - graph-orphan-node  : node resource:<slug> sans fichier ressource (suppression incomplète)
 *   - graph-orphan-edge  : arête référençant une ressource inexistante
 *   - graph-unlabeled-node : node entity:/theme:/author:/type:/origin: sans `label` (nœud nu)
 *   - invalid-origin     : ressource dont l'origin est hors {interne, externe, ""}
 *   - origin-page-missing: page origin/interne.md ou origin/externe.md absente
 *   - manifest-missing   : ressource dont le source_file n'est pas dans le manifeste
 *   - manifest-orphan    : entrée _ingested.json pointant une ressource supprimée
 *   - duplicate-theme        : deux thèmes partagent une même forme (label/alias)
 *   - unknown-theme          : ressource reliée à un slug de thème absent du registre
 *   - missed-theme-link      : thème connu cité dans la prose mais absent des topics
 *   - theme-candidate-collision : un thème candidat correspond déjà à un thème existant
 *
 * Autonome (aucun import `@/…`) pour tourner sous `tsx` en CI sans résolution
 * d'alias. Sortie lisible + `--json`. `--strict` → code de sortie 1 si un problème.
 *
 * Usage : tsx scripts/wiki-verify.ts [--strict] [--json]
 */
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

const WIKI_ROOT = process.env.WIKI_ROOT ?? path.resolve(process.cwd(), '..', 'wiki');

type Severity = 'error' | 'warn';
interface Issue {
  category: string;
  severity: Severity;
  message: string;
}

/** Minuscules, sans accents, ponctuation → espace, espaces compactés. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Minuscules, sans accents, non-alphanum → tiret (slug d'auteur, etc.). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Vrai si `form` (déjà normalisée) apparaît comme « mot » dans `haystack` normalisé. */
function mentions(haystackNorm: string, form: string): boolean {
  if (form.length < 2) return false;
  const re = new RegExp(`(^| )${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  return re.test(haystackNorm);
}

/** Nombre d'occurrences non chevauchantes de `form` (séquence de tokens) dans le
 *  texte normalisé. Sert au seuil de récurrence des thèmes (cf. missed-theme-link). */
function countMentions(haystackNorm: string, form: string): number {
  if (form.length < 2) return 0;
  const hay = haystackNorm.split(' ');
  const need = form.split(' ');
  let count = 0;
  for (let i = 0; i + need.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < need.length; j++)
      if (hay[i + j] !== need[j]) {
        ok = false;
        break;
      }
    if (ok) {
      count++;
      i += need.length - 1;
    }
  }
  return count;
}

/** Retire frontmatter déjà géré + lignes d'annotation chunk + blockquote de nav. */
function proseOnly(body: string): string {
  return body
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^`(topics|entities):\s*\[[^\]]*\]`$/.test(t)) return false;
      if (/^>\s*Par\s+/i.test(t)) return false;
      if (/^>\s*Th[èe]mes\s*:/i.test(t)) return false; // nav dégénérée (note sans auteur/date)
      return true;
    })
    .join('\n');
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

/** Slugs d'entités reliés à une ressource (frontmatter `entities:` ∪ chunks). */
function chunkEntities(body: string): string[] {
  const out: string[] = [];
  const re = /^`entities:\s*\[([^\]]*)\]`\s*$/;
  for (const line of body.split('\n')) {
    const m = line.trim().match(re);
    if (m) out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

/** Slugs de thèmes reliés en chunk (`topics: [...]` sous un heading). */
function chunkTopics(body: string): string[] {
  const out: string[] = [];
  const re = /^`topics:\s*\[([^\]]*)\]`\s*$/;
  for (const line of body.split('\n')) {
    const m = line.trim().match(re);
    if (m) out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

async function readDir(rel: string): Promise<string[]> {
  try {
    return await fs.readdir(path.join(WIKI_ROOT, rel));
  } catch {
    return [];
  }
}
async function readFileSafe(rel: string): Promise<string> {
  try {
    return await fs.readFile(path.join(WIKI_ROOT, rel), 'utf-8');
  } catch {
    return '';
  }
}

interface Entity {
  slug: string;
  label: string;
  entity_type: string;
  aliases: string[];
}
interface Theme {
  slug: string;
  label: string;
  aliases: string[];
}
interface Resource {
  slug: string;
  source_file: string | null;
  origin: string; // 'interne' | 'externe' | '' (inconnu)
  author: string | null;
  date: string | null;
  sourceType: string | null;
  linked: string[]; // slugs d'entités reliés
  linkedThemes: string[]; // slugs de thèmes reliés (topics frontmatter ∪ chunks)
  feThemes: string[]; // topics du FRONTMATTER seul (= source des arêtes belongs_to_theme)
  proseNorm: string;
}

async function main() {
  const strict = process.argv.includes('--strict');
  const asJson = process.argv.includes('--json');
  const issues: Issue[] = [];
  const add = (category: string, severity: Severity, message: string) =>
    issues.push({ category, severity, message });

  // --- Registre d'entités ---
  const entities: Entity[] = [];
  for (const file of await readDir('entities')) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const { data } = matter(await readFileSafe(`entities/${file}`));
    const slug = String(data.slug ?? path.basename(file, '.md')).trim();
    entities.push({
      slug,
      label: String(data.label ?? slug).trim(),
      entity_type: String(data.entity_type ?? 'entity').trim(),
      aliases: arr(data.aliases),
    });
  }
  const registrySlugs = new Set(entities.map((e) => e.slug));
  const surfaceForms = (e: Entity) => [e.label, ...e.aliases].map(normalize).filter(Boolean);

  // duplicate-entity : une même forme normalisée pour deux slugs distincts.
  const formToSlugs = new Map<string, Set<string>>();
  for (const e of entities)
    for (const f of surfaceForms(e)) {
      if (!formToSlugs.has(f)) formToSlugs.set(f, new Set());
      formToSlugs.get(f)!.add(e.slug);
    }
  for (const [form, slugs] of formToSlugs)
    if (slugs.size > 1)
      add('duplicate-entity', 'error', `forme « ${form} » partagée par ${[...slugs].join(', ')}`);

  // --- Registre de thèmes ---
  const themes: Theme[] = [];
  for (const file of await readDir('themes')) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const { data } = matter(await readFileSafe(`themes/${file}`));
    const slug = String(data.slug ?? path.basename(file, '.md')).trim();
    themes.push({
      slug,
      label: String(data.label ?? slug).trim(),
      aliases: arr(data.aliases),
    });
  }
  const themeSlugs = new Set(themes.map((t) => t.slug));
  const themeForms = (t: Theme) => [t.label, ...t.aliases].map(normalize).filter(Boolean);

  // duplicate-theme : une même forme normalisée pour deux slugs de thèmes distincts.
  const themeFormToSlugs = new Map<string, Set<string>>();
  for (const t of themes)
    for (const f of themeForms(t)) {
      if (!themeFormToSlugs.has(f)) themeFormToSlugs.set(f, new Set());
      themeFormToSlugs.get(f)!.add(t.slug);
    }
  for (const [form, slugs] of themeFormToSlugs)
    if (slugs.size > 1)
      add('duplicate-theme', 'error', `forme « ${form} » partagée par ${[...slugs].join(', ')}`);

  // --- Ressources ---
  const resources: Resource[] = [];
  for (const file of await readDir('resources')) {
    if (!file.endsWith('.md')) continue;
    const raw = await readFileSafe(`resources/${file}`);
    if (!raw.trim()) continue;
    const { data, content } = matter(raw);
    const slug = String(data.slug ?? path.basename(file, '.md')).trim();
    const linked = [...new Set([...arr(data.entities), ...chunkEntities(content)])];
    const linkedThemes = [...new Set([...arr(data.topics), ...chunkTopics(content)])];
    resources.push({
      slug,
      source_file: data.source_file ? String(data.source_file) : null,
      origin: String(data.origin ?? '').trim(),
      author: data.author ? String(data.author).trim() : null,
      date: data.date ? String(data.date).trim() : null,
      sourceType: data.source_type ? String(data.source_type).trim() : null,
      linked,
      linkedThemes,
      feThemes: arr(data.topics),
      proseNorm: normalize(proseOnly(content)),
    });
  }

  // --- Origine (interne/externe) ---
  // (a) valeur d'origin bornée à l'enum ; (b) les DEUX pages de valeur existent
  // toujours (nœuds Obsidian distincts, cf. wiki-spec.md §3/§5).
  const ORIGIN_VALUES = new Set(['interne', 'externe']);
  for (const r of resources)
    if (r.origin && !ORIGIN_VALUES.has(r.origin))
      add('invalid-origin', 'error', `${r.slug} : origin « ${r.origin} » hors {interne, externe, ""}`);
  for (const v of ['interne', 'externe'])
    if (!(await readFileSafe(`origin/${v}.md`)).trim())
      add(
        'origin-page-missing',
        'error',
        `page origin/${v}.md absente (les deux origines doivent toujours exister)`,
      );

  // missed-link + unknown-entity
  for (const r of resources) {
    const linkedSet = new Set(r.linked);
    for (const e of entities) {
      const hit = surfaceForms(e).some((f) => mentions(r.proseNorm, f));
      if (hit && !linkedSet.has(e.slug))
        add(
          'missed-link',
          'warn',
          `« ${e.label} » cité dans ${r.slug} mais non relié (entities:[…${e.slug}…] manquant)`,
        );
    }
    for (const slug of r.linked)
      if (!registrySlugs.has(slug))
        add('unknown-entity', 'error', `${r.slug} relie un slug inconnu du registre : ${slug}`);
  }

  // missed-theme-link + unknown-theme. Un thème est une CLASSIFICATION de sujet
  // (pas une mention littérale comme une entité) : une occurrence isolée (ex. un
  // token dans une citation) ne prouve pas que la ressource porte sur ce thème.
  // On exige donc une récurrence (≥ 2 occurrences d'une forme) avant de signaler.
  const THEME_MENTION_THRESHOLD = 2;
  for (const r of resources) {
    const themeSet = new Set(r.linkedThemes);
    for (const t of themes) {
      const occ = themeForms(t).reduce((n, f) => n + countMentions(r.proseNorm, f), 0);
      if (occ >= THEME_MENTION_THRESHOLD && !themeSet.has(t.slug))
        add(
          'missed-theme-link',
          'warn',
          `« ${t.label} » cité ${occ}× dans ${r.slug} mais absent des topics (topics:[…${t.slug}…] manquant)`,
        );
    }
    for (const slug of r.linkedThemes)
      if (!themeSlugs.has(slug))
        add('unknown-theme', 'error', `${r.slug} relie un thème inconnu du registre : ${slug}`);
  }

  // --- Candidates ---
  const candDoc = await readFileSafe('entities/_candidates.json');
  if (candDoc.trim()) {
    let parsed: any;
    try {
      parsed = JSON.parse(candDoc);
    } catch {
      add('candidates-file', 'error', '_candidates.json illisible (JSON invalide)');
    }
    const cands: any[] = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    // formes normalisées de toutes les entités, pour la détection de collision.
    const allForms = new Set<string>();
    for (const e of entities) for (const f of surfaceForms(e)) allForms.add(f);
    for (const c of cands) {
      if (c?.status && c.status !== 'pending') continue; // déjà arbitrée
      const forms = [c?.name, ...(Array.isArray(c?.variants) ? c.variants : [])]
        .map((x: any) => normalize(String(x ?? '')))
        .filter(Boolean);
      if (forms.some((f) => allForms.has(f)))
        add(
          'candidate-collision',
          'error',
          `candidate « ${c?.name} » correspond déjà à une entité — à relier/fusionner, pas laisser en attente`,
        );
    }
  }

  // --- Thèmes candidats ---
  const themeCandDoc = await readFileSafe('themes/_candidates.json');
  if (themeCandDoc.trim()) {
    let parsed: any;
    try {
      parsed = JSON.parse(themeCandDoc);
    } catch {
      add('theme-candidates-file', 'error', 'themes/_candidates.json illisible (JSON invalide)');
    }
    const cands: any[] = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const allThemeForms = new Set<string>();
    for (const t of themes) for (const f of themeForms(t)) allThemeForms.add(f);
    for (const c of cands) {
      if (c?.status && c.status !== 'pending') continue; // déjà arbitrée
      const forms = [c?.name, ...(Array.isArray(c?.variants) ? c.variants : [])]
        .map((x: any) => normalize(String(x ?? '')))
        .filter(Boolean);
      if (forms.some((f) => allThemeForms.has(f)))
        add(
          'theme-candidate-collision',
          'error',
          `thème candidat « ${c?.name} » correspond déjà à un thème — à relier/fusionner, pas laisser en attente`,
        );
    }
  }

  // --- Graphe + manifeste ---
  let graph: any = null;
  try {
    graph = JSON.parse(await readFileSafe('graph.json'));
  } catch {
    add('graph-file', 'error', 'graph.json illisible (JSON invalide)');
  }
  if (graph) {
    const nodeIds = new Set((graph.nodes ?? []).map((n: any) => String(n.id)));
    const edgeKeys = new Set(
      (graph.edges ?? [])
        .filter((e: any) => e.relation === 'mentions')
        .map((e: any) => `${e.source}→${e.target}`),
    );
    for (const r of resources)
      for (const slug of r.linked) {
        if (!nodeIds.has(`entity:${slug}`))
          add('graph-missing-node', 'error', `nœud entity:${slug} absent de graph.json`);
        if (!edgeKeys.has(`resource:${r.slug}→entity:${slug}`))
          add(
            'graph-missing-edge',
            'error',
            `arête « mentions » manquante : ${r.slug} → ${slug}`,
          );
      }

    // Origine : nœud origin:<val> + arête has_origin pour chaque origin connue.
    const originEdgeKeys = new Set(
      (graph.edges ?? [])
        .filter((e: any) => e.relation === 'has_origin')
        .map((e: any) => `${e.source}→${e.target}`),
    );
    for (const r of resources) {
      if (!r.origin || !ORIGIN_VALUES.has(r.origin)) continue;
      if (!nodeIds.has(`origin:${r.origin}`))
        add('graph-missing-node', 'error', `nœud origin:${r.origin} absent de graph.json`);
      if (!originEdgeKeys.has(`resource:${r.slug}→origin:${r.origin}`))
        add(
          'graph-missing-edge',
          'error',
          `arête « has_origin » manquante : ${r.slug} → origin:${r.origin}`,
        );
    }

    // belongs_to_theme / written_by / has_type / published_on : miroir de
    // « mentions »/« has_origin ». Rattrape une suppression qui aurait laissé un
    // node/edge dérivé désynchronisé (ces relations n'étaient pas vérifiées).
    const relEdges = (rel: string) =>
      new Set(
        (graph.edges ?? [])
          .filter((e: any) => e.relation === rel)
          .map((e: any) => `${e.source}→${e.target}`),
      );
    const themeEdges = relEdges('belongs_to_theme');
    const authorEdges = relEdges('written_by');
    const typeEdges = relEdges('has_type');
    const dateEdges = relEdges('published_on');
    for (const r of resources) {
      // belongs_to_theme suit les topics du FRONTMATTER (union des sections),
      // pas les topics chunk isolés — c'est ainsi que le graphe est construit.
      for (const t of r.feThemes) {
        if (!nodeIds.has(`theme:${t}`))
          add('graph-missing-node', 'error', `nœud theme:${t} absent de graph.json`);
        if (!themeEdges.has(`resource:${r.slug}→theme:${t}`))
          add('graph-missing-edge', 'error', `arête « belongs_to_theme » manquante : ${r.slug} → ${t}`);
      }
      if (r.author) {
        const a = slugify(r.author);
        if (!nodeIds.has(`author:${a}`))
          add('graph-missing-node', 'error', `nœud author:${a} absent de graph.json`);
        if (!authorEdges.has(`resource:${r.slug}→author:${a}`))
          add('graph-missing-edge', 'error', `arête « written_by » manquante : ${r.slug} → author:${a}`);
      }
      if (r.sourceType) {
        if (!nodeIds.has(`type:${r.sourceType}`))
          add('graph-missing-node', 'error', `nœud type:${r.sourceType} absent de graph.json`);
        if (!typeEdges.has(`resource:${r.slug}→type:${r.sourceType}`))
          add('graph-missing-edge', 'error', `arête « has_type » manquante : ${r.slug} → type:${r.sourceType}`);
      }
      if (r.date) {
        const target = r.date.length >= 7 ? `date:${r.date.slice(0, 7)}` : `date:${r.date.slice(0, 4)}`;
        if (!nodeIds.has(target))
          add('graph-missing-node', 'error', `nœud ${target} absent de graph.json`);
        if (!dateEdges.has(`resource:${r.slug}→${target}`))
          add('graph-missing-edge', 'error', `arête « published_on » manquante : ${r.slug} → ${target}`);
      }
    }

    // Orphelins : node/edge « resource:<slug> » sans fichier ressource (rattrape
    // une suppression incomplète du graphe).
    const resourceSlugs = new Set(resources.map((r) => r.slug));
    for (const n of graph.nodes ?? []) {
      const id = String(n.id);
      if (id.startsWith('resource:') && !resourceSlugs.has(id.slice('resource:'.length)))
        add('graph-orphan-node', 'error', `nœud ${id} sans ressource correspondante`);
    }
    for (const e of graph.edges ?? []) {
      for (const ep of [String(e.source), String(e.target)]) {
        if (ep.startsWith('resource:') && !resourceSlugs.has(ep.slice('resource:'.length))) {
          add('graph-orphan-edge', 'error', `arête « ${e.relation} » référence une ressource inexistante : ${ep}`);
          break;
        }
      }
    }

    // Nœuds nus : tout nœud entity:/theme:/author:/type:/origin: DOIT porter un `label`
    // non vide. Transforme en échec de CI la récidive du bug « entité écrite sans nom »
    // (une entité déjà validée entrée dans le graphe sans son label). Les nœuds sont
    // toujours émis labellisés par le moteur ; un nœud nu signale une régression.
    const LABELLED_PREFIXES = ['entity:', 'theme:', 'author:', 'type:', 'origin:'];
    for (const n of graph.nodes ?? []) {
      const id = String(n.id);
      if (!LABELLED_PREFIXES.some((p) => id.startsWith(p))) continue;
      if (String(n.label ?? '').trim() === '')
        add('graph-unlabeled-node', 'error', `nœud ${id} sans label (nœud nu — régression du correctif entités)`);
    }
  }

  let manifest: any = null;
  try {
    manifest = JSON.parse(await readFileSafe('_ingested.json'));
  } catch {
    add('manifest-file', 'error', '_ingested.json illisible (JSON invalide)');
  }
  if (manifest) {
    const keys = new Set(Object.keys(manifest.files ?? {}));
    for (const r of resources)
      if (r.source_file && !keys.has(r.source_file))
        add(
          'manifest-missing',
          'error',
          `${r.slug} : source_file « ${r.source_file} » absent de _ingested.json`,
        );
    // manifest-orphan : entrée pointant une ressource supprimée (rattrape une
    // purge de clé manquée à la suppression).
    const resourceSlugs = new Set(resources.map((r) => r.slug));
    for (const [file, entry] of Object.entries(manifest.files ?? {})) {
      const slug = (entry as any)?.slug;
      if (slug && !resourceSlugs.has(String(slug)))
        add('manifest-orphan', 'error', `_ingested.json : « ${file} » pointe une ressource inexistante (${slug})`);
    }
  }

  // --- Rapport ---
  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');

  if (asJson) {
    console.log(JSON.stringify({ errors: errors.length, warns: warns.length, issues }, null, 2));
  } else {
    const byCat = new Map<string, Issue[]>();
    for (const i of issues) {
      if (!byCat.has(i.category)) byCat.set(i.category, []);
      byCat.get(i.category)!.push(i);
    }
    if (issues.length === 0) {
      console.log('✓ wiki-verify : aucun problème détecté.');
    } else {
      for (const [cat, list] of byCat) {
        console.log(`\n[${cat}] ${list.length}`);
        for (const i of list) console.log(`  ${i.severity === 'error' ? '✗' : '⚠'} ${i.message}`);
      }
      console.log(
        `\nwiki-verify : ${errors.length} erreur(s), ${warns.length} avertissement(s) sur ${resources.length} ressource(s), ${entities.length} entité(s), ${themes.length} thème(s).`,
      );
    }
  }

  // En mode strict, tout problème (erreur OU avertissement, dont un lien raté)
  // fait échouer le run ; en mode par défaut on avertit sans casser (exit 0).
  process.exit(strict && issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('wiki-verify a planté :', e);
  process.exit(2);
});
