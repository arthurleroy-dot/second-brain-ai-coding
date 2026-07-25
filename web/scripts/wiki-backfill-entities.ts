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
 *   2. Section « ## Entités » (et le reste de `index.md` + les pages `by-date/`) : régénérée
 *      EN ENTIER depuis l'état canonique par `rebuildDerivedIndexes` (moteur unique, Phase 2)
 *      — plus de reconstruction locale ad hoc.
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
  rebuildDerivedIndexes,
  humanize,
  fmArray,
  type Registries,
} from '@/lib/ingest-local';
import {
  splitFrontmatter,
  parseResourceMeta,
  parseGraph,
  serializeGraph,
} from '@/lib/wiki-mutate';

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
  const today = new Date().toISOString().slice(0, 10);
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

  // index.md + by-date reconstruits EN ENTIER par le moteur unique (Phase 2).
  await applyFileOps(await rebuildDerivedIndexes(today));
  const filled = await fillNudeGraphNodes(registries);

  console.log(
    fixedCount === 0
      ? '✓ Rien à remonter : tous les frontmatters `entities:` sont complets.'
      : `\n✓ ${fixedCount} ressource(s) : entités remontées au frontmatter (vues préservées).`,
  );
  console.log('✓ Index/by-date : régénérés en entier depuis l’état canonique (rebuildDerivedIndexes).');
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
