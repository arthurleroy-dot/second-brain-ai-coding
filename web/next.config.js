/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Le front lit le wiki sur le système de fichiers local (../wiki, ../raw).
  // On exclut donc gray-matter du bundling serveur agressif si besoin.
  experimental: {
    serverComponentsExternalPackages: ['gray-matter'],
  },
};

module.exports = nextConfig;
