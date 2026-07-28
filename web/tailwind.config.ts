import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    // lib/ui.ts porte les classes de badge de type (overrides + palette des types
    // créés) en chaînes littérales → doit être scanné pour que Tailwind les génère.
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#E1F5EE',
          600: '#0F6E56',
        },
      },
    },
  },
  plugins: [],
};

export default config;
