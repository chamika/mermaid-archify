import { readdirSync, readFileSync } from 'node:fs';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { describeIcons } from '../src/icons/fa';
import type { DiagramIR } from '../src/ir/types';
import { layout } from '../src/layout';
import { toElkGraph } from '../src/layout/elkGraph';
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
    // Palette tints never reach a diagram with component types; region tints (#26) only group-free flowcharts.
    const tinted = [...scene.groups, ...scene.nodes, ...scene.edges].filter((b) => b.accent).map((b) => b.id);
    if (scene.nodes.some((n) => n.type !== 'plain')) expect(tinted, 'typed diagrams stay neutral').toEqual([]);
    if (!scene.groups.length && scene.kind !== 'flowchart') expect(tinted).toEqual([]);
    if (scene.groups.length || scene.kind !== 'flowchart') expect(scene.legend).toBeUndefined();
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

/**
 * ELK's MODEL_ORDER cycle breaker reverses every edge that runs against model
 * order, so the order we hand it must agree with the layout edges: between
 * siblings, a source always comes before its target (#24).
 */
const flows = graphs.filter((f) => !f.split('/')[1].startsWith('architecture')); // sides, not flow
test.each(flows)('%s: model order agrees with the layout edges', async (name) => {
  const { graph } = toElkGraph(await parseMermaid(read(name)));
  const where = new Map<string, { parent: string; index: number }>();
  const visit = (n: ElkNode) =>
    (n.children ?? []).forEach((c, index) => {
      where.set(c.id, { parent: n.id, index });
      for (const p of c.ports ?? []) where.set(p.id, { parent: n.id, index });
      visit(c);
    });
  visit(graph);
  const against = (graph.edges ?? []).filter((e) => {
    const [a, b] = [where.get(e.sources[0])!, where.get(e.targets[0])!];
    return a.parent === b.parent && a.index > b.index;
  });
  expect(against.map((e) => e.id)).toEqual([]);
});

/**
 * Pinned nodes: pin the first connected node by a fixed nudge under every
 * router. The pin is either applied or reported as ignored (no room); either
 * way the scene must stay valid.
 */
describe.each<Routing>(['orthogonal', 'polyline', 'splines'])('pinned, routing: %s', (routing) => {
  test.each(graphs)('%s satisfies scene invariants', async (name) => {
    const ir = await parseMermaid(read(name));
    const id = ir.nodes.find((n) => ir.edges.some((e) => !e.invisible && (e.from === n.id || e.to === n.id)))?.id;
    if (!id) return;
    const pins = { [id]: [37, 53] as [number, number] };
    const scene = await layout(ir, elk, { routing, pins });
    expect(scene.nodes).toHaveLength(ir.nodes.length);
    checkScene(scene, `${name} (${routing}, ${id} pinned)`);
  });
});
