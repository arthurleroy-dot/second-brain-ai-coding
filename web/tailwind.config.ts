import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
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
