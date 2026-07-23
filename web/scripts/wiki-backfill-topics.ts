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
  wikiTypeLabel,
  humanize,
  fmArray,
} from '@/lib/ingest-local';
import { projectResource } from '@/lib/wiki-project';
import { splitFrontmatter, parseResourceMeta } from '@/lib/wiki-mutate';
import { slugify } from '@/lib/wiki-parser';

/** Lit un scalaire entier du frontmatter (`resource_count: N`), ou 0. */
function scalarInt(fm: string, key: string): number {
  const m = fm.match(new RegExp(`^${key}:\\s*(\\d+)\\s*$`, 'm'));
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Upsert du bullet d'un thème dans « ## Thèmes » de l'index : remplace la ligne
 * existante `[[themes/<slug>|…]]` (compteur réconcilié), ou l'insère sous le heading.
 */
function upsertThemeBullet(body: string, slug: string, bullet: string): string {
  const lines = body.split('\n');
  const re = new RegExp(`\\[\\[themes/${slug}[|\\]]`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = bullet;
      return lines.join('\n');
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/^## Thèmes/.test(lines[i])) {
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
 * Réconcilie les compteurs de thèmes de `index.md` : la re-projection d'une ressource
 * DÉJÀ indexée court-circuite `updateIndex`, donc les bullets `## Thèmes` ne bougent pas.
 * On relit le `resource_count` AUTORITAIRE de chaque page thème affectée et on réécrit
 * son bullet dans l'index (créé s'il manque).
 */
async function reconcileIndex(
  affectedThemes: Set<string>,
  labels: Record<string, string>,
): Promise<void> {
  if (!affectedThemes.size) return;
  const index = await readRepoFile('wiki/index.md');
  if (index === null) return;
  const { fm, rest } = splitFrontmatter(index);
  let body = rest;
  for (const t of affectedThemes) {
    const themePage = await readRepoFile(`wiki/themes/${t}.md`);
    if (themePage === null) continue;
    const count = scalarInt(splitFrontmatter(themePage).fm, 'resource_count');
    const label = labels[t] ?? humanize(t);
    const bullet = `- [[themes/${t}|${label}]] — ${count} ressource${count > 1 ? 's' : ''}`;
    body = upsertThemeBullet(body, t, bullet);
  }
  await applyFileOps([{ path: 'wiki/index.md', content: `---\n${fm}\n---\n${body}` }]);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const today = new Date().toISOString().slice(0, 10);
  const registries = await loadRegistries();
  const themeLabel = (t: string) => registries.themes.find((x) => x.slug === t)?.label ?? humanize(t);

  const files = (await listWikiDir('resources')).filter((f) => f.endsWith('.md')).sort();
  const affectedThemes = new Set<string>();
  let fixedCount = 0;

  for (const file of files) {
    const content = await readRepoFile(`wiki/resources/${file}`);
    if (content === null || !content.trim()) continue;

    const feTopics = fmArray(splitFrontmatter(content).fm, 'topics');
    const meta = parseResourceMeta(content, path.basename(file, '.md'));
    const missing = meta.topics.filter((t) => !feTopics.includes(t));
    if (missing.length === 0) continue; // GARDE d'idempotence : union ⊆ frontmatter

    fixedCount += 1;
    for (const t of missing) affectedThemes.add(t);

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

  await reconcileIndex(affectedThemes, Object.fromEntries([...affectedThemes].map((t) => [t, themeLabel(t)])));
  console.log(
    fixedCount === 0
      ? '✓ Rien à corriger : tous les frontmatters `topics:` sont complets.'
      : `\n✓ ${fixedCount} ressource(s) corrigée(s) ; index réconcilié sur ${affectedThemes.size} thème(s).`,
  );
}

main().catch((e) => {
  console.error('wiki-backfill-topics a planté :', e);
  process.exit(1);
});
