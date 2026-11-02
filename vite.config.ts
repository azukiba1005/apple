import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// base './' = GitHub Pages / Cloudflare Pages どちらでも動く相対パス
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        privacy: 'privacy/index.html',
        terms: 'terms/index.html',
      },
    },
  },
});
