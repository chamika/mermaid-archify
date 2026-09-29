import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { source, urlFor } from './corpus';

/**
 * Pixel baselines for a curated, diverse set: the app samples plus the most
 * demanding corpus diagrams, in both themes. Baselines are per-platform
 * (fonts rasterize differently); refresh with `npm run e2e -- --update-snapshots`
 * and review the diffs before committing.
 */
const CURATED: [string, string][] = [
  ['sample-flowchart', readFileSync('src/samples/architecture-flowchart.mmd', 'utf8')],
  ['sample-sequence', readFileSync('src/samples/sequence.mmd', 'utf8')],
  ['sample-state', readFileSync('src/samples/state.mmd', 'utf8')],
  ['sample-architecture', readFileSync('src/samples/architecture-beta.mmd', 'utf8')],
  ['sample-er', readFileSync('src/samples/er.mmd', 'utf8')],
  ['sample-class', readFileSync('src/samples/class.mmd', 'utf8')],
  ['styled-flowchart', readFileSync('e2e/fixtures/styled-flowchart.mmd', 'utf8')],
  ...(
    [
      'mermaid-demos/flowchart-001', // CJK labels, dense fan-out
      'mermaid-demos/flowchart-009', // large graph, many crossings
      'mermaid-docs/flowchart-097', // subgraphs with cross-links
      'mermaid-docs/flowchart-103', // nested subgraphs, shapes, edge labels
      'mermaid-demos/sequence-001', // rect highlights, nested blocks, notes
      'mermaid-docs/sequence-029', // nested par
      'mermaid-docs/sequence-030', // critical with options
      'mermaid-docs/state-013', // nested composite states
      'mermaid-docs/state-016', // state notes
      'mermaid-docs/state-017', // concurrent regions
      'mermaid-demos/architecture-008', // many labelled edges
      'mermaid-docs/architecture-004', // groups, junction fan-out
      'mermaid-docs/er-012', // keys and comments, every column
      'mermaid-docs/er-015', // nested subgraphs
      'mermaid-demos/class-004', // generics, multiplicities, every relation type
      'mermaid-docs/class-017', // lollipop interfaces
    ] as const
  ).map((name): [string, string] => [name.replace('/', '__'), source(name)]),
];

for (const theme of ['dark', 'light'] as const) {
  for (const [name, src] of CURATED) {
    test(`${name} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('mermaid-archify:theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(urlFor(src));
      await expect(page.locator('.ma-svg')).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400); // fit animation settles
      await expect(page.locator('.canvas-pane')).toHaveScreenshot(`${name}-${theme}.png`, { maxDiffPixelRatio: 0.005 });
    });
  }
}
