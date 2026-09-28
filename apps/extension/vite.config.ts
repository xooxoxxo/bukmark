import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { isTarget, manifestFor, type Target } from './src/manifest';

/** Writes the target's manifest.json next to the bundle. */
function manifest(target: Target): Plugin {
  return {
    name: 'bukmark-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifestFor(target), null, 2)}\n`,
      });
    },
  };
}

// `vite build --mode <target>`. Three entry points. popup.html and
// options.html sit at the package root so the build emits
// dist/<target>/popup.html rather than .../src/popup/index.html — the manifest
// references those paths and they must stay flat.
export default defineConfig(({ mode }) => {
  if (!isTarget(mode)) {
    throw new Error(`Unknown target "${mode}": build with --mode chrome, firefox or safari.`);
  }
  return {
    plugins: [manifest(mode)],
    build: {
      outDir: `dist/${mode}`,
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
  };
});
