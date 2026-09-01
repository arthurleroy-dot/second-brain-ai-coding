const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sortie auto-contenue : produit web/.next/standalone/server.js + node_modules
  // tracés, que la coquille Electron lance en pur Node (ELECTRON_RUN_AS_NODE=1). C'est
  // le mécanisme conçu pour embarquer le serveur Next dans l'app de bureau.
  output: 'standalone',
  experimental: {
    // gray-matter (parsing frontmatter markdown) gardé hors du bundling agressif.
    // @napi-rs/canvas : module NATIF (.node) chargé dynamiquement par unpdf pour le
    // rendu PDF→PNG (pdf-render.ts). Webpack ne peut pas bundler un binaire natif →
    // il DOIT rester externe, sinon `import('@napi-rs/canvas')` casse au build/exec.
    serverComponentsExternalPackages: ['gray-matter', '@napi-rs/canvas'],
    // Racine de tracing FIXÉE au dossier web/. Sans ça, l'ajout d'un package.json à la
    // racine du dépôt (coquille Electron) ferait remonter la racine de tracing d'un cran
    // et imbriquerait la sortie sous standalone/web/server.js (+ risquerait d'aspirer les
    // node_modules d'Electron). Fixée ici → l'arbre reste plat et déterministe : dev == packagé.
    outputFileTracingRoot: path.join(__dirname),
    // Pages dynamiques (force-dynamic) : ne PAS réutiliser le Router Cache
    // client. Sans ça, le lien fixe « Chat » de la barre latérale renvoie la
    // version /chat mise en cache AVANT que le cookie `active_conversation`
    // n'existe (conversation vierge) au lieu de rejouer le redirect serveur
    // vers /chat/<id>. App locale : le refetch relit des fichiers locaux, coût
    // négligeable. `static` gardé au défaut Next (300 s).
    staleTimes: {
      dynamic: 0,
      static: 300,
    },
  },
  // En dev, le cache webpack sur disque (PackFileCacheStrategy) rate la lecture
  // de ses `.pack.gz` sous Node récent et lève une unhandledRejection fatale qui
  // tue le serveur dev. On désactive le cache disque en dev uniquement.
  // Voir tasks/lessons.md (2026-07-10).
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

module.exports = nextConfig;
