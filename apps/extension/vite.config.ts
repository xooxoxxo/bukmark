import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Three entry points. popup.html and options.html sit at the package root so
// the build emits dist/popup.html rather than dist/src/popup/index.html —
// manifest.json references those paths and they must stay flat.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
