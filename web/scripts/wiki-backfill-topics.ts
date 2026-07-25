/**
 * Backfill DÉTERMINISTE des thèmes de section vers le frontmatter (fix « aucun thème »).
 *
 * Répare les ressources DÉJÀ ingérées dont le frontmatter `topics:` est incomplet :
 * l'IA a annoté des sections (`` `topics: [...]` ``) mais laissé des thèmes hors du
 * frontmatter — or toutes les vues + le graphe dérivent du frontmatter, donc ces thèmes
 * étaient perdus (pas de pastille, pas d'arête `belongs_to_theme`, pas de bloc dans
 * `wiki/themes/<slug>.md`).
 *
 * Pour chaque ressource : si l'union(frontmatter, sections) dépasse le frontmatter, on
 * remonte les topics (`rollupSectionTopics`), on régénère la nav (`rebuildNav`), puis on
 * RE-PROJETTE via le moteur déterministe (`projectResource`) — zéro appel IA. Enfin on
 * réconcilie les compteurs de thèmes de l'index (que la re-projection court-circuite).
 *
 * Sûreté : (a) n'agit que si des thèmes manquent → relançable = no-op (idempotent) ;
 * (b) `--dry-run` liste sans écrire ; (c) `applyFileOps` est atomique et refuse tout
 * chemin hors `wiki/`/`raw/` ; (d) `projectResource` est idempotent (upserts) ;
 * (e) ne touche JAMAIS `raw/`.
 *
 * Usage : tsx scripts/wiki-backfill-topics.ts [--dry-run]
 */
import path from 'path';
import { readRepoFile, applyFileOps, listWikiDir } from '@/lib/wiki-fs';
import {
  loadRegistries,
  rollupSectionTopics,
  rebuildNav,
  loadProjectViews,
  rebuildDerivedIndexes,
  wikiTypeLabel,
  humanize,
  fmArray,
} from '@/lib/ingest-local';
import { projectResource } from '@/lib/wiki-project';
import { splitFrontmatter, parseResourceMeta } from '@/lib/wiki-mutate';
import { slugify } from '@/lib/wiki-parser';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const today = new Date().toISOString().slice(0, 10);
  const registries = await loadRegistries();
  const themeLabel = (t: string) => registries.themes.find((x) => x.slug === t)?.label ?? humanize(t);

  const files = (await listWikiDir('resources')).filter((f) => f.endsWith('.md')).sort();
  let fixedCount = 0;

  for (const file of files) {
    const content = await readRepoFile(`wiki/resources/${file}`);
    if (content === null || !content.trim()) continue;

    const feTopics = fmArray(splitFrontmatter(content).fm, 'topics');
    const meta = parseResourceMeta(content, path.basename(file, '.md'));
    const missing = meta.topics.filter((t) => !feTopics.includes(t));
    if (missing.length === 0) continue; // GARDE d'idempotence : union ⊆ frontmatter

    fixedCount += 1;

    if (dryRun) {
      console.log(`• ${meta.slug} — thèmes manquants : ${missing.join(', ')}`);
      continue;
    }

    const labels: Record<string, string> = {};
    for (const t of meta.topics) labels[t] = themeLabel(t);
    const fixed = rebuildNav(rollupSectionTopics(content), meta.author, meta.date, meta.topics, labels);
    const { views } = await loadProjectViews(fixed, registries, today);
    const ops = projectResource({
      slug: meta.slug,
      resourceContent: fixed,
      views,
      slugifyAuthor: slugify,
      typeLabel: wikiTypeLabel,
      today,
    });
    await applyFileOps(ops);
    console.log(`✓ ${meta.slug} — ${missing.length} thème(s) remonté(s) : ${missing.join(', ')}`);
  }

  if (dryRun) {
    console.log(`\n${fixedCount} ressource(s) à corriger (dry-run — rien écrit).`);
    return;
  }

  // index.md + by-date reconstruits EN ENTIER par le moteur unique (Phase 2).
  await applyFileOps(await rebuildDerivedIndexes(today));
  console.log(
    fixedCount === 0
      ? '✓ Rien à corriger : tous les frontmatters `topics:` sont complets.'
      : `\n✓ ${fixedCount} ressource(s) corrigée(s) ; index/by-date régénérés en entier.`,
  );
}

main().catch((e) => {
  console.error('wiki-backfill-topics a planté :', e);
  process.exit(1);
});
