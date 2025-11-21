import { defineConfig } from 'vite';

export default defineConfig({
  base: '/website/',
  root: 'src',
  publicDir: '../public',
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
