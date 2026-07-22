// Post-build : copie les assets statiques dans l'arbre standalone.
//
// `next build` en mode `output: 'standalone'` produit un serveur auto-contenu
// (server.js + node_modules tracés) MAIS ne copie PAS `.next/static` (les bundles JS/CSS
// servis au navigateur). Sans cette copie, l'app se charge sans styles ni JS client.
// Ce script copie `web/.next/static` → `<base>/.next/static` où <base> = le dossier
// contenant server.js. (`web/public` n'existe pas dans ce projet → ignoré s'il manque.)
//
// Node pur (aucune dépendance), idempotent (écrase). Exécuté en fin de `build:web`.

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const webNext = path.join(repoRoot, 'web', '.next');
const standaloneRoot = path.join(webNext, 'standalone');

/**
 * Localise le dossier contenant server.js dans l'arbre standalone. La racine de tracing
 * est fixée au dossier web/ (cf. next.config.js) → server.js est à plat. On garde une
 * détection tolérante (cas imbriqué `standalone/web/server.js`) par sécurité.
 */
function findStandaloneBase() {
  const candidates = [standaloneRoot, path.join(standaloneRoot, 'web')];
  for (const base of candidates) {
    if (fs.existsSync(path.join(base, 'server.js'))) return base;
  }
  return null;
}

function main() {
  if (!fs.existsSync(standaloneRoot)) {
    console.error(
      `[copy-standalone-assets] Introuvable : ${standaloneRoot}\n` +
        `Lance d'abord \`npm --prefix web run build\` (output: 'standalone').`,
    );
    process.exit(1);
  }

  const base = findStandaloneBase();
  if (!base) {
    console.error(
      `[copy-standalone-assets] server.js introuvable sous ${standaloneRoot} ` +
        `(ni à plat, ni sous web/).`,
    );
    process.exit(1);
  }

  // .next/static → <base>/.next/static (obligatoire).
  const staticSrc = path.join(webNext, 'static');
  const staticDst = path.join(base, '.next', 'static');
  if (!fs.existsSync(staticSrc)) {
    console.error(`[copy-standalone-assets] Manquant : ${staticSrc}`);
    process.exit(1);
  }
  fs.rmSync(staticDst, { recursive: true, force: true }); // idempotent : on repart propre
  fs.cpSync(staticSrc, staticDst, { recursive: true });

  // public/ → <base>/public (optionnel : ce projet n'en a pas).
  const publicSrc = path.join(repoRoot, 'web', 'public');
  if (fs.existsSync(publicSrc)) {
    const publicDst = path.join(base, 'public');
    fs.rmSync(publicDst, { recursive: true, force: true });
    fs.cpSync(publicSrc, publicDst, { recursive: true });
    console.log(`[copy-standalone-assets] public/ copié → ${publicDst}`);
  }

  console.log(
    `[copy-standalone-assets] OK — base=${path.relative(repoRoot, base)} ; ` +
      `.next/static copié (${path.relative(repoRoot, staticDst)}).`,
  );
}

main();
