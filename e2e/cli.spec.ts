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
const cliBytes = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args]);

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
  const pdf = cli('test/corpus/mermaid-demos/flowchart-001.mmd', '-o', 'x.pdf');
  expect(pdf.status).toBe(2);
  expect(pdf.stderr).toContain('use .html, .svg or .png');
  expect(cli('test/corpus/mermaid-demos/flowchart-001.mmd', '-f', 'png', '--scale', '0').status).toBe(2);
  expect(cli('test/corpus/mermaid-demos/*.mmd', '-o', 'x.html').status).toBe(2);
});

/**
 * The CLI rasterizes with resvg; the reference is Chrome drawing the same SVG
 * (as the app's PNG export does) with JetBrains Mono embedded, since an SVG in
 * <img> can't see the page's web fonts. Glyph anti-aliasing differs between
 * the two rasterizers, so a pixel only counts when nothing within 1px of it in
 * the other image matches. This is a coarse guard (an unresolved palette, a
 * missing font or background shows up as 10-100%); small shapes such as
 * markers are checked structurally in test/node.test.ts.
 */
const FONT_FACES = ['400-normal', '400-italic', '600-normal', '600-italic', '700-normal', '700-italic'];
const fontFaces = () =>
  FONT_FACES.map((face) => {
    const [weight, style] = face.split('-');
    const woff2 = readFileSync(`node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${face}.woff2`).toString('base64');
    return `@font-face{font-family:'JetBrains Mono';font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${woff2})}`;
  }).join('');

function pngMismatch(page: Page, svg: string, png: Buffer): Promise<{ size: number[]; pct: number }> {
  return page.evaluate(
    async ([svgText, pngB64]) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const ref = await load(URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' })));
      const out = await load(`data:image/png;base64,${pngB64}`);
      const [w, h] = [out.width, out.height];
      const pixels = (draw: (ctx: OffscreenCanvasRenderingContext2D) => void) => {
        const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
        draw(ctx);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const a = pixels((ctx) => (ctx.scale(2, 2), ctx.drawImage(ref, 0, 0)));
      const b = pixels((ctx) => ctx.drawImage(out, 0, 0));
      const close = (from: Uint8ClampedArray, i: number, to: Uint8ClampedArray, j: number) =>
        Math.max(...[0, 1, 2, 3].map((k) => Math.abs(from[i + k] - to[j + k]))) <= 32;
      const near = (x: number, y: number, from: Uint8ClampedArray, to: Uint8ClampedArray) => {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const [X, Y] = [x + dx, y + dy];
            if (X >= 0 && Y >= 0 && X < w && Y < h && close(from, (y * w + x) * 4, to, (Y * w + X) * 4)) return true;
          }
        return false;
      };
      let bad = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) if (!close(a, (y * w + x) * 4, b, (y * w + x) * 4) && !(near(x, y, a, b) && near(x, y, b, a))) bad++;
      return { size: [ref.width * 2, ref.height * 2, w, h], pct: (100 * bad) / (w * h) };
    },
    [svg.replace('<style>', `<style>${fontFaces()}`), png.toString('base64')] as const,
  );
}

for (const [file, theme] of [...SAMPLES.map((f) => [f, 'dark'] as const), ['test/corpus/mermaid-docs/architecture-004.mmd', 'light'] as const]) {
  test(`PNG matches Chrome's rendering of the SVG: ${file} (${theme})`, async ({ page }) => {
    const svg = cli(file, '-f', 'svg', '--theme', theme, '-o', '-');
    const png = cliBytes(file, '-f', 'png', '--theme', theme, '-o', '-');
    expect(png.status).toBe(0);
    await page.setContent('<!doctype html><body></body>');
    const { size, pct } = await pngMismatch(page, svg.stdout, png.stdout);
    expect(size.slice(2), 'PNG is the SVG at 2×').toEqual(size.slice(0, 2));
    // Measured 0.1–0.6% (text anti-aliasing; CJK labels fall back to a system font).
    expect(pct, 'share of pixels that differ beyond anti-aliasing').toBeLessThan(1);
  });
}
