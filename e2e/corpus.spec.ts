import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { FIXTURES, INVALID, renderedProblems, source, urlFor } from './corpus';

/**
 * Every corpus diagram rendered by the real app in Chrome, checked with real
 * fonts. Set SHOTS=1 to also save a screenshot per fixture under
 * test-results/corpus-shots/ for manual review.
 */
test.describe.configure({ mode: 'parallel' });

const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync('test-results/corpus-shots', { recursive: true });

for (const name of FIXTURES) {
  test(name, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(() => localStorage.setItem('mermaid-archify:theme', 'dark'));
    await page.goto(urlFor(source(name)));

    if (INVALID[name]) {
      await expect(page.locator('.problem')).toContainText(/Line \d+/, { timeout: 20_000 });
      return;
    }
    await expect(page.locator('.ma-svg')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.problem')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    if (SHOTS) {
      await page.waitForTimeout(350);
      await page.locator('.canvas-pane').screenshot({ path: `test-results/corpus-shots/${name.replace('/', '__')}.png` });
    }

    expect(await page.evaluate(renderedProblems)).toEqual([]);
    expect(errors).toEqual([]);

    // The fitted diagram is fully visible in the canvas.
    const pane = (await page.locator('.canvas-pane').boundingBox())!;
    const svg = (await page.locator('.ma-svg').boundingBox())!;
    expect(svg.x).toBeGreaterThanOrEqual(pane.x - 1);
    expect(svg.x + svg.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
    expect(svg.y).toBeGreaterThanOrEqual(pane.y - 1);
    expect(svg.y + svg.height).toBeLessThanOrEqual(pane.y + pane.height + 1);

  });
}
