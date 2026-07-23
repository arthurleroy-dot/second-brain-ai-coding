/**
 * Backfill CIBLÉ des entités vers le frontmatter (répare l'existant sans churn).
 *
 * Répare trois séquelles de l'asymétrie entités/thèmes corrigée dans le moteur, en
 * touchant UNIQUEMENT ce qui manque — SANS re-projeter les ressources (les pages
 * thèmes/entités déjà produites par l'ingestion initiale, avec leurs résumés soignés,
 * sont préservées telles quelles) :
 *   1. Frontmatter `entities:` incomplet : l'IA a annoté des entités en section
 *      (`` `entities: [...]` ``) mais laissé la clé du frontmatter incomplète. On remonte
 *      l'union au frontmatter (`rollupSectionEntities`) — et RIEN d'autre dans la fiche.
 *   2. Section « ## Entités » absente de `index.md` : on la (re)construit depuis le
 *      registre, chaque entité avec son `resource_count` autoritaire (nb de mentions de sa
 *      fiche). Section créée si absente (helper partagé `ensureEntitiesSection`).
 *   3. Nœuds de graphe `entity:*` « nus » (sans `label`) : filet anti-nu final — on les
 *      comble depuis le registre. Les arêtes `mentions` (déjà correctes, avec leurs ancres
 *      de section) ne sont PAS touchées.
 *
 * Pourquoi pas de re-projection : sur l'existant, les fiches d'entités et les pages thèmes
 * portent déjà les mentions section-level correctes ET des résumés rédigés à l'ingestion.
 * Re-projeter les régénérerait en déterministe (perte des résumés soignés) sans bénéfice
 * pour la correction visée. Les gaps réels sont uniquement : frontmatter, index, labels nus.
 *
 * Sûreté : (a) n'agit sur une ressource que si des entités manquent → relançable = no-op
 * (idempotent) ; (b) `--dry-run` liste sans écrire ; (c) `applyFileOps` est atomique et
 * refuse tout chemin hors `wiki/`/`raw/` ; (d) ne touche JAMAIS `raw/` ni le corps des fiches.
 *
 * Usage : tsx scripts/wiki-backfill-entities.ts [--dry-run]
 */
import path from 'path';
import { readRepoFile, applyFileOps, listWikiDir } from '@/lib/wiki-fs';
import {
  loadRegistries,
  rollupSectionEntities,
  humanize,
  fmArray,
  type Registries,
} from '@/lib/ingest-local';
import { ensureEntitiesSection } from '@/lib/wiki-project';
import {
  splitFrontmatter,
  parseResourceMeta,
  parseGraph,
  serializeGraph,
  entityReferencingResources,
} from '@/lib/wiki-mutate';

/**
 * Upsert du bullet d'une entité dans « ## Entités » de l'index : remplace la ligne
 * existante `[[entities/<slug>|…]]` (compteur réconcilié), ou l'insère sous le heading.
 */
function upsertEntityBullet(body: string, slug: string, bullet: string): string {
  const lines = body.split('\n');
  const re = new RegExp(`\\[\\[entities/${slug}[|\\]]`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = bullet;
      return lines.join('\n');
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/^## Entités/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !/^## /.test(lines[j]) && !/^---/.test(lines[j])) j++;
      let k = j - 1;
      while (k > i && lines[k].trim() === '') k--;
      lines.splice(k + 1, 0, bullet);
      return lines.join('\n');
    }
  }
  return body;
}

/**
 * (Re)construit la section « ## Entités » de `index.md` pour TOUTES les entités du registre,
 * avec le `resource_count` autoritaire de chaque fiche, et synchronise le heading
 * `## Entités (N)` + `entity_count` sur le nombre réel de bullets. Section auto-amorcée.
 */
