// Premier lancement : copie le wiki et les sources brutes du bundle vers le dossier
// de données utilisateur (userData), une seule fois.
//
// Idempotent et NON destructif : si `wiki/` ou `raw/` existent déjà dans userData, on
// n'y touche pas — les données de l'utilisateur priment toujours. Une mise à jour du
// code (nouveau bundle) ne réamorce donc jamais par-dessus des données existantes.

const fs = require('fs');
const path = require('path');

/**
 * @param {string} dataRoot  Destination = app.getPath('userData').
 * @param {string} seedRoot  Source : dev = racine du dépôt ; packagé = <resources>/seed.
 */
function seedIfEmpty(dataRoot, seedRoot) {
  for (const name of ['wiki', 'raw']) {
    const src = path.join(seedRoot, name);
    const dst = path.join(dataRoot, name);
    if (fs.existsSync(dst)) continue; // données déjà présentes → ne rien écraser
    if (!fs.existsSync(src)) {
      console.warn(`[seed] source absente, ignorée : ${src}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
    console.log(`[seed] ${name}/ amorcé → ${dst}`);
  }
}

module.exports = { seedIfEmpty };
