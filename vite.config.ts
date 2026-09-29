import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { faIcons } from './vite-plugin-fa-icons';
import { viewerBundle } from './vite-plugin-viewer-bundle';

export default defineConfig({
  plugins: [preact(), viewerBundle(), faIcons()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000 },
});
