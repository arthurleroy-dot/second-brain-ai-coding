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
 *   - invented-type      : type suggéré d'une candidate hors des types connus
 *   - graph-missing-node : entité reliée sans nœud entity:<slug> dans graph.json
 *   - graph-missing-edge : lien ressource↔entité sans arête « mentions »
 *   - manifest-missing   : ressource dont le source_file n'est pas dans le manifeste
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

/** Vrai si `form` (déjà normalisée) apparaît comme « mot » dans `haystack` normalisé. */
function mentions(haystackNorm: string, form: string): boolean {
  if (form.length < 2) return false;
  const re = new RegExp(`(^| )${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  return re.test(haystackNorm);
}

/** Retire frontmatter déjà géré + lignes d'annotation chunk + blockquote de nav. */
function proseOnly(body: string): string {
  return body
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^`(topics|entities):\s*\[[^\]]*\]`$/.test(t)) return false;
      if (/^>\s*Par\s+/i.test(t)) return false;
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
interface Resource {
  slug: string;
  source_file: string | null;
  linked: string[]; // slugs reliés
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
  const registryTypes = new Set(entities.map((e) => e.entity_type));
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

  // --- Ressources ---
  const resources: Resource[] = [];
  for (const file of await readDir('resources')) {
    if (!file.endsWith('.md')) continue;
    const raw = await readFileSafe(`resources/${file}`);
    if (!raw.trim()) continue;
    const { data, content } = matter(raw);
    const slug = String(data.slug ?? path.basename(file, '.md')).trim();
    const linked = [...new Set([...arr(data.entities), ...chunkEntities(content)])];
    resources.push({
      slug,
      source_file: data.source_file ? String(data.source_file) : null,
      linked,
      proseNorm: normalize(proseOnly(content)),
    });
  }

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
      for (const t of arr(c?.suggested_types))
        if (!registryTypes.has(t))
          add(
            'invented-type',
            'warn',
            `candidate « ${c?.name} » suggère un type inconnu du registre : ${t}`,
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
        `\nwiki-verify : ${errors.length} erreur(s), ${warns.length} avertissement(s) sur ${resources.length} ressource(s), ${entities.length} entité(s).`,
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
