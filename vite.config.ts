import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// base './' = GitHub Pages / Cloudflare Pages どちらでも動く相対パス
export default defineConfig({ base: './', plugins: [react()] });
