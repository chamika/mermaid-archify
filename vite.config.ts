import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { faIcons } from './vite-plugin-fa-icons';
import { viewerBundle } from './vite-plugin-viewer-bundle';

export default defineConfig({
  plugins: [preact(), viewerBundle(), faIcons()],
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 4000,
    // embed.html: several <mermaid-archify> elements on one page (example + e2e fixture).
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), embed: resolve(import.meta.dirname, 'embed.html') } },
  },
});
