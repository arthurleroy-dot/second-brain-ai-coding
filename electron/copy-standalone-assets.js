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

  // @napi-rs/canvas (module NATIF du rendu PDF→PNG) → <base>/node_modules/@napi-rs.
  // POURQUOI copier à la main : `@napi-rs/canvas` est chargé par un `import()` DYNAMIQUE
  // (via unpdf, cf. web/lib/pdf-render.ts) et déclaré `serverComponentsExternalPackages`
  // (next.config.js) → le tracing nft de `next build` ne l'embarque PAS de façon fiable
  // dans standalone/node_modules. Sans lui, la route /api/raw-image plante à l'exécution
  // (« @napi-rs/canvas is not available »). On copie tout le scope `@napi-rs` (le package
  // `canvas` + le sous-package binaire de la plateforme, ex. `canvas-darwin-arm64` /
  // `canvas-win32-x64-msvc`). En CI, le binaire est celui du runner courant (matrice
  // macos/windows native → `npm install` pose le bon `.node`), donc pas de cross-compile.
  const napiSrc = path.join(repoRoot, 'web', 'node_modules', '@napi-rs');
  if (fs.existsSync(napiSrc)) {
    const napiDst = path.join(base, 'node_modules', '@napi-rs');
    fs.rmSync(napiDst, { recursive: true, force: true });
    fs.cpSync(napiSrc, napiDst, { recursive: true });
    const nodeFiles = fs
      .readdirSync(napiDst)
      .flatMap((d) => {
        const dir = path.join(napiDst, d);
        return fs.existsSync(dir) && fs.statSync(dir).isDirectory()
          ? fs.readdirSync(dir).filter((f) => f.endsWith('.node')).map((f) => `${d}/${f}`)
          : [];
      });
    console.log(
      `[copy-standalone-assets] @napi-rs copié → ${path.relative(repoRoot, napiDst)} ` +
        `(binaire(s) : ${nodeFiles.length ? nodeFiles.join(', ') : 'AUCUN ✗'})`,
    );
    if (nodeFiles.length === 0) {
      console.error('[copy-standalone-assets] ⚠ aucun binaire .node @napi-rs — le rendu PDF cassera.');
      process.exit(1);
    }
  } else {
    console.error(`[copy-standalone-assets] Manquant : ${napiSrc} (lance \`npm --prefix web install\`)`);
    process.exit(1);
  }

  console.log(
    `[copy-standalone-assets] OK — base=${path.relative(repoRoot, base)} ; ` +
      `.next/static copié (${path.relative(repoRoot, staticDst)}).`,
  );
}

main();
