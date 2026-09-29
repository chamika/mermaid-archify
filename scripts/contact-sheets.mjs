#!/usr/bin/env node
// Tile test-results/corpus-shots/*.png into labelled contact sheets for manual
// visual review: test-results/sheets/sheet-NN.png. Run after `SHOTS=1 npm run e2e:corpus`.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SHOTS = 'test-results/corpus-shots';
const OUT = 'test-results/sheets';
const PER = Number(process.env.PER ?? 20);
const COLS = 5;
mkdirSync(OUT, { recursive: true });
const files = readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } });
for (let i = 0; i < files.length; i += PER) {
  const cells = files
    .slice(i, i + PER)
    .map((f) => `<figure><img src="data:image/png;base64,${readFileSync(`${SHOTS}/${f}`).toString('base64')}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`)
    .join('');
  await page.setContent(`<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(${COLS},1fr);gap:6px;padding:6px}
    figure{margin:0}img{width:100%;display:block;border:1px solid #333}figcaption{color:#ddd;font:14px monospace;padding:2px}</style>${cells}`);
  await page.screenshot({ path: `${OUT}/sheet-${String(i / PER + 1).padStart(2, '0')}.png`, fullPage: true });
}
await browser.close();
console.log(`${Math.ceil(files.length / PER)} sheets in ${OUT}`);
