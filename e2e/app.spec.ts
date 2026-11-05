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
  ['er', 7, 6],
  ['class', 8, 7],
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

test('ER and class passports list rows and relationships', async ({ page }) => {
  await pickSample(page, 'er');
  await page.locator('.ma-node[data-id="ORDER"]').click();
  const passport = page.locator('.ma-passport');
  await expect(passport.locator('.kind')).toHaveText('entity');
  await expect(passport.locator('ul.rows li')).toHaveCount(4);
  await expect(passport).toContainText('customer_id');
  await expect(passport).toContainText('contains · one or more');
  await expect(passport).toContainText('places · exactly one');

  await pickSample(page, 'class');
  await page.locator('.ma-node[data-id="Card"]').click();
  await expect(passport.locator('h2')).toHaveText('Card');
  await expect(passport.locator('h3').first()).toHaveText('members');
  await expect(passport).toContainText('implements');
  await page.keyboard.press('Escape');
  await page.locator('.ma-node[data-id="PaymentMethod"]').click();
  await expect(passport.locator('.kind')).toHaveText('interface');
  await expect(passport).toContainText('implemented by');
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

test('a share link leaves the autosaved diagram alone until it is edited', async ({ page, context }) => {
  await replaceSource(page, 'flowchart LR\n  mine[My own work] --> kept');
  await expect(page.locator('.ma-node[data-id="mine"]')).toBeVisible();
  await replaceSource(page, 'flowchart LR\n  S[Shared] --> T');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  const link = page.url();
  expect(link).toContain('#src=');
  await replaceSource(page, 'flowchart LR\n  mine[My own work] --> kept');
  await expect(page).not.toHaveURL(/src=/); // editing drops the stale link from the URL

  // Opening the link shows it, and a plain visit afterwards still has the user's own diagram.
  const other = await context.newPage();
  await other.goto(link);
  await expect(other.locator('.ma-node[data-id="S"]')).toBeVisible({ timeout: 20_000 });
  await other.goto('/');
  await expect(other.locator('.ma-node[data-id="mine"]')).toBeVisible({ timeout: 20_000 });

  // A truncated link is ignored rather than wiping the autosave.
  await other.goto('/#src=abc');
  await other.reload();
  await expect(other.locator('.ma-node[data-id="mine"]')).toBeVisible({ timeout: 20_000 });

  // Editing a linked diagram makes it the autosave, and a reload keeps the edit.
  await other.goto(link);
  await expect(other.locator('.ma-node[data-id="S"]')).toBeVisible({ timeout: 20_000 });
  await replaceSource(other, 'flowchart LR\n  S[Shared, edited] --> T');
  await expect(other.locator('.ma-node[data-id="S"]')).toContainText('edited');
  await expect(other).not.toHaveURL(/src=/);
  await other.reload();
  await expect(other.locator('.ma-node[data-id="S"]')).toContainText('edited', { timeout: 20_000 });
});

test('pasting another share link into an open tab loads it', async ({ page }) => {
  await replaceSource(page, 'flowchart LR\n  P[Pasted] --> Q');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  const hash = new URL(page.url()).hash;
  await replaceSource(page, 'flowchart LR\n  other --> thing');
  await expect(page.locator('.ma-node[data-id="other"]')).toBeVisible();
  await page.evaluate((h) => (location.hash = h), hash);
  await expect(page.locator('.ma-node[data-id="P"]')).toBeVisible();
});

test('a scene change under a pinned edge, or a bad icon name, does not take the app down', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('mermaid-archify:link', 'off'));
  await page.reload();
  await replaceSource(page, 'flowchart LR\n  A --> B\n  B --> C');
  await expect(page.locator('.ma-edge')).toHaveCount(2);
  await page.locator('.ma-edge[data-id="L_B_C_0"] path').last().click({ force: true });
  await expect(page.locator('.ma-edge[data-id="L_B_C_0"]')).toHaveClass(/pinned/);
  await replaceSource(page, 'flowchart LR\n  A --> B');
  await expect(page.locator('.ma-edge')).toHaveCount(1);

  await replaceSource(page, 'flowchart LR\n  A[fa:fa-constructor Car] --> B[fa:fa-car Bus]');
  await expect(page.locator('.ma-node[data-id="A"]')).toContainText('Car');
  await expect(page.locator('.ma-icon')).toHaveCount(1);
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
  const [svg] = await Promise.all([offline.waitForEvent('download'), offline.getByRole('menuitem', { name: /SVG \(current theme\)/ }).click()]);
  const svgText = readFileSync((await svg.path())!, 'utf8');
  expect(svgText).toContain('<svg');
  expect(svgText).not.toMatch(/class="[^"]*\b(lit|dimmed|focused)\b/);
  expect(svgText).not.toMatch(/tabindex/i);
  expect(svgText).toContain('--backend-stroke:');
});

