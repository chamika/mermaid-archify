import { defineConfig } from 'vitest/config';
import { faIcons } from './vite-plugin-fa-icons';

export default defineConfig({
  plugins: [faIcons()],
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
