import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { prerenderFragments } from './scripts/prerender-fragments.js';
import { prerenderPages } from './scripts/prerender-pages.js';

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
    prerenderPages({
      siteUrl: SITE_URL,
      pages: [
        {
          path: '/music',
          title: 'Released Music — Daniel Gazit',
          description: 'Albums and released collaborations by Daniel Gazit, to listen to on Spotify, Apple Music, Tidal and YouTube Music.',
          image: '/cloth_and_paper_cover.jpg',
          imageWidth: 1200,
          imageHeight: 1200,
        },
        {
          path: '/works',
          title: 'Selected Works — Daniel Gazit',
          description: 'Albums, collaborations, audiovisual work and performance by Daniel Gazit.',
          image: '/og-image.jpg',
          imageWidth: 1200,
          imageHeight: 630,
        },
        {
          path: '/live',
          title: 'Live — Daniel Gazit',
          description: 'Upcoming and past live shows by Daniel Gazit.',
          image: '/og-image.jpg',
          imageWidth: 1200,
          imageHeight: 630,
        },
      ],
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
