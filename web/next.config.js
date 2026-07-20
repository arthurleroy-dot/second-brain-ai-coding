/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // gray-matter (parsing frontmatter markdown) gardé hors du bundling agressif.
    serverComponentsExternalPackages: ['gray-matter'],
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
