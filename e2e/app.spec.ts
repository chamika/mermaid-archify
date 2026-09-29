import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

const pickSample = (page: Page, id: string) => page.locator('.sample select').selectOption(id);

async function replaceSource(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('.ma-svg')).toBeVisible({ timeout: 20_000 });
});

for (const [id, nodes, edges] of [
  ['flowchart', 11, 11],
  ['sequence', 10, 10],
  ['state', 11, 12],
  ['architecture', 7, 6],
] as const) {
  test(`renders the ${id} sample`, async ({ page }) => {
    await pickSample(page, id);
    await expect(page.locator('.ma-node')).toHaveCount(nodes);
    await expect(page.locator('.ma-edge')).toHaveCount(edges);
    // No horizontal page overflow; the viewer contains the diagram.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
    expect(overflow).toBe(false);
  });
}

test('invalid edit shows an error on the right line and keeps the last render', async ({ page }) => {
  await replaceSource(page, 'flowchart LR\n  A --> B\n  B -->');
  await expect(page.locator('.problem')).toContainText('Line 3');
  await expect(page.locator('.problem')).toContainText('Unexpected end of input');
  await expect(page.locator('.ma-svg')).toBeVisible();
  await page.keyboard.insertText(' C');
  await expect(page.locator('.problem')).toHaveCount(0);
  await expect(page.locator('.ma-node')).toHaveCount(3);
});

test('focus opens the passport; finder focuses a node', async ({ page }) => {
  await page.locator('.ma-node[data-id="api"]').click();
  await expect(page.locator('.ma-passport h2')).toHaveText('Checkout API');
  await expect(page.locator('.ma-passport')).toContainText('verify JWT');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ma-passport')).toHaveCount(0);
  await page.keyboard.press('/');
  await page.locator('.ma-finder input').fill('stripe');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ma-passport h2')).toHaveText('Stripe');
});

async function expectCentred(page: Page) {
  // The diagram's horizontal centre sits on the canvas centre.
  await expect(async () => {
    const c = (await page.locator('.canvas-pane').boundingBox())!;
    const d = (await page.locator('.ma-svg').boundingBox())!;
    expect(Math.abs(d.x + d.width / 2 - (c.x + c.width / 2))).toBeLessThan(2);
  }).toPass({ timeout: 2_000 });
}

test('hiding the code gives the diagram the full width', async ({ page }) => {
  const canvas = page.locator('.canvas-pane');
  const before = (await canvas.boundingBox())!.width;
  await page.getByRole('button', { name: 'Hide code' }).click();
  await expect(page.locator('.editor-pane')).toHaveCount(0);
  await expect(page.locator('.ma-svg')).toBeVisible();
  const after = (await canvas.boundingBox())!.width;
  expect(after).toBeGreaterThan(before);
  expect(after).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  await expectCentred(page);
  await page.getByRole('button', { name: 'Show code' }).click();
  await expect(page.locator('.editor-pane')).toBeVisible();
  expect((await canvas.boundingBox())!.width).toBeCloseTo(before, 0);
  await expectCentred(page);
});

test('theme toggle flips data-theme', async ({ page }) => {
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? 'auto');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
});

test('share link round-trips the source', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await replaceSource(page, 'flowchart TB\n  X[Shared node] --> Y');
  await expect(page.locator('.ma-node')).toHaveCount(2);
  await page.getByRole('button', { name: 'Copy share link' }).click();
  const url = page.url();
  expect(url).toContain('#src=');
  const fresh = await context.newPage();
  await fresh.goto(url);
  await expect(fresh.locator('.ma-node[data-id="X"]')).toBeVisible({ timeout: 20_000 });
});

test('exported HTML works offline with focus and exports', async ({ page, context }) => {
  await pickSample(page, 'sequence');
  await expect(page.locator('.ma-node')).toHaveCount(10);
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Interactive HTML' }).click()]);
  expect(download.suggestedFilename()).toBe('cache-miss-request.html');
  const html = readFileSync((await download.path())!, 'utf8');
  expect(html).not.toContain('mermaid.core');

  // Open with the network blocked except for fonts: no app server needed.
  const offline = await context.newPage();
  await offline.route('**/*', (route) => (route.request().url().includes('fonts.g') ? route.abort() : route.fulfill({ body: html, contentType: 'text/html' })));
  await offline.goto('http://exported.test/diagram.html');
  await expect(offline.locator('.ma-node')).toHaveCount(10);
  await offline.locator('.ma-node[data-id="A"]').first().click();
  await expect(offline.locator('.ma-passport h2')).toHaveText('Checkout API');
  expect(offline.url()).toContain('#focus=A');

  await offline.getByRole('button', { name: 'Export' }).click();
  const [svg] = await Promise.all([offline.waitForEvent('download'), offline.getByRole('menuitem', { name: /SVG/ }).click()]);
  const svgText = readFileSync((await svg.path())!, 'utf8');
  expect(svgText).toContain('<svg');
  expect(svgText).not.toMatch(/class="[^"]*\b(lit|dimmed|focused)\b/);
  expect(svgText).toContain('--backend-stroke:');
});

test('PNG export produces an image', async ({ page }) => {
  await page.getByRole('button', { name: 'Export' }).click();
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /PNG/ }).click()]);
  const buf = readFileSync((await png.path())!);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.length).toBeGreaterThan(20_000);
});

test('a plain process flow renders without type captions or legend', async ({ page }) => {
  await replaceSource(page, 'flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|One| D[Laptop]\n  C -->|Two| E[iPhone]\n  C -->|Three| F[fa:fa-car Car]');
  await expect(page.locator('.ma-node')).toHaveCount(6);
  await expect(page.locator('.ma-node .caption')).toHaveCount(0);
  await expect(page.locator('.ma-legend')).toHaveCount(0);
  await page.locator('.ma-node[data-id="C"]').click();
  await expect(page.locator('.ma-passport .kind')).toHaveText('decision');
});

test('Font Awesome icons render inline and travel into exported HTML', async ({ page, context }) => {
  await replaceSource(page, 'flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|Three| F[fa:fa-car Car]');
  const icon = page.locator('.ma-node[data-id="F"] .ma-icon');
  await expect(icon).toHaveCount(1);
  const box = (await icon.boundingBox())!;
  const text = (await page.locator('.ma-node[data-id="F"] text.label').boundingBox())!;
  expect(box.width).toBeGreaterThan(4);
  expect(box.x + box.width).toBeLessThanOrEqual(text.x + 1); // icon sits before "Car"
  // Details panel shows plain text, not the marker.
  await page.locator('.ma-node[data-id="F"]').click();
  await expect(page.locator('.ma-passport h2')).toHaveText('Car');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Interactive HTML' }).click()]);
  const html = readFileSync((await download.path())!, 'utf8');
  expect(html).toContain('Font Awesome Free');
  expect(html).not.toContain('virtual:fa-icons');
  const offline = await context.newPage();
  await offline.route('**/*', (route) => (route.request().url().includes('fonts.g') ? route.abort() : route.fulfill({ body: html, contentType: 'text/html' })));
  await offline.goto('http://exported.test/diagram.html');
  await expect(offline.locator('.ma-node[data-id="F"] .ma-icon')).toHaveCount(1);
});
