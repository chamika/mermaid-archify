#!/usr/bin/env node
// Refresh test/corpus from the Mermaid repository (MIT): every fenced example in
// the syntax docs and every <pre class="mermaid"> diagram in the demo pages.
// Usage: node scripts/fetch-corpus.mjs [git-ref]
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REF = process.argv[2] ?? 'develop';
const RAW = `https://raw.githubusercontent.com/mermaid-js/mermaid/${REF}`;
const ROOT = new URL('../test/corpus/', import.meta.url).pathname;

const SOURCES = [
  { dir: 'mermaid-docs', prefix: 'flowchart', url: 'packages/mermaid/src/docs/syntax/flowchart.md', kind: 'md' },
  { dir: 'mermaid-docs', prefix: 'sequence', url: 'packages/mermaid/src/docs/syntax/sequenceDiagram.md', kind: 'md' },
  { dir: 'mermaid-docs', prefix: 'state', url: 'packages/mermaid/src/docs/syntax/stateDiagram.md', kind: 'md' },
  { dir: 'mermaid-docs', prefix: 'architecture', url: 'packages/mermaid/src/docs/syntax/architecture.md', kind: 'md' },
  { dir: 'mermaid-demos', prefix: 'flowchart', url: 'demos/flowchart.html', kind: 'html' },
  { dir: 'mermaid-demos', prefix: 'sequence', url: 'demos/sequence.html', kind: 'html' },
  { dir: 'mermaid-demos', prefix: 'state', url: 'demos/state.html', kind: 'html' },
  { dir: 'mermaid-demos', prefix: 'architecture', url: 'demos/architecture.html', kind: 'html' },
];

const unescape = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Strip the common indentation demo pages add inside <pre>. */
function dedent(text) {
  const lines = text.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(indent)).join('\n') + '\n';
}

function extract(kind, body) {
  if (kind === 'md') return [...body.matchAll(/^```mermaid(?:-example)?\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  return [...body.matchAll(/<pre class="mermaid"[^>]*>([\s\S]*?)<\/pre\s*>/g)].map((m) => dedent(unescape(m[1])));
}

for (const dir of new Set(SOURCES.map((s) => s.dir))) {
  mkdirSync(join(ROOT, dir), { recursive: true });
  for (const f of readdirSync(join(ROOT, dir))) if (f.endsWith('.mmd')) rmSync(join(ROOT, dir, f));
}

for (const s of SOURCES) {
  const res = await fetch(`${RAW}/${s.url}`);
  if (!res.ok) throw new Error(`${s.url}: HTTP ${res.status}`);
  const unique = [...new Set(extract(s.kind, await res.text()))];
  unique.forEach((src, i) => writeFileSync(join(ROOT, s.dir, `${s.prefix}-${String(i + 1).padStart(3, '0')}.mmd`), src));
  console.log(`${s.dir}/${s.prefix}: ${unique.length}`);
}
