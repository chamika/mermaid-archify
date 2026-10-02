import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { faIcons } from './vite-plugin-fa-icons';

/**
 * Browser build of `<mermaid-archify>` into dist-element/: the viewer runtime
 * as an ES module, plus a lazily imported chunk with Mermaid + ELK that only
 * pages rendering Mermaid source in the browser ever download.
 */
export default defineConfig({
  plugins: [preact(), faIcons()],
  build: {
    outDir: 'dist-element',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    lib: { entry: resolve(import.meta.dirname, 'src/element/element.tsx'), formats: ['es'], fileName: () => 'mermaid-archify.js' },
    // Lib mode keeps whitespace in ES output (for downstream bundlers); this file is also served as is.
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js', minify: true } },
  },
});
