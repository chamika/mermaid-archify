import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { INVALID, urlFor } from './corpus';

/**
 * The headless CLI (dist-node/cli.js, built by `npm run build:lib`) must
 * produce what the app's Export menu produces, for one diagram of each kind.
 */
test.describe.configure({ mode: 'parallel' });

const CLI = 'dist-node/cli.js';
const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const SAMPLES = [
  'test/corpus/mermaid-demos/flowchart-001.mmd', // CJK labels, dense fan-out
  'test/corpus/mermaid-docs/flowchart-103.mmd', // nested subgraphs, shapes, edge labels
  'test/corpus/mermaid-demos/sequence-001.mmd',
  'test/corpus/mermaid-demos/class-004.mmd',
  'test/corpus/mermaid-docs/er-012.mmd',
  'test/corpus/mermaid-docs/state-013.mmd',
  'test/corpus/mermaid-docs/architecture-004.mmd',
  'e2e/fixtures/styled-flowchart.mmd', // author styles (custom properties in style attributes)
];

async function appExport(page: Page, file: string, theme: 'dark' | 'light', item: RegExp): Promise<string> {
  await page.addInitScript((t) => localStorage.setItem('mermaid-archify:theme', t), theme);
  await page.goto(urlFor(readFileSync(file, 'utf8')));
  await expect(page.locator('.ma-svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.problem')).toHaveCount(0);
  await page.getByRole('button', { name: 'Export' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).click()]);
  return readFileSync((await dl.path())!, 'utf8');
}

/**
 * The app serializes a DOM that Preact has re-rendered many times; the CLI one
 * it rendered once, under happy-dom. Attribute order and style-attribute
 * spacing differ, nothing else may. Re-serialize both through Chrome with
 * sorted attributes and normalized styles, one tag per line for readable diffs.
 */
function canonicalSvg(page: Page, svg: string): Promise<string[]> {
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    for (const el of doc.querySelectorAll<SVGElement>('*')) {
      if (el.hasAttribute('style')) el.setAttribute('style', el.style.cssText);
      const attrs = [...el.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => a.localeCompare(b));
      for (const [name] of attrs) el.removeAttribute(name);
      for (const [name, value] of attrs) el.setAttribute(name, value);
    }
    return new XMLSerializer().serializeToString(doc).split(/(?<=>)/);
  }, svg);
}

for (const file of SAMPLES) {
  test(`HTML matches the app: ${file}`, async ({ page }) => {
    const app = await appExport(page, file, 'dark', /Interactive HTML/);
    const out = cli(file, '-o', '-');
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    // Compare the embedded Scene first for a readable diff, then everything.
    const scene = (html: string) => /<script type="application\/json" id="ma-scene">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(JSON.parse(scene(out.stdout))).toEqual(JSON.parse(scene(app)));
    expect(out.stdout === app, 'CLI HTML is byte-identical to the app export').toBe(true);
  });

  test(`SVG matches the app: ${file}`, async ({ page }) => {
    const app = await appExport(page, file, 'dark', /SVG/);
    const out = cli(file, '-f', 'svg', '-o', '-');
    expect(out.status).toBe(0);
    expect(await canonicalSvg(page, out.stdout)).toEqual(await canonicalSvg(page, app));
  });
}

test('light-theme SVG matches the app', async ({ page }) => {
  const file = 'test/corpus/mermaid-docs/architecture-004.mmd';
  const app = await appExport(page, file, 'light', /SVG/);
  const out = cli(file, '--theme', 'light', '-f', 'svg', '-o', '-');
  expect(out.status).toBe(0);
  expect(out.stdout).toContain('--bg:#f8fafc');
  expect(await canonicalSvg(page, out.stdout)).toEqual(await canonicalSvg(page, app));
});

test('batch: a glob renders into --out-dir, and invalid diagrams fail with file:line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ma-cli-'));
  const out = cli('test/corpus/mermaid-demos/*.mmd', '--out-dir', dir, '-f', 'svg', '-q');
  const inputs = readdirSync('test/corpus/mermaid-demos').filter((f) => f.endsWith('.mmd'));
  const invalid = Object.keys(INVALID).filter((k) => k.startsWith('mermaid-demos/'));
  expect(invalid.length).toBeGreaterThan(0);

  expect(out.status).toBe(1);
  const written = readdirSync(dir).sort();
  expect(written).toEqual(inputs.filter((f) => !invalid.includes(`mermaid-demos/${f.replace(/\.mmd$/, '')}`)).map((f) => f.replace(/\.mmd$/, '.svg')).sort());
  for (const name of invalid) expect(out.stderr).toMatch(new RegExp(`^test/corpus/${name}\\.mmd:\\d+: .+$`, 'm'));
  expect(out.stderr).toContain(`${invalid.length} of ${inputs.length} diagrams failed`);
});

test('usage errors exit 2', () => {
  expect(cli().status).toBe(2);
  const png = cli('test/corpus/mermaid-demos/flowchart-001.mmd', '-o', 'x.png');
  expect(png.status).toBe(2);
  expect(png.stderr).toContain("PNG output isn't supported");
  expect(cli('test/corpus/mermaid-demos/*.mmd', '-o', 'x.html').status).toBe(2);
});
