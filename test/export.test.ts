import { describe, expect, test } from 'vitest';
import { slug } from '../src/export/download';
import { pngScale } from '../src/export/png';
import { render } from '../src/node';

describe('exports', () => {
  test('file names keep any script, fold accents, and stay short', () => {
    expect(slug('Système de paiement', 'flowchart')).toBe('systeme-de-paiement');
    expect(slug('支付流程', 'sequence')).toBe('支付流程');
    expect(slug('  Checkout: API → DB!  ', 'x')).toBe('checkout-api-db');
    expect(slug('!!!', 'flowchart')).toBe('flowchart');
    expect(slug('a'.repeat(300), 'x')).toHaveLength(80);
  });

  test('PNG scale stays within canvas limits for huge diagrams', () => {
    expect(pngScale(800, 600)).toBe(2);
    const k = pngScale(30192, 116);
    expect(30192 * k).toBeLessThanOrEqual(16_384);
    const big = pngScale(5000, 5000);
    expect(5000 * big * 5000 * big).toBeLessThanOrEqual(16_000_000 + 1);
  });

  test('the HTML export is offline: fonts inline, no remote URLs', async () => {
    const { html } = await render('flowchart LR\n  a --> b');
    expect(html).toContain("@font-face{font-family:'JetBrains Mono'");
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).not.toMatch(/(href|src)="https?:/);
    expect(html).not.toContain('fonts.googleapis.com');
  });
});
