import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          '50': '#f8f9fa',
          '900': '#0f1117',
          '800': '#1a1d27',
          '700': '#242736',
        },
      },
    },
  },
  plugins: [],
};

export default config;
