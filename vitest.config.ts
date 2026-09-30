import { defineConfig } from 'vitest/config';
import { faIcons } from './vite-plugin-fa-icons';
import { viewerBundle } from './vite-plugin-viewer-bundle';

export default defineConfig({
  plugins: [faIcons(), viewerBundle()],
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    // The SVG serializer embeds the viewer's CSS (`?inline`), which vitest leaves empty by default.
    css: { include: [/src\/viewer\/.*\.css/] },
  },
});
