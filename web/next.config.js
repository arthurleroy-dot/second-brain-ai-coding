const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // gray-matter (parsing frontmatter markdown) gardé hors du bundling agressif.
    serverComponentsExternalPackages: ['gray-matter'],
    // Le wiki markdown vit à la racine du dépôt (hors du root `web/`). On l'inclut
    // dans le bundle serverless pour que les Server Components le lisent via fs
    // à l'exécution (les binaires de raw/ sont servis à part par /api/raw).
    outputFileTracingIncludes: {
      '/**': ['../wiki/**', '../raw/**/*.meta.md'],
    },
    // Racine du tracing = dossier parent (monorepo : web/ + wiki/ + raw/).
    outputFileTracingRoot: path.join(__dirname, '..'),
  },
};

module.exports = nextConfig;
