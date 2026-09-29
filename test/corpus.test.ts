import { readdirSync, readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { describeIcons } from '../src/icons/fa';
import type { DiagramIR } from '../src/ir/types';
import { layout } from '../src/layout';
import type { Routing } from '../src/layout/settings';
import { MermaidParseError, parseMermaid } from '../src/parse';
import { checkScene } from './helpers/invariants';

/**
 * Every diagram from Mermaid's own docs and demo pages (test/corpus, refreshed by
 * scripts/fetch-corpus.mjs) must parse, lay out, and satisfy the scene
 * invariants. Structural summaries are snapshotted, so a Mermaid upgrade that
 * changes what we extract shows up as a reviewable diff.
 */

/** Fixtures Mermaid itself rejects; they must fail cleanly, with a line number. */
const INVALID: Record<string, string> = JSON.parse(readFileSync(`${process.cwd()}/test/corpus/invalid.json`, 'utf8'));

const ROOT = `${process.cwd()}/test/corpus`;
const fixtures = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .flatMap((dir) =>
    readdirSync(`${ROOT}/${dir}`)
      .filter((f) => f.endsWith('.mmd'))
      .map((f) => `${dir}/${f.replace(/\.mmd$/, '')}`),
  )
  .sort();

const elk = new ELK();
const read = (name: string) => readFileSync(`${ROOT}/${name}.mmd`, 'utf8');

function summarize(ir: DiagramIR) {
  const types: Record<string, number> = {};
  for (const n of ir.nodes) types[n.type] = (types[n.type] ?? 0) + 1;
  return {
    kind: ir.kind,
    title: ir.title,
    direction: ir.direction,
    nodes: ir.nodes.map(
      (n) =>
        `${n.id}[${n.shape}${n.parent ? ` in ${n.parent}` : ''}] ${JSON.stringify(describeIcons(n.label))}` +
        (n.annotation ? ` «${n.annotation}»` : '') +
        (n.compartments?.length ? ` {${n.compartments.map((c) => c.rows.map((r) => r.cells.join(' ')).join('; ')).join(' | ')}}` : ''),
    ),
    edges: ir.edges.map(
      (e) =>
        `${e.from} ${e.invisible ? '~~~' : '->'} ${e.to}${e.marker ? ` (${e.marker})` : ''}${e.label ? ` ${JSON.stringify(describeIcons(e.label))}` : ''}` +
        (e.ends ? ` [${e.ends.startLabel ?? ''}${e.ends.start ?? '-'} ${e.stroke} ${e.ends.end ?? '-'}${e.ends.endLabel ?? ''}]` : ''),
    ),
    groups: ir.groups.map((g) => `${g.id}${g.parent ? ` in ${g.parent}` : ''} ${JSON.stringify(describeIcons(g.label))}`),
    ...(ir.icons && { icons: Object.keys(ir.icons).sort() }),
    types,
    events: ir.events?.map((e) => e.kind).join(' '),
  };
}

test('corpus is present and covers every supported kind', () => {
  expect(fixtures.length).toBeGreaterThan(250);
  for (const kind of ['flowchart', 'sequence', 'state', 'architecture', 'er', 'class'])
    expect(fixtures.filter((f) => f.split('/')[1].startsWith(kind)).length, kind).toBeGreaterThanOrEqual(10);
});

describe.each(fixtures)('%s', (name) => {
  const src = read(name);

  if (INVALID[name]) {
    test(`fails cleanly (${INVALID[name]})`, async () => {
      const err = await parseMermaid(src).catch((e) => e);
      expect(err).toBeInstanceOf(MermaidParseError);
      expect(err.line).toBeGreaterThan(0);
      expect(err.message).not.toMatch(/Expecting '/);
    });
    return;
  }

  test('parses, lays out, and satisfies scene invariants', async () => {
    const ir = await parseMermaid(src);
    expect(summarize(ir)).toMatchSnapshot();
    const scene = await layout(ir, elk);
    expect(scene.nodes).toHaveLength(ir.nodes.length);
    expect(scene.edges, 'every visible edge is routed').toHaveLength(ir.edges.filter((e) => !e.invisible).length);
    checkScene(scene, name);
  });
});

/**
 * The same invariants under the other edge routers (the snapshot above covers
 * the default, orthogonal). Sequence diagrams have their own layout.
 */
const ROUTINGS: Routing[] = ['polyline', 'splines'];
const graphs = fixtures.filter((f) => !INVALID[f] && !f.split('/')[1].startsWith('sequence'));

describe.each(ROUTINGS)('routing: %s', (routing) => {
  test.each(graphs)('%s satisfies scene invariants', async (name) => {
    const ir = await parseMermaid(read(name));
    const scene = await layout(ir, elk, { routing });
    expect(scene.edges, 'every visible edge is routed').toHaveLength(ir.edges.filter((e) => !e.invisible).length);
    checkScene(scene, `${name} (${routing})`);
  });
});
