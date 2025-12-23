import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0F17',
        panel: '#131A27',
        panel2: '#0F1522',
        accent: '#3B82F6'
      }
    }
  },
  plugins: []
} satisfies Config;