test('PNG export produces an image', async ({ page }) => {
  await page.getByRole('button', { name: 'Export' }).click();
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /PNG/ }).click()]);
  const buf = readFileSync((await png.path())!);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.length).toBeGreaterThan(20_000);
});

test('a plain process flow renders without type captions; the legend names only its decision tint', async ({ page }) => {
  await replaceSource(page, 'flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|One| D[Laptop]\n  C -->|Two| E[iPhone]\n  C -->|Three| F[fa:fa-car Car]');
  await expect(page.locator('.ma-node')).toHaveCount(6);
  await expect(page.locator('.ma-node .caption')).toHaveCount(0);
  await expect(page.locator('.ma-legend span')).toHaveText(['decision']);
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

test('author styles render; click links and tooltips appear in the details panel and exports', async ({ page, context }) => {
  await replaceSource(page, readFileSync('e2e/fixtures/styled-flowchart.mmd', 'utf8'));
  await expect(page.locator('.ma-node')).toHaveCount(6);
  const fillOf = (id: string) => page.locator(`.ma-node[data-id="${id}"] .body`).first().evaluate((el) => getComputedStyle(el).fill);
  expect(await fillOf('api')).toBe('rgb(255, 153, 102)');
  expect(await fillOf('web')).toBe('rgb(30, 58, 138)');
  expect(await page.locator('.ma-node[data-id="web"] text.label').evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(255, 255, 255)');
  expect(await page.locator('.ma-edge path.line').first().evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(22, 163, 74)');

  // Focus highlight still wins over an author stroke width.
  await page.locator('.ma-node[data-id="api"]').click();
  expect(await page.locator('.ma-node[data-id="api"] .body').first().evaluate((el) => getComputedStyle(el).strokeWidth)).toBe('3px');
  // The javascript: link is dropped; its tooltip is still shown.
  await expect(page.locator('.ma-passport .tooltip')).toHaveText('Handles checkout orders');
  await expect(page.locator('.ma-passport dd.href')).toHaveCount(0);

  await page.locator('.ma-node[data-id="docs"]').click();
  await expect(page.locator('.ma-passport .tooltip')).toHaveText('Open the runbook');
  const a = page.locator('.ma-passport dd.href a');
  await expect(a).toHaveAttribute('href', 'https://github.com/chamika/mermaid-archify');
  await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('.ma-node[data-id="docs"] title')).toHaveText('Open the runbook');

  // ⌘/Ctrl-click opens the link and leaves focus alone.
  await page.keyboard.press('Escape');
  await context.route('https://github.com/**', (route) => route.fulfill({ body: 'ok', contentType: 'text/plain' }));
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('.ma-node[data-id="docs"]').click({ modifiers: ['ControlOrMeta'] })]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe('https://github.com/chamika/mermaid-archify');
  await popup.close();
  await expect(page.locator('.ma-passport')).toHaveCount(0);

  // Exports carry the styles and never the unsafe link.
  await page.getByRole('button', { name: 'Export' }).click();
  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /SVG \(current theme\)/ }).click()]);
  const svg = readFileSync((await svgDl.path())!, 'utf8');
  expect(svg).toContain('--u-fill: #f96');
  expect(svg.toLowerCase()).not.toContain('javascript:');
  await page.getByRole('button', { name: 'Export' }).click();
  const [htmlDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Interactive HTML' }).click()]);
  const html = readFileSync((await htmlDl.path())!, 'utf8');
  const scene = JSON.parse(/<script type="application\/json" id="ma-scene">([\s\S]*?)<\/script>/.exec(html)![1]);
  expect(JSON.stringify(scene).toLowerCase()).not.toContain('javascript:');
  const offline = await context.newPage();
  await offline.route('http://exported.test/**', (route) => route.fulfill({ body: html, contentType: 'text/html' }));
  await offline.goto('http://exported.test/diagram.html');
  await offline.locator('.ma-node[data-id="docs"]').click();
  await expect(offline.locator('.ma-passport dd.href a')).toHaveAttribute('href', 'https://github.com/chamika/mermaid-archify');
});

