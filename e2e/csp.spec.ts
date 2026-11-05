import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

/**
 * The site's response headers (public/_headers, applied by Cloudflare Pages, not
 * by `vite preview`) put on every response here, then the app and the embed page
 * are exercised: any Content-Security-Policy violation fails the test.
 */
function siteHeaders(): Record<string, string> {
  const text = readFileSync('public/_headers', 'utf8');
  const block = /^\/\*\n((?:[ \t]+.+\n?)+)/m.exec(text)![1];
  return Object.fromEntries(block.trim().split('\n').map((l) => l.trim().split(/:\s*(.*)/s).slice(0, 2) as [string, string]));
}

async function withSiteHeaders(page: Page): Promise<string[]> {
  const headers = siteHeaders();
  expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
  await page.route('**/*', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...headers } });
  });
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (v: string) => violations.push(v));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { reportViolation: (v: string) => void }).reportViolation(`${e.violatedDirective} ${e.blockedURI}`),
    ),
  );
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && violations.push(m.text()));
  return violations;
}

test('the app works under the site CSP: edit, layout, focus, theme, exports', async ({ page }) => {
  const violations = await withSiteHeaders(page);
  await page.goto('/');
  await expect(page.locator('.ma-svg')).toBeVisible({ timeout: 20_000 });
  await page.locator('.sample select').selectOption('architecture');
  await expect(page.locator('.ma-node').first()).toBeVisible();
  await page.locator('.ma-node').first().click();
  await expect(page.locator('.ma-passport')).toBeVisible();
  await page.getByRole('button', { name: /theme/i }).first().click();
  for (const name of [/Interactive HTML/, /SVG/, /PNG/]) {
    await page.getByRole('button', { name: 'Export' }).click();
    await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name }).click()]);
  }
  expect(violations).toEqual([]);
});

test('the embed page works under the site CSP, Mermaid source included', async ({ page }) => {
  const violations = await withSiteHeaders(page);
  await page.goto('/embed.html');
  for (const id of ['#inline', '#from-src', '#from-scene']) {
    await page.locator(id).scrollIntoViewIfNeeded();
    await expect(page.locator(`${id} .ma-node`).first()).toBeVisible({ timeout: 20_000 });
  }
  expect(violations).toEqual([]);
});
