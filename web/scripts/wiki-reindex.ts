/**
 * Réparateur déterministe des index dérivés — RÉGÉNÈRE `wiki/index.md` + toutes les
 * pages `by-date/` à partir de l'état canonique (fiches `resources/` + registres).
 * Miroir de `wiki:verify` : lancé sous `tsx`, WIKI_ROOT-aware, AUCUN appel IA.
 *
 * Sert (a) à réparer l'index/by-date corrompus par l'ancienne couche incrémentale
 * (slugs cassés, entités plafonnées, dates dupliquées) et (b) de filet manuel après
 * toute mutation. Idempotent : relancer ne change plus rien.
 *
 * Usage : npm run wiki:reindex   (depuis web/)
 * WIKI_ROOT/RAW_ROOT/DATA_ROOT surchargeables pour cibler une copie scratch.
 */
import { rebuildDerivedIndexes } from '@/lib/ingest-local';
import { applyFileOps } from '@/lib/wiki-fs';

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const ops = await rebuildDerivedIndexes(today);
  await applyFileOps(ops);
  const upserts = ops.filter((o) => 'content' in o).length;
  const deletes = ops.filter((o) => 'delete' in o).length;
  console.log(`✓ wiki:reindex — ${upserts} page(s) réécrite(s), ${deletes} orpheline(s) supprimée(s).`);
}

main().catch((e) => {
  console.error('wiki:reindex a planté :', e);
  process.exit(1);
});