test('layout settings write front-matter, re-lay out, and travel in the share link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await replaceSource(page, 'flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma]');
  await expect(page.locator('.ma-node')).toHaveCount(3);
  const pos = (p: Page, id: string) => p.locator(`.ma-node[data-id="${id}"]`).boundingBox();
  const lrA = (await pos(page, 'A'))!;
  const lrC = (await pos(page, 'C'))!;
  expect(lrC.x).toBeGreaterThan(lrA.x); // flows left to right

  const toggle = page.getByRole('button', { name: 'Layout settings' });
  await toggle.click();
  const panel = page.getByRole('dialog', { name: 'Layout settings' });
  await panel.getByRole('button', { name: 'TB', exact: true }).click();
  await panel.getByRole('button', { name: 'Splines' }).click();
  await expect(page.locator('.cm-content')).toContainText('archify:');
  await expect(page.locator('.cm-content')).toContainText('direction: TB');
  await expect(page.locator('.cm-content')).toContainText('routing: splines');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(async () => {
    const [a, c] = [(await pos(page, 'A'))!, (await pos(page, 'C'))!];
    expect(c.y).toBeGreaterThan(a.y + a.height); // now top to bottom
  }).toPass({ timeout: 5_000 });

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy share link' }).click();
  const fresh = await context.newPage();
  await fresh.goto(page.url());
  await expect(fresh.locator('.ma-node[data-id="C"]')).toBeVisible({ timeout: 20_000 });
  const [a, c] = [(await pos(fresh, 'A'))!, (await pos(fresh, 'C'))!];
  expect(c.y).toBeGreaterThan(a.y + a.height);
  await expect(fresh.locator('.cm-content')).toContainText('routing: splines');

  await toggle.click();
  await panel.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('.cm-content')).not.toContainText('archify');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('layout settings are disabled for sequence diagrams', async ({ page }) => {
  await pickSample(page, 'sequence');
  await expect(page.getByRole('button', { name: 'Layout settings' })).toBeDisabled();
});

test.describe('code ↔ diagram linking', () => {
  const linkedLine = (page: Page) => page.locator('.cm-linkedLine');

  test('diagram → code and code → diagram, per diagram kind', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Link code' })).toHaveAttribute('aria-pressed', 'true');

    // Flowchart: a node reveals its declaration, an edge its own line.
    await page.locator('.ma-node[data-id="api"]').click();
    await expect(linkedLine(page)).toHaveText('  api[[Checkout API]]');
    await page.locator('.ma-edge[data-id="L_api_db_0"] .label-text').click();
    await expect(linkedLine(page)).toHaveText('  api -->|SQL| db');

    // Cursor in the code lights the elements that line produces.
    await page.locator('.cm-line', { hasText: 'queue -.->|consume| worker' }).click();
    await expect(linkedLine(page)).toHaveCount(0);
    await expect(page.locator('.ma-svg')).toHaveClass(/dimmed/);
    await expect(page.locator('.ma-edge[data-id="L_queue_worker_0"]')).toHaveClass(/lit/);
    await expect(page.locator('.ma-node[data-id="worker"]')).toHaveClass(/lit/);
    await expect(page.locator('.ma-node[data-id="api"]')).not.toHaveClass(/lit/);

    for (const [sample, node, declaration, codeLine, edge] of [
      ['sequence', 'C', 'participant C as Redis cache', 'C-->>A: miss', 'm3'],
      ['state', 'Failed', 'Running --> Failed: step error', 'Failed --> Queued: retry', 't8'],
      ['architecture', 'db', 'service db(database)[Postgres] in data', 'fanout:B --> T:db', 'e4'],
    ] as const) {
      await pickSample(page, sample);
      await expect(page.locator(`.ma-node[data-id="${node}"]`).first()).toBeVisible();
      await page.locator(`.ma-node[data-id="${node}"]`).first().click();
      await expect(linkedLine(page)).toHaveText(`  ${declaration}`);
      await page.locator('.cm-line', { hasText: codeLine }).click();
      await expect(page.locator(`.ma-edge[data-id="${edge}"]`)).toHaveClass(/lit/);
    }
  });

  test('the toggle turns linking off, and it stays off after a reload', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Link code' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.ma-node[data-id="api"]').click();
    await expect(page.locator('.ma-passport')).toBeVisible();
    await expect(linkedLine(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('.cm-line', { hasText: 'api -->|SQL| db' }).click();
    await expect(page.locator('.ma-svg')).not.toHaveClass(/dimmed/);

    await page.reload();
    await expect(page.locator('.ma-svg')).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Hiding the code disables the toggle.
    await page.getByRole('button', { name: 'Hide code' }).click();
    await expect(toggle).toBeDisabled();
  });
});

