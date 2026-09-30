import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { faIcons } from './vite-plugin-fa-icons';
import { viewerBundle } from './vite-plugin-viewer-bundle';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'));

/** Node build of the library (`render`) and the `mermaid-archify` CLI into dist-node/. */
export default defineConfig({
  plugins: [viewerBundle(), faIcons()],
  define: { __VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: true,
    outDir: 'dist-node',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, 'src/node/index.ts'), cli: resolve(import.meta.dirname, 'src/node/cli.ts') },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        banner: (chunk) => (chunk.isEntry && chunk.name === 'cli' ? '#!/usr/bin/env node' : ''),
      },
    },
  },
});
