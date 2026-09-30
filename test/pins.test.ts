import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import type { DiagramIR } from '../src/ir/types';
import { layout } from '../src/layout';
import { applyPins } from '../src/layout/pins';
import type { LayoutSettings, Routing } from '../src/layout/settings';
import { parseMermaid } from '../src/parse';
import type { Scene } from '../src/scene/types';
import { checkScene, onBoundary } from './helpers/invariants';

const elk = new ELK();
const sample = (name: string) => readFileSync(`${process.cwd()}/src/samples/${name}.mmd`, 'utf8');
const laid = async (src: string, settings: LayoutSettings = {}): Promise<{ ir: DiagramIR; scene: Scene }> => {
  const ir = await parseMermaid(src);
  return { ir, scene: await layout(ir, elk, settings) };
};
const node = (s: Scene, id: string) => s.nodes.find((n) => n.id === id)!;
const group = (s: Scene, id: string) => s.groups.find((g) => g.id === id)!;
const FLOW = sample('architecture-flowchart');

describe('applyPins', () => {
  test.each<Routing>(['orthogonal', 'polyline', 'splines'])('moves the node and re-attaches its edges (%s)', async (routing) => {
    const { ir, scene } = await laid(FLOW, { routing });
    const r = applyPins(scene, { stripe: [0, 140] }, { routing, ir });
    expect(r).toMatchObject({ applied: ['stripe'], ignored: [] });
    // Measured against an unpinned node, so a canvas shift cannot hide the move.
    const rel = (s: Scene) => node(s, 'stripe').y - node(s, 'user').y;
    expect(rel(r.scene) - rel(scene)).toBe(140);
    checkScene(r.scene, routing);
    const e = r.scene.edges.find((x) => x.to === 'stripe')!;
    expect(onBoundary(e.points.at(-1)!, node(r.scene, 'stripe'))).toBe(true);
  });

  test('leaves the input scene untouched', async () => {
    const { ir, scene } = await laid(FLOW);
    const before = JSON.stringify(scene);
    applyPins(scene, { stripe: [0, 140] }, { ir });
    expect(JSON.stringify(scene)).toBe(before);
  });

  test('a pin onto another node is ignored and the scene is unchanged', async () => {
    const { ir, scene } = await laid(FLOW);
    const [a, b] = [node(scene, 'stripe'), node(scene, 'api')];
    const r = applyPins(scene, { stripe: [b.x - a.x, b.y - a.y] }, { ir });
    expect(r).toMatchObject({ applied: [], ignored: ['stripe'] });
    expect(r.scene).toBe(scene);
  });

  test('pins for ids the source no longer has are skipped silently', async () => {
    const { ir, scene } = await laid(FLOW);
    const r = applyPins(scene, { gone: [10, 10] }, { ir });
    expect(r).toMatchObject({ applied: [], ignored: [] });
    expect(r.scene).toBe(scene);
  });

  test('a node pinned past its group grows the group and its ancestors', async () => {
    const src = 'flowchart LR\n  subgraph outer[Outer]\n    subgraph inner[Inner]\n      A --> B\n    end\n  end\n  B --> C';
    const { ir, scene } = await laid(src);
    const r = applyPins(scene, { A: [0, 200] }, { ir });
    expect(r.applied).toEqual(['A']);
    expect(group(r.scene, 'inner').h).toBeGreaterThan(group(scene, 'inner').h);
    expect(group(r.scene, 'outer').h).toBeGreaterThan(group(scene, 'outer').h);
    checkScene(r.scene);
  });

  test('a pin that would push its group into a sibling group is ignored', async () => {
    const src = 'flowchart LR\n  subgraph G1[One]\n    A\n  end\n  subgraph G2[Two]\n    B\n  end\n  A --> B';
    const { ir, scene } = await laid(src);
    const [a, b] = [node(scene, 'A'), node(scene, 'B')];
    const r = applyPins(scene, { A: [b.x - a.x, b.y - a.y + 20] }, { ir });
    expect(r.ignored).toEqual(['A']);
  });

  test('pinning past the top-left shifts the whole canvas', async () => {
    const { ir, scene } = await laid('flowchart LR\n  A --> B --> C');
    const r = applyPins(scene, { A: [-300, -300] }, { ir });
    expect(r.applied).toEqual(['A']);
    const s = r.scene;
    expect(Math.min(...s.nodes.map((n) => n.x))).toBeGreaterThanOrEqual(32);
    expect(Math.min(...s.nodes.map((n) => n.y))).toBeGreaterThanOrEqual(32);
    expect(node(s, 'B').x - node(s, 'A').x).toBe(node(scene, 'B').x - node(scene, 'A').x + 300);
    checkScene(s);
  });

  test('edges not touching or crossing the pinned node keep their routes', async () => {
    const { ir, scene } = await laid(FLOW);
    const r = applyPins(scene, { stripe: [0, 140] }, { ir });
    const untouched = scene.edges.filter((e) => e.from !== 'stripe' && e.to !== 'stripe');
    for (const e of untouched) expect(r.scene.edges.find((x) => x.id === e.id)!.points).toEqual(e.points);
  });

  test('architecture edges keep their authored port sides', async () => {
    const { ir, scene } = await laid(sample('architecture-beta'));
    const r = applyPins(scene, { lb: [0, 90] }, { ir });
    expect(r.applied).toEqual(['lb']);
    checkScene(r.scene);
    const lb = node(r.scene, 'lb');
    const out = r.scene.edges.find((e) => e.from === 'lb' && e.to === 'app')!;
    const inn = r.scene.edges.find((e) => e.from === 'cdn' && e.to === 'lb')!;
    expect(out.points[0].x).toBeCloseTo(lb.x + lb.w, 5); // lb:R
    expect(inn.points.at(-1)!.x).toBeCloseTo(lb.x, 5); // L:lb
  });

  test('is deterministic', async () => {
    const { ir, scene } = await laid(FLOW, { routing: 'splines' });
    const pins = { stripe: [0, 140], queue: [60, -40], user: [-20, 90] } as Record<string, [number, number]>;
    const a = applyPins(scene, pins, { routing: 'splines', ir });
    const b = applyPins(scene, pins, { routing: 'splines', ir });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('layout() with pins', () => {
  test('applies pins from the settings', async () => {
    const plain = await laid(FLOW);
    const pinned = await laid(FLOW, { pins: { stripe: [0, 140] } });
    const rel = (s: Scene) => node(s, 'stripe').y - node(s, 'user').y;
    expect(rel(pinned.scene) - rel(plain.scene)).toBe(140);
  });

  test('sequence diagrams ignore pins', async () => {
    const src = sample('sequence');
    expect((await laid(src, { pins: { Browser: [0, 100] } })).scene).toEqual((await laid(src)).scene);
  });
});
