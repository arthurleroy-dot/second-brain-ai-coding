// Hook electron-builder `afterPack` : copie l'arbre standalone (server.js + `.next` +
// **node_modules**) dans les Resources de l'app packagée.
//
// POURQUOI un hook plutôt que `extraResources` : electron-builder EXCLUT de force les
// dossiers `node_modules` imbriqués lors de la copie d'un `extraResources` (même avec un
// `filter` explicite). Or le serveur Next standalone charge `next` (et ses deps tracées)
// depuis `standalone/node_modules` → sans elles, `server.js` plante avec
// `Cannot find module 'next'`. On copie donc nous-mêmes, en pur Node, ce que la copie
// intégrée laisse tomber.
//
// Le hook tourne APRÈS l'empaquetage du .app mais AVANT la fabrication du .dmg → l'arbre
// copié est bien inclus dans l'installeur. Compatible mac ET windows (getResourcesDir).

const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const src = path.join(path.resolve(__dirname, '..'), 'web', '.next', 'standalone');

  if (!fs.existsSync(path.join(src, 'server.js'))) {
    throw new Error(`[after-pack] standalone introuvable : ${src} (lance build:web avant)`);
  }

  // Dossier Resources selon la plateforme (helper electron-builder si dispo, sinon repli).
  let resourcesDir;
  if (typeof packager.getResourcesDir === 'function') {
    resourcesDir = packager.getResourcesDir(appOutDir);
  } else if (electronPlatformName === 'darwin') {
    resourcesDir = path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(appOutDir, 'resources');
  }

  const dst = path.join(resourcesDir, 'standalone');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });

  const hasNext = fs.existsSync(path.join(dst, 'node_modules', 'next'));
  console.log(
    `[after-pack] standalone copié → ${dst} ` +
      `(node_modules/next ${hasNext ? 'présent ✓' : 'ABSENT ✗'})`,
  );
  if (!hasNext) throw new Error('[after-pack] node_modules/next manquant après copie');
};
