import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  // Pixel baselines are platform-specific; CI still runs every functional
  // assertion but skips the screenshot comparisons.
  ignoreSnapshots: !!process.env.CI,
  expect: { toHaveScreenshot: { animations: 'disabled' } },
  use: { baseURL: 'http://localhost:4174', viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
