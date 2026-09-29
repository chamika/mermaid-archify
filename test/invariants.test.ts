import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { layout } from '../src/layout';
import { parseMermaid } from '../src/parse';
import type { Scene } from '../src/scene/types';
import { checkScene } from './helpers/invariants';

/** The corpus relies on checkScene; prove it rejects each kind of defect. */
const elk = new ELK();
const base = async (src = 'flowchart LR\n  subgraph G[Group]\n    A[Alpha] -->|go| B[Beta]\n  end\n  B --> C[Gamma]') =>
  layout(await parseMermaid(src), elk);
const clone = (s: Scene): Scene => JSON.parse(JSON.stringify(s));

describe('checkScene catches', () => {
  test('a valid scene passes', async () => {
    const s = clone(await base());
    expect(() => checkScene(s)).not.toThrow();
  });

  const cases: [string, (s: Scene) => void, RegExp][] = [
    ['overlapping nodes', (s) => Object.assign(s.nodes[1], { x: s.nodes[0].x, y: s.nodes[0].y }), /overlaps/],
    ['a node outside its group', (s) => (s.nodes.find((n) => n.parent)!.x += 2000), /outside/],
    ['a detached edge', (s) => (s.edges[0].points[0] = { x: 1, y: 1 }), /does not start/],
    ['a label covering a node', (s) => (s.edges[0].labelBox = { ...s.nodes[2], w: 20, h: 10 }), /covers node/],
    ['leaked markup', (s) => (s.nodes[0].label = 'a<br/>b'), /leaks markup/],
    ['leaked entity placeholder', (s) => (s.nodes[0].label = 'I ﬂ°°9829¶ß'), /leaks markup/],
    ['a label wider than its box', (s) => (s.nodes[0].lines = ['x'.repeat(80)]), /wider than its box/],
    ['NaN geometry', (s) => (s.nodes[0].x = NaN), /non-finite/],
  ];
  test.each(cases)('%s', async (_, mutate, message) => {
    const s = clone(await base());
    mutate(s);
    expect(() => checkScene(s)).toThrow(message);
  });

  test('a note sticking out of its block', async () => {
    const s = clone(await base('sequenceDiagram\n  loop every minute\n    A->>B: ping\n    Note right of B: hi\n  end'));
    s.seq!.notes[0].x = s.seq!.blocks[0].x - 6;
    expect(() => checkScene(s)).toThrow(/sticks out of block/);
  });

  test('out-of-order sequence messages', async () => {
    const s = clone(await base('sequenceDiagram\n  A->>B: one\n  B->>A: two'));
    s.edges[1].points = s.edges[1].points.map((p) => ({ ...p, y: 0.5 }));
    expect(() => checkScene(s)).toThrow(/out of order|outside the lifelines/);
  });
});
