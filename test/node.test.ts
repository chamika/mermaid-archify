// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MermaidParseError, render } from '../src/node';
import { UsageError, expandInputs, formatFor, globBase, outputPath } from '../src/node/outputs';

/** The headless library, in plain Node: no DOM until `render` installs one. */
describe('render()', () => {
  const flow = 'flowchart LR\n  web[Web app] --> api[API]\n  api --> db[(Postgres)]\n';

  test('returns the scene, a standalone SVG and interactive HTML', async () => {
    const { scene, svg, html } = await render(flow);
    expect(scene.kind).toBe('flowchart');
    expect(scene.nodes.map((n) => n.id).sort()).toEqual(['api', 'db', 'web']);
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true);
    expect(svg).toContain('--bg:#020617');
    expect(svg).toContain('<style>');
    expect(svg).not.toMatch(/tabindex|NaN/i);
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain(JSON.stringify(scene).slice(0, 200));
    expect(html).toContain('<script type="text/plain" id="ma-source">flowchart LR');
  });

  test('light theme', async () => {
    const { svg, html } = await render(flow, { theme: 'light' });
    expect(svg).toContain('--bg:#f8fafc');
    expect(svg).not.toContain('#020617');
    expect(html).toContain('data-theme="light"');
  });

  test('front-matter layout settings apply, and options override them', async () => {
    const withFm = await render(`---\nconfig:\n  archify:\n    direction: TB\n---\n${flow}`);
    const withOpt = await render(flow, { layout: { direction: 'TB' } });
    expect(withFm.scene.nodes).toEqual(withOpt.scene.nodes);
    expect(withOpt.scene.height).toBeGreaterThan(withOpt.scene.width);
    const overridden = await render(`---\nconfig:\n  archify:\n    direction: TB\n---\n${flow}`, { layout: { direction: 'LR' } });
    expect(overridden.scene.width).toBeGreaterThan(overridden.scene.height);
  });

  test('sequence diagrams', async () => {
    const { scene, svg } = await render('sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello\n');
    expect(scene.kind).toBe('sequence');
    expect(svg).toContain('Alice');
  });

  test('parse errors carry a line number', async () => {
    const err = await render('flowchart LR\n  A --> B\n  B -->\n').catch((e) => e);
    expect(err).toBeInstanceOf(MermaidParseError);
    expect(err.line).toBe(3);
  });
});

describe('CLI outputs', () => {
  test('format comes from -o, else --format, else html', () => {
    expect(formatFor({})).toBe('html');
    expect(formatFor({ format: 'SVG' })).toBe('svg');
    expect(formatFor({ out: 'a.svg', format: 'html' })).toBe('svg');
    expect(formatFor({ out: '-', format: 'svg' })).toBe('svg');
    expect(() => formatFor({ out: 'a.png' })).toThrow(/PNG output isn't supported/);
    expect(() => formatFor({ format: 'png' })).toThrow(UsageError);
    expect(() => formatFor({ out: 'a.pdf' })).toThrow(/use .html or .svg/);
  });

  test('glob base is the literal leading directories', () => {
    expect(globBase('docs/**/*.mmd')).toBe('docs');
    expect(globBase('docs/a/*.mmd')).toBe('docs/a');
    expect(globBase('*.mmd')).toBe('.');
  });

  test('output paths', () => {
    const file = { path: 'docs/arch/api.mmd', base: 'docs' };
    expect(outputPath(file, 'html', {})).toBe('docs/arch/api.html');
    expect(outputPath(file, 'svg', { outDir: 'build' })).toBe('build/arch/api.svg');
    expect(outputPath(file, 'svg', { out: 'x.svg' })).toBe('x.svg');
    expect(outputPath({ path: '-', base: '.' }, 'html', {})).toBe('-');
    expect(outputPath({ path: '-', base: '.' }, 'svg', { outDir: 'build' })).toBe('build/diagram.svg');
  });

  test('expands globs relative to their base; files and globs dedupe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ma-cli-'));
    mkdirSync(join(dir, 'docs/a'), { recursive: true });
    for (const f of ['docs/top.mmd', 'docs/a/x.mmd', 'docs/a/notes.txt']) writeFileSync(join(dir, f), 'graph LR\nA-->B\n');
    const inputs = await expandInputs(['docs/**/*.mmd', 'docs/top.mmd'], dir);
    expect(inputs).toEqual([
      { path: 'docs/a/x.mmd', base: 'docs' },
      { path: 'docs/top.mmd', base: 'docs' },
    ]);
    expect(outputPath(inputs[0], 'html', { outDir: 'out' })).toBe('out/a/x.html');
    await expect(expandInputs(['docs/*.nope'], dir)).rejects.toThrow(/No files match/);
    await expect(expandInputs(['missing.mmd'], dir)).rejects.toThrow(/No such file/);
  });
});
