import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        horizon: resolve(__dirname, 'src/horizon.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
    host: true,
  },
});

