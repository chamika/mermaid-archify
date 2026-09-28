import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { viewerBundle } from './vite-plugin-viewer-bundle';

export default defineConfig({
  plugins: [preact(), viewerBundle()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000 },
});
