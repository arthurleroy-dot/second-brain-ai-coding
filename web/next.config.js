/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Paquets Node lourds gardés hors du bundling serveur agressif :
  // - gray-matter (migration / parsing markdown)
  // - officeparser (extraction PDF/PPTX/DOCX, dépend de tesseract.js)
  experimental: {
    serverComponentsExternalPackages: ['gray-matter', 'officeparser'],
  },
};

module.exports = nextConfig;
