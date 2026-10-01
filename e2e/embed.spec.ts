import { statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Page, expect, test } from '@playwright/test';

/**
 * embed.html: several <mermaid-archify> elements on a page with hostile CSS.
 * Each must stay isolated (styles, keyboard) and follow the host's theme.
 */
const VISIBLE = ['#inline', '#from-src', '#from-scene'];

const embedTheme = (page: Page, id: string) => page.locator(`${id} .ma-embed`).getAttribute('data-theme');
const embedBg = (page: Page, id: string) =>
  page.locator(id).evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector('.ma-viewer')!).backgroundColor);
const zoom = (page: Page, id: string) => page.locator(`${id} .ma-zoom`).textContent();

test.beforeEach(async ({ page }) => {
  await page.goto('/embed.html');
  for (const id of VISIBLE) {
    await page.locator(id).scrollIntoViewIfNeeded();
    await expect(page.locator(`${id} .ma-node`).first()).toBeVisible({ timeout: 20_000 });
  }
  await page.evaluate(() => scrollTo(0, 0));
});

test('renders each content source', async ({ page }) => {
  await expect(page.locator('#inline .ma-node')).toHaveCount(5);
  await expect(page.locator('#from-src .ma-node').first()).toBeVisible();
  await expect(page.locator('#from-scene .ma-node').first()).toBeVisible();
  // Each element has its own shadow root and its own viewer.
  for (const id of VISIBLE) expect(await page.locator(id).evaluate((el) => el.shadowRoot!.querySelectorAll('.ma-viewer').length)).toBe(1);
  // Nothing leaks into the document.
  expect(await page.evaluate(() => document.getElementById('ma-viewer-css'))).toBeNull();
});

test('host CSS does not reach the diagram', async ({ page }) => {
  const styles = await page.locator('#inline').evaluate((el) => {
    const root = el.shadowRoot!;
    const body = root.querySelector('.ma-node .body')!;
    const btn = root.querySelector('.ma-toolbar button')!;
    const viewer = root.querySelector('.ma-viewer')!;
    return {
      stroke: getComputedStyle(body).stroke,
      btnBg: getComputedStyle(btn).backgroundColor,
      font: getComputedStyle(viewer).fontFamily,
      lineHeight: getComputedStyle(viewer).lineHeight,
      color: getComputedStyle(viewer).color,
    };
  });
  expect(styles.stroke).not.toBe('rgb(0, 255, 0)');
  expect(styles.btnBg).not.toBe('rgb(255, 165, 0)');
  expect(styles.font).toContain('monospace');
  expect(styles.font).not.toContain('Georgia');
  expect(styles.color).not.toBe('rgb(225, 29, 72)');
});

test('keyboard shortcuts only reach the focused diagram', async ({ page }) => {
  const before = { inline: await zoom(page, '#inline'), src: await zoom(page, '#from-src') };
  // Nothing focused: page keys do nothing to any diagram.
  await page.locator('h1').click();
  await page.keyboard.press('+');
  await page.keyboard.press('/');
  expect(await zoom(page, '#inline')).toBe(before.inline);
  expect(await zoom(page, '#from-src')).toBe(before.src);
  await expect(page.locator('.ma-finder')).toHaveCount(0);

  // Focus the first diagram's canvas: only it zooms and opens its finder.
  const box = (await page.locator('#inline').boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await page.keyboard.press('+');
  await expect.poll(() => zoom(page, '#inline')).not.toBe(before.inline);
  expect(await zoom(page, '#from-src')).toBe(before.src);
  await page.keyboard.press('/');
  await expect(page.locator('#inline .ma-finder')).toBeVisible();
  await expect(page.locator('#from-src .ma-finder')).toHaveCount(0);
});

test('the wheel scrolls the page until a diagram is focused', async ({ page }) => {
  const box = (await page.locator('#from-src').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const y = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y);
});

test('theme follows the host page, unless pinned by the attribute', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => embedTheme(page, '#inline')).toBe('light');
  expect(await embedBg(page, '#inline')).toBe('rgb(248, 250, 252)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => embedTheme(page, '#inline')).toBe('dark');
  expect(await embedBg(page, '#inline')).toBe('rgb(2, 6, 23)');

  // <html data-theme> (Docusaurus) beats the OS preference; <html class="dark"> (VitePress) too.
  await page.locator('#theme').selectOption('light');
  await expect.poll(() => embedTheme(page, '#from-src')).toBe('light');
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
    document.documentElement.className = 'dark';
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => embedTheme(page, '#from-src')).toBe('dark');

  // theme="light" is fixed whatever the page does.
  expect(await embedTheme(page, '#from-scene')).toBe('light');
  // The page's own theme is never written by an embed.
  await page.locator('#inline .ma-btn[aria-label="Toggle theme"]').click();
  await expect.poll(() => embedTheme(page, '#inline')).toBe('light');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  expect(await embedTheme(page, '#from-src')).toBe('dark');
});