async function reconcileIndex(registries: Registries): Promise<number> {
  const index = await readRepoFile('wiki/index.md');
  if (index === null) return 0;
  const parts = splitFrontmatter(index);
  const seeded = ensureEntitiesSection(parts.fm, parts.rest);
  let fm = seeded.fm;
  let body = seeded.body;

  for (const ent of [...registries.entities].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const page = await readRepoFile(`wiki/entities/${ent.slug}.md`);
    if (page === null) continue;
    const count = entityReferencingResources(page).length;
    const bullet = `- [[entities/${ent.slug}|${ent.label}]] — ${count} ressource${count > 1 ? 's' : ''}`;
    body = upsertEntityBullet(body, ent.slug, bullet);
  }

  const n = (body.match(/^- \[\[entities\//gm) ?? []).length;
  body = body.replace(/^## Entités \(\d+\)/m, `## Entités (${n})`);
  fm = /^entity_count:\s*\d+\s*$/m.test(fm)
    ? fm.replace(/^entity_count:\s*\d+\s*$/m, `entity_count: ${n}`)
    : `${fm}\nentity_count: ${n}`;

  await applyFileOps([{ path: 'wiki/index.md', content: `---\n${fm}\n---\n${body}` }]);
  return n;
}

/** Ids des nœuds `entity:*` sans `label` non vide dans un graphe parsé. */
function nudeEntityNodeIds(graphJson: string): string[] {
  return parseGraph(graphJson)
    .nodes.filter((n) => String(n.id).startsWith('entity:') && String((n as any).label ?? '').trim() === '')
    .map((n) => String(n.id));
}

/**
 * Filet anti-nu : comble le `label`/`entity_type` de tout nœud `entity:*` encore sans
 * `label`, depuis le registre (repli `humanize`/'concept'). Garantit zéro nœud nu, sans
 * toucher aux arêtes.
 */
async function fillNudeGraphNodes(registries: Registries): Promise<number> {
  const graphJson = await readRepoFile('wiki/graph.json');
  if (graphJson === null) return 0;
  const g = parseGraph(graphJson);
  let filled = 0;
  for (const n of g.nodes) {
    const id = String(n.id);
    if (!id.startsWith('entity:')) continue;
    if (String((n as any).label ?? '').trim() !== '') continue;
    const slug = id.slice('entity:'.length);
    const known = registries.entities.find((e) => e.slug === slug);
    (n as any).label = known?.label ?? humanize(slug);
    if ((n as any).entity_type === undefined) (n as any).entity_type = known?.entity_type ?? 'concept';
    filled += 1;
  }
  if (filled) await applyFileOps([{ path: 'wiki/graph.json', content: serializeGraph(g) }]);
  return filled;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const registries = await loadRegistries();

  const files = (await listWikiDir('resources')).filter((f) => f.endsWith('.md')).sort();
  let fixedCount = 0;

  for (const file of files) {
    const content = await readRepoFile(`wiki/resources/${file}`);
    if (content === null || !content.trim()) continue;

    const feEntities = fmArray(splitFrontmatter(content).fm, 'entities');
    const meta = parseResourceMeta(content, path.basename(file, '.md'));
    const missing = meta.entities.filter((e) => !feEntities.includes(e));
    if (missing.length === 0) continue; // GARDE d'idempotence : union ⊆ frontmatter

    fixedCount += 1;
    if (dryRun) {
      console.log(`• ${meta.slug} — entités manquantes : ${missing.join(', ')}`);
      continue;
    }

    // CIBLÉ : remonte les entités au frontmatter SANS re-projeter (corps + vues intacts).
    const fixed = rollupSectionEntities(content);
    await applyFileOps([{ path: `wiki/resources/${file}`, content: fixed }]);
    console.log(`✓ ${meta.slug} — ${missing.length} entité(s) remontée(s) au frontmatter : ${missing.join(', ')}`);
  }

  if (dryRun) {
    const graphJson = await readRepoFile('wiki/graph.json');
    const nude = graphJson ? nudeEntityNodeIds(graphJson) : [];
    console.log(
      `\n${fixedCount} ressource(s) à corriger ; ${nude.length} nœud(s) entity nu(s)` +
        `${nude.length ? ` : ${nude.join(', ')}` : ''} (dry-run — rien écrit).`,
    );
    return;
  }

  const listed = await reconcileIndex(registries);
  const filled = await fillNudeGraphNodes(registries);

  console.log(
    fixedCount === 0
      ? '✓ Rien à remonter : tous les frontmatters `entities:` sont complets.'
      : `\n✓ ${fixedCount} ressource(s) : entités remontées au frontmatter (vues préservées).`,
  );
  console.log(`✓ Index : section « ## Entités (${listed}) » réconciliée depuis le registre.`);
  console.log(
    filled
      ? `✓ Filet anti-nu : ${filled} nœud(s) entity labellisé(s) depuis le registre.`
      : '✓ Aucun nœud entity nu résiduel.',
  );
}

main().catch((e) => {
  console.error('wiki-backfill-entities a planté :', e);
  process.exit(1);
});
