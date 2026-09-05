import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { prerenderFragments } from './scripts/prerender-fragments.js';

// Absolute URL of the deployed site, used for the per-fragment Open Graph tags.
const SITE_URL = 'https://danielgazit.com';

export default defineConfig({
  base: '/',
  root: 'src',
  publicDir: '../public',
  plugins: [
    prerenderFragments({
      siteUrl: SITE_URL,
      manifestPath: fileURLToPath(new URL('./src/js/videos-data.js', import.meta.url)),
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
    host: true,
  },
});