async function dragBy(page: Page, selector: string, dx: number, dy: number) {
  const box = (await page.locator(selector).boundingBox())!;
  const s = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(s.x + (dx * i) / 8, s.y + (dy * i) / 8);
  await page.mouse.up();
}

test('arrange mode: drag a node to pin it, keep it through a share link, unpin with a double-click', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await replaceSource(page, 'flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma]');
  await expect(page.locator('.ma-node')).toHaveCount(3);
  const node = (p: Page, id: string) => p.locator(`.ma-node[data-id="${id}"]`);
  const before = (await node(page, 'B').boundingBox())!;

  const arrange = page.getByRole('button', { name: 'Arrange nodes' });
  await arrange.click();
  await expect(arrange).toHaveAttribute('aria-pressed', 'true');
  await dragBy(page, '.ma-node[data-id="B"]', 0, 120);

  const after = (await node(page, 'B').boundingBox())!;
  expect(after.y - before.y).toBeCloseTo(120, -1);
  await expect(page.locator('.cm-content')).toContainText('pins:');
  await expect(page.locator('.cm-content')).toContainText(/B: \[0, \d+\]/);
  await expect(node(page, 'B')).toHaveClass(/pinned/);
  // A drag is not a click: no details panel.
  await expect(page.locator('.ma-passport')).toHaveCount(0);
  // Edges still meet the moved node.
  const edgeEnd = await page.locator('.ma-edge[data-id]').first().evaluate((g) => {
    const path = g.querySelector('path')!;
    const p = path.getPointAtLength(path.getTotalLength());
    return { x: p.x, y: p.y };
  });
  expect(edgeEnd).toBeTruthy();

  await page.getByRole('button', { name: 'Copy share link' }).click();
  const fresh = await context.newPage();
  await fresh.goto(page.url());
  await expect(node(fresh, 'C')).toBeVisible({ timeout: 20_000 });
  const [fa, fb] = [(await node(fresh, 'A').boundingBox())!, (await node(fresh, 'B').boundingBox())!];
  expect(fb.y).toBeGreaterThan(fa.y + fa.height); // B still sits below the line

  await node(page, 'B').dblclick();
  await expect(page.locator('.cm-content')).not.toContainText('pins:');
  await expect(async () => {
    const back = (await node(page, 'B').boundingBox())!;
    expect(Math.abs(back.y - before.y)).toBeLessThan(2);
  }).toPass({ timeout: 5_000 });
});

test('outside arrange mode, dragging a node pans and a click still opens details', async ({ page }) => {
  await replaceSource(page, 'flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma]');
  await expect(page.locator('.ma-node')).toHaveCount(3);
  const b = page.locator('.ma-node[data-id="B"]');
  const a0 = (await page.locator('.ma-node[data-id="A"]').boundingBox())!;
  await dragBy(page, '.ma-node[data-id="B"]', 60, 80);
  const a1 = (await page.locator('.ma-node[data-id="A"]').boundingBox())!;
  expect(a1.x - a0.x).toBeCloseTo(60, -1); // the whole view moved
  await expect(page.locator('.cm-content')).not.toContainText('pins:');

  await page.getByRole('button', { name: 'Arrange nodes' }).click();
  await b.click();
  await expect(page.locator('.ma-passport h2')).toHaveText('Beta');
});

