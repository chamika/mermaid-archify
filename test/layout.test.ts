import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { layout } from '../src/layout';
import { parseMermaid } from '../src/parse';
import type { Scene } from '../src/scene/types';
import { checkScene, overlaps } from './helpers/invariants';

const elk = new ELK();
const sample = (name: string) => readFileSync(`${process.cwd()}/src/samples/${name}.mmd`, 'utf8');
const scene = async (src: string) => layout(await parseMermaid(src), elk);

const checkInvariants = (s: Scene) => checkScene(s);

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

test('invisible links steer layout but are not drawn', async () => {
  const s = await scene('flowchart LR\n  A ~~~ B');
  expect(s.edges).toHaveLength(0);
  const [a, b] = s.nodes;
  expect(b.x).toBeGreaterThan(a.x + a.w); // placed side by side, as Mermaid does
});

test('circle and cross edge ends carry their marker style', async () => {
  const s = await scene('flowchart LR\n  A --o B\n  B --x C\n  C o--o D');
  expect(s.edges.map((e) => [e.arrowStyle, e.arrowStart])).toEqual([
    ['circle', false],
    ['cross', false],
    ['circle', true],
  ]);
});

test('two-state cycles follow the authored entry, even inside concurrent regions', async () => {
  const s = await scene(
    'stateDiagram-v2\n  state Active {\n    [*] --> Off\n    Off --> On : press\n    On --> Off : press\n    --\n    [*] --> Low\n    Low --> High\n    High --> Low\n  }',
  );
  const y = (id: string) => s.nodes.find((n) => n.id === id)!.y;
  expect(y('Off')).toBeLessThan(y('On'));
  expect(y('Low')).toBeLessThan(y('High'));
  // Reversed-for-layout edges still point the authored way.
  const back = s.edges.find((e) => e.from === 'On' && e.to === 'Off')!;
  expect(back.points[0].y).toBeGreaterThan(back.points.at(-1)!.y);
});

test('plain nodes are sized without a caption row', async () => {
  const plain = await scene('flowchart LR\n  A[Laptop] --> B[iPhone] --> C[Car]');
  const typed = await scene('flowchart LR\n  A[(Laptop)]:::database');
  expect(plain.nodes[0].type).toBe('plain');
  expect(plain.nodes[0].h).toBeLessThan(typed.nodes[0].h);
});

test('an inline icon reserves room in the node width', async () => {
  const without = await scene('flowchart LR\n  A[Readme docs for everyone]');
  const withIcon = await scene('flowchart LR\n  A[fa:fa-book Readme docs for everyone]');
  expect(withIcon.nodes[0].w).toBeGreaterThan(without.nodes[0].w);
  expect(Object.keys(withIcon.icons!)).toEqual(['fa:book']);
});