test('controls="false" hides the chrome', async ({ page }) => {
  await expect(page.locator('#from-scene .ma-toolbar')).toBeHidden();
  await expect(page.locator('#from-scene .ma-minimap')).toBeHidden();
  await expect(page.locator('#inline .ma-toolbar')).toBeVisible();
});

test('off-screen diagrams render only when scrolled near', async ({ page }) => {
  expect(await page.locator('#lazy').evaluate((el) => !!el.shadowRoot?.querySelector('svg'))).toBe(false);
  await page.locator('#lazy').scrollIntoViewIfNeeded();
  await expect(page.locator('#lazy .ma-node')).toHaveCount(4, { timeout: 20_000 });
  // <br> inside a text/mermaid script stays Mermaid, not HTML.
  await expect(page.locator('#lazy .ma-node').first()).toContainText('Request');
});

test.describe('pages built with the Markdown plugins', () => {
  const MD = '# Docs\n\n```mermaid\nflowchart LR\n  web[Web app] --> api[API]\n  api --> db[(Postgres)]\n```\n\n```mermaid height=300\nsequenceDiagram\n  A->>B: hi\n```\n';

  /** Serve `html` at /__md/ with the built element next to it; returns the paths requested. */
  async function open(page: Page, html: string): Promise<string[]> {
    const requested: string[] = [];
    await page.route('**/__md/**', (route) => {
      const path = new URL(route.request().url()).pathname.slice('/__md/'.length);
      requested.push(path);
      if (path === 'index.html') return route.fulfill({ contentType: 'text/html', body: html });
      return route.fulfill({ path: join('dist-element', path), contentType: 'text/javascript' });
    });
    await page.goto('/__md/index.html');
    return requested;
  }
  const page = (body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="./mermaid-archify.js"></script></head><body>${body}</body></html>`;

  for (const [name, build] of [
    ['markdown-it', async () => {
      const { default: MarkdownIt } = await import('markdown-it');
      const { default: plugin } = await import(pathToFileURL('dist-node/markdown-it.js').href);
      return new MarkdownIt().use(plugin).render(MD);
    }],
    ['remark', async () => {
      const [{ unified }, { default: remarkParse }, { default: remarkRehype }, { default: rehypeStringify }] = await Promise.all([
        import('unified'), import('remark-parse'), import('remark-rehype'), import('rehype-stringify'),
      ]);
      const { default: plugin } = await import(pathToFileURL('dist-node/remark.js').href);
      return String(await unified().use(remarkParse).use(plugin).use(remarkRehype).use(rehypeStringify).process(MD));
    }],
  ] as const) {
    test(`${name}: diagrams laid out at build time, viewer only at runtime`, async ({ page: p }) => {
      const html = await build();
      expect(html).not.toContain('```');
      const requested = await open(p, page(html));
      const diagrams = p.locator('mermaid-archify');
      await expect(diagrams).toHaveCount(2);
      await expect(diagrams.nth(0).locator('.ma-node')).toHaveCount(3, { timeout: 20_000 });
      await diagrams.nth(1).scrollIntoViewIfNeeded();
      await expect(diagrams.nth(1).locator('.ma-node')).toHaveCount(4); // two actors, drawn top and bottom
      expect(await diagrams.nth(1).evaluate((el) => el.getBoundingClientRect().height)).toBe(300);
      // Mermaid and ELK live in lazy chunks the page never needs: only the ~90 KB viewer is loaded.
      const bytes = requested.filter((r) => r.endsWith('.js')).reduce((sum, r) => sum + statSync(join('dist-element', r)).size, 0);
      expect(bytes).toBeLessThan(120_000);
    });
  }
});
