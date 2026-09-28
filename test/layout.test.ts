import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { layout } from '../src/layout';
import { parseMermaid } from '../src/parse';
import type { Box, Scene } from '../src/scene/types';

const elk = new ELK();
const sample = (name: string) => readFileSync(`${process.cwd()}/src/samples/${name}.mmd`, 'utf8');
const scene = async (src: string) => layout(await parseMermaid(src), elk);

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;

function onBoundary(p: { x: number; y: number }, b: Box, tol = 1.5) {
  const withinX = p.x >= b.x - tol && p.x <= b.x + b.w + tol;
  const withinY = p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  const onV = Math.abs(p.x - b.x) <= tol || Math.abs(p.x - (b.x + b.w)) <= tol;
  const onH = Math.abs(p.y - b.y) <= tol || Math.abs(p.y - (b.y + b.h)) <= tol;
  return withinX && withinY && (onV || onH);
}

function checkInvariants(s: Scene) {
  const nodeBoxes = new Map<string, Box>([...s.nodes, ...s.groups].map((n) => [n.id, n]));
  // No two nodes overlap.
  for (let i = 0; i < s.nodes.length; i++)
    for (let j = i + 1; j < s.nodes.length; j++)
      expect(overlaps(s.nodes[i], s.nodes[j]), `${s.nodes[i].id} overlaps ${s.nodes[j].id}`).toBe(false);
  // Children sit inside their group.
  for (const n of [...s.nodes, ...s.groups])
    if (n.parent) expect(inside(n, nodeBoxes.get(n.parent)!), `${n.id} outside ${n.parent}`).toBe(true);
  // Edge endpoints touch their node boundaries; everything is inside the canvas.
  for (const e of s.edges) {
    expect(e.points.length).toBeGreaterThanOrEqual(2);
    expect(onBoundary(e.points[0], nodeBoxes.get(e.from)!), `${e.id} start`).toBe(true);
    expect(onBoundary(e.points.at(-1)!, nodeBoxes.get(e.to)!), `${e.id} end`).toBe(true);
    for (const p of e.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(s.width);
      expect(p.y).toBeLessThanOrEqual(s.height);
    }
  }
  for (const n of s.nodes) expect(n.x + n.w).toBeLessThanOrEqual(s.width);
}

describe('ELK layout', () => {
  test('flowchart sample', async () => {
    const s = await scene(sample('architecture-flowchart'));
    expect(s.nodes).toHaveLength(11);
    expect(s.edges).toHaveLength(11);
    checkInvariants(s);
    // LR: the shopper is left of the database.
    const x = (id: string) => s.nodes.find((n) => n.id === id)!.x;
    expect(x('user')).toBeLessThan(x('db'));
    expect(s.edges.every((e) => !e.label || e.labelBox)).toBe(true);
  });

  test('state sample: start first, end last', async () => {
    const s = await scene(sample('state'));
    checkInvariants(s);
    const y = (id: string) => s.nodes.find((n) => n.id === id)!.y;
    expect(y('root_start')).toBeLessThan(y('Queued'));
    expect(y('root_end')).toBeGreaterThan(y('Succeeded'));
  });

  test('architecture-beta sample honours port sides', async () => {
    const s = await scene(sample('architecture-beta'));
    checkInvariants(s);
    const cdnToLb = s.edges.find((e) => e.from === 'cdn' && e.to === 'lb')!;
    const cdn = s.nodes.find((n) => n.id === 'cdn')!;
    expect(cdnToLb.points[0].x).toBeCloseTo(cdn.x + cdn.w, 0);
  });

  test('edge to a subgraph', async () => {
    const s = await scene('flowchart TB\n  subgraph G[Group]\n    A\n  end\n  B --> G');
    expect(s.edges[0].to).toBe('G');
    checkInvariants(s);
  });

  test('trace order follows the graph', async () => {
    const s = await scene('flowchart LR\n  A --> B --> C');
    expect(s.edges.map((e) => e.order)).toEqual([0, 1]);
  });
});

describe('sequence layout', () => {
  test('sample', async () => {
    const s = await scene(sample('sequence'));
    const seq = s.seq!;
    expect(seq.lifelines).toHaveLength(5);
    expect(seq.footers).toHaveLength(5);
    expect(seq.blocks).toHaveLength(1);
    expect(seq.blocks[0].sections).toHaveLength(1);
    expect(seq.notes).toHaveLength(1);
    expect(seq.activations).toHaveLength(2);
    // Participants in source order, left to right, no overlap.
    for (let i = 1; i < s.nodes.length; i++) expect(s.nodes[i].x).toBeGreaterThan(s.nodes[i - 1].x + s.nodes[i - 1].w);
    // Messages go strictly downward in order.
    const ys = s.edges.map((e) => e.points[0].y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    // Labels never overlap each other.
    const labels = s.edges.flatMap((e) => (e.labelBox ? [e.labelBox] : []));
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) expect(overlaps(labels[i], labels[j])).toBe(false);
    // Block contains its messages' rows.
    const block = seq.blocks[0];
    const inBlock = s.edges.filter((e) => e.points[0].y > block.y && e.points[0].y < block.y + block.h);
    expect(inBlock.map((e) => e.label)).toEqual(['SELECT cart', 'rows', 'SET cart:42 (ttl 60s)', 'create empty cart']);
    for (const n of [...s.nodes, ...seq.notes, ...seq.blocks]) expect(n.x + n.w).toBeLessThanOrEqual(s.width);
  });

  test('long label widens the gap', async () => {
    const short = await scene('sequenceDiagram\n  A->>B: hi');
    const long = await scene(`sequenceDiagram\n  A->>B: ${'x'.repeat(60)}`);
    const gap = (s: Scene) => s.nodes[1].x - s.nodes[0].x;
    expect(gap(long)).toBeGreaterThan(gap(short));
    const lb = long.edges[0].labelBox!;
    expect(lb.x).toBeGreaterThanOrEqual(long.seq!.lifelines[0].x);
    expect(lb.x + lb.w).toBeLessThanOrEqual(long.seq!.lifelines[1].x);
  });
});

test('retry cycles keep the authored main direction', async () => {
  const s = await scene(sample('state'));
  const y = (id: string) => s.nodes.find((n) => n.id === id)?.y ?? s.groups.find((g) => g.id === id)!.y;
  expect(y('Queued')).toBeLessThan(y('Running'));
  expect(y('Running')).toBeLessThan(y('Failed'));
});