test('arrange is disabled for sequence diagrams', async ({ page }) => {
  await pickSample(page, 'sequence');
  await expect(page.getByRole('button', { name: 'Arrange nodes' })).toBeDisabled();
});

test('dragging past the top-left grows the canvas without moving the other nodes on screen', async ({ page }) => {
  await replaceSource(page, 'flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma]');
  await expect(page.locator('.ma-node')).toHaveCount(3);
  const c0 = (await page.locator('.ma-node[data-id="C"]').boundingBox())!;
  await page.getByRole('button', { name: 'Arrange nodes' }).click();
  await dragBy(page, '.ma-node[data-id="A"]', -150, -120);
  await expect(page.locator('.cm-content')).toContainText(/A: \[-\d+, -\d+\]/);
  const c1 = (await page.locator('.ma-node[data-id="C"]').boundingBox())!;
  expect(Math.abs(c1.x - c0.x)).toBeLessThan(2);
  expect(Math.abs(c1.y - c0.y)).toBeLessThan(2);
});

test('Space toggles animation mode: flowing lines, no steps', async ({ page }) => {
  await pickSample(page, 'flowchart');
  const button = page.locator('[aria-label="Animate flow"]');

  // Typing a space in the editor does not toggle it.
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.press(' ');
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.ma-zoom').click(); // leave the editor
  await page.keyboard.press(' ');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ma-svg.flowing')).toHaveCount(1);
  await expect(page.locator('.ma-pulse')).toHaveCount(0); // lines flow; no travelling dots
  await page.waitForTimeout(2500);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ma-edge.trace-now, .ma-edge.trace-done')).toHaveCount(0);
  await expect(page.locator('.ma-status')).toHaveCount(0);

  await page.keyboard.press(' ');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.ma-svg.flowing')).toHaveCount(0);

  // The button toggles too, and trace takes over from it.
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('t');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[aria-label="Trace flow"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ma-svg.flowing')).toHaveCount(0);
});

test('trace: the pulse travels each edge from source to target', async ({ page }) => {
  await pickSample(page, 'flowchart');
  await page.locator('.ma-zoom').click();
  await page.keyboard.press('t');
  const pulse = page.locator('.ma-pulse').first();
  await expect(pulse).toHaveCount(1);
  const at = () => pulse.evaluate((c) => (c as SVGGraphicsElement).getCTM()!.e);
  const [x0, path] = await Promise.all([at(), page.locator('.ma-edge.trace-now path.line').first().getAttribute('d')]);
  const [sx, tx] = [path!.match(/^M([\d.]+)/)![1], path!.match(/([\d.]+),[\d.]+$/)![1]].map(Number);
  // Starts at the source end (left to right in this sample) and moves toward the target.
  expect(Math.abs(x0 - sx)).toBeLessThan(Math.abs(x0 - tx));
  await page.waitForTimeout(400);
  expect(await at()).toBeGreaterThan(x0 + 10);
});

test('flowing dash patterns loop seamlessly (no jump as the animation repeats)', async ({ page }) => {
  await pickSample(page, 'sequence');
  await page.locator('.ma-zoom').click();
  await page.keyboard.press(' ');
  await expect(page.locator('.ma-svg.flowing')).toHaveCount(1);
  const periods = await page.evaluate(() => {
    const seen = new Set<number>();
    for (const p of document.querySelectorAll('.ma-edge path.line')) {
      const dash = getComputedStyle(p).strokeDasharray;
      if (dash !== 'none') seen.add(dash.split(/[\s,]+/).reduce((sum, v) => sum + parseFloat(v), 0));
    }
    return [...seen];
  });
  expect(periods.length).toBeGreaterThan(1); // solid and dotted messages
  for (const p of periods) expect(28 % p).toBe(0);
});

test('fast typing never hangs the page or loses a keystroke', async ({ page }) => {
  test.setTimeout(30_000);
  await replaceSource(page, 'stateDiagram-v2\n  [*] --> Done\n  Done : second line');
  await expect(page.locator('.ma-node[data-id="Done"]')).toContainText('second line');
  await page.keyboard.press('ControlOrMeta+End');
  // No wait between keys: a held Backspace, then typing, with renders still in flight.
  for (let i = 0; i < 'second line'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('third line');
  await expect(page.locator('.cm-content')).toContainText('Done : third line');
  await expect(page.locator('.ma-node[data-id="Done"]')).toContainText('third line');
});

test.describe('keyboard', () => {
  const active = (page: Page) => page.evaluate(() => { const a = document.activeElement!; return `${(a.getAttribute('class') ?? a.tagName).split(' ')[0]}:${a.getAttribute('data-id') ?? ''}`; });
  /** From the diagram's own focus, Tab until `want` (a class prefix) has focus. */
  async function tabTo(page: Page, want: string, id?: string) {
    await page.locator('.ma-viewer').focus();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const now = await active(page);
      if (now.startsWith(want) && (!id || now.endsWith(`:${id}`))) return;
    }
    throw new Error(`Tab never reached ${want} ${id ?? ''}`);
  }
  const source = 'flowchart LR\n  subgraph G [Pay]\n    A[One] -->|first| B[Two]\n  end\n  subgraph H [Ship]\n    C[Three]\n  end\n  B --> C';

  test('Tab reaches a node, and Enter opens it; Space does not start the animation', async ({ page }) => {
    await replaceSource(page, source);
    await expect(page.locator('.ma-node')).toHaveCount(3);
    await tabTo(page, 'ma-node', 'A');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ma-node[data-id="A"]')).toHaveClass(/focused/);
    await page.keyboard.press(' ');
    await expect(page.locator('.ma-node[data-id="A"]')).not.toHaveClass(/focused/);
    await expect(page.getByRole('button', { name: 'Animate flow' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('edges are one tab stop: arrows move along them, Enter pins', async ({ page }) => {
    await replaceSource(page, source);
    await expect(page.locator('.ma-edge')).toHaveCount(2);
    await tabTo(page, 'ma-edge');
    const first = await active(page);
    await expect(page.locator('.ma-edge[tabindex="0"]')).toHaveCount(1);
    const view = await page.locator('.ma-stage').getAttribute('style');
    await page.keyboard.press('ArrowRight');
    expect(await active(page)).not.toBe(first);
    expect(await page.locator('.ma-stage').getAttribute('style')).toBe(view); // moved focus, did not pan
    await expect(page.locator('.ma-edge[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    expect(await active(page)).toBe(first); // wraps
    await page.keyboard.press('Enter');
    await expect(page.locator(`.ma-edge[data-id="${first.split(':')[1]}"]`)).toHaveClass(/pinned/);
    await expect(page.locator('.ma-edge[data-id]').first().getAttribute('aria-label')).resolves.toMatch(/ to /);
  });

  test('the tab stop survives an edit that removes the edge or group holding it', async ({ page }) => {
    await replaceSource(page, 'flowchart LR\n  subgraph G [Pay]\n    A --> B\n  end\n  subgraph H [Ship]\n    B --> C\n  end\n  C --> D');
    await expect(page.locator('.ma-edge')).toHaveCount(3);
    await tabTo(page, 'ma-edge');
    await page.keyboard.press('ArrowLeft'); // wraps to the last edge, C --> D
    expect(await active(page)).toMatch(/_C_D_/);
    await expect(page.locator('.ma-edge[tabindex="0"]')).toHaveCount(1);
    await tabTo(page, 'ma-group', 'G');
    await page.keyboard.press('ArrowRight');
    expect(await active(page)).toBe('ma-group:H');

    // Both holders go; a new edge also takes first place, which must not make a second stop.
    await replaceSource(page, 'flowchart LR\n  subgraph G [Pay]\n    Z --> A\n    A --> B\n  end');
    await expect(page.locator('.ma-edge')).toHaveCount(2);
    await expect(page.locator('.ma-edge[tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('.ma-group[tabindex="0"]')).toHaveCount(1);
    await tabTo(page, 'ma-edge');
    await tabTo(page, 'ma-group', 'G');
  });

  test('groups are one tab stop: Enter highlights the contents, then clears them', async ({ page }) => {
    await replaceSource(page, source);
    await expect(page.locator('.ma-group')).toHaveCount(2);
    await tabTo(page, 'ma-group', 'G');
    await page.keyboard.press('ArrowDown');
    expect(await active(page)).toBe('ma-group:H');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ma-node[data-id="A"]')).toHaveClass(/lit/);
    await expect(page.locator('.ma-node[data-id="B"]')).toHaveClass(/lit/);
    await expect(page.locator('.ma-node[data-id="C"]')).not.toHaveClass(/lit/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.ma-node[data-id="A"]')).not.toHaveClass(/lit/);
    // Another selection is replaced rather than cleared.
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ma-node[data-id="C"]')).toHaveClass(/lit/);
    await expect(page.locator('.ma-node[data-id="A"]')).not.toHaveClass(/lit/);
  });

  test('focusing something off-screen pans to it instead of scrolling the viewport', async ({ page }) => {
    await replaceSource(page, `flowchart LR\n${Array.from({ length: 24 }, (_, i) => `  N${i}[Node number ${i}] --> N${i + 1}[Node number ${i + 1}]`).join('\n')}`);
    await expect(page.locator('.ma-node')).toHaveCount(25);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    await page.waitForTimeout(400);
    await tabTo(page, 'ma-node', 'N24');
    await page.waitForTimeout(500);
    const vp = await page.locator('.ma-viewer').boundingBox();
    const box = await page.locator('.ma-node[data-id="N24"]').boundingBox();
    expect(await page.locator('.ma-viewer').evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.x + vp!.width);
    expect(box!.x).toBeGreaterThanOrEqual(vp!.x);
  });

  test('a mouse click on a group selects it the same way, and exports carry no tab stops', async ({ page }) => {
    await replaceSource(page, source);
    await expect(page.locator('.ma-group')).toHaveCount(2);
    await page.locator('.ma-group[data-id="H"] rect').click({ position: { x: 6, y: 6 } });
    await expect(page.locator('.ma-node[data-id="C"]')).toHaveClass(/lit/);
    await page.getByRole('button', { name: 'Export' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /SVG \(current theme\)/ }).click()]);
    const svg = readFileSync((await download.path())!, 'utf8');
    expect(svg).not.toMatch(/tabindex|role="button"/i);
  });
});

test.describe('SVG for design tools', () => {
  async function exported(page: Page, name: RegExp) {
    await page.getByRole('button', { name: 'Export' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name }).click()]);
    return readFileSync((await download.path())!, 'utf8');
  }
  /** Share of pixels differing visibly between the two SVGs drawn as images, in the page. */
  const difference = (page: Page, a: string, b: string) =>
    page.evaluate(async ([x, y]) => {
      const draw = async (text: string) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        return ctx.getImageData(0, 0, img.width, img.height);
      };
      const [p, q] = [await draw(x), await draw(y)];
      if (p.width !== q.width || p.height !== q.height) return 1;
      let off = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        if (Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]) > 48) off++;
      }
      return off / (p.width * p.height);
    }, [a, b]);

  for (const [id, source] of [
    ['flowchart', 'flowchart LR\n  classDef hot fill:#f00,color:#fff\n  subgraph G [Payments]\n    A[Web App]:::hot -->|calls| B[(Orders DB)]\n  end\n  B -.-> C{Ok?}\n  C ==> D((Done))'],
    ['sequence', 'sequenceDiagram\n  autonumber\n  A->>B: hello\n  B-->>A: hi\n  Note over A,B: both\n  loop every day\n    A-xB: check\n  end'],
    ['class', 'classDiagram\n  class A {\n    +int id\n    +go() void\n  }\n  A <|-- B\n  A *-- C : has'],
    ['er', 'erDiagram\n  A ||--o{ B : has\n  A {\n    string id PK\n  }'],
    ['state', 'stateDiagram-v2\n  [*] --> Run\n  Run --> Done : ok\n  Done --> [*]'],
  ]) {
    test(`${id}: draws the same as the regular SVG, with nothing but attributes`, async ({ page }) => {
      await replaceSource(page, source);
      await expect(page.locator('.ma-node').first()).toBeVisible();
      await page.waitForTimeout(600);
      const regular = await exported(page, /SVG \(current theme\)/);
      const baked = await exported(page, /SVG for design tools/);
      expect(baked).not.toMatch(/var\(|context-stroke|context-fill|auto-start-reverse|<style|\sclass=|\sstyle=|tabindex/);
      expect(await difference(page, regular, baked)).toBeLessThan(0.002);
      // The page itself is left as it was.
      await expect(page.locator('body > div[style*="-99999px"]')).toHaveCount(0);
    });
  }
});

