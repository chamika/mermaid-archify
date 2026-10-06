import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { layout } from '../src/layout';
import { textWidth } from '../src/layout/measure';
import { flattenBeziers, toElkGraph } from '../src/layout/elkGraph';
import type { LayoutSettings } from '../src/layout/settings';
import { parseMermaid } from '../src/parse';
import type { Scene } from '../src/scene/types';
import { checkScene, overlaps } from './helpers/invariants';

const elk = new ELK();
const sample = (name: string) => readFileSync(`${process.cwd()}/src/samples/${name}.mmd`, 'utf8');
const scene = async (src: string, settings?: LayoutSettings) => layout(await parseMermaid(src), elk, settings);

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

  test('author styles, links and tooltips reach the scene', async () => {
    const s = await scene(
      'flowchart LR\n  A --> B\n  classDef dark fill:#1e3a8a\n  class A dark\n  style B stroke:red,color:#fff\n  linkStyle 0 stroke:green\n  click A "https://example.com" "Tip"',
    );
    const a = s.nodes.find((n) => n.id === 'A')!;
    // An opaque fill gets contrast-picked ink.
    expect(a).toMatchObject({ style: { fill: '#1e3a8a', color: '#ffffff' }, link: 'https://example.com/', tooltip: 'Tip' });
    // Without a fill, a fixed ink would break one theme, so it is dropped.
    expect(s.nodes.find((n) => n.id === 'B')!.style).toEqual({ stroke: 'red' });
    expect(s.edges[0].style).toEqual({ stroke: 'green' });
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

test('a merge node sits below everything that feeds it, even when mentioned first (#24)', async () => {
  const s = await scene(
    'flowchart TD\n  EQ -- yes --> PO\n  EQ -- no --> KIND\n  KIND --> TD\n  KIND --> PO\n  TD --> PO\n  PO --> SV\n  SV --> MORE\n  MORE -- yes --> EQ',
  );
  const y = (id: string) => s.nodes.find((n) => n.id === id)!.y;
  expect(y('KIND')).toBeLessThan(y('PO'));
  expect(y('TD')).toBeLessThan(y('PO'));
  // Only the loop's closing edge runs upward.
  const up = s.edges.filter((e) => e.points[0].y > e.points.at(-1)!.y).map((e) => `${e.from}->${e.to}`);
  expect(up).toEqual(['MORE->EQ']);
  checkInvariants(s);
});

test('an edge into a subgraph puts its source before the whole group', async () => {
  // The group's children are mentioned first, yet A --> TOP --> B still reads left to right.
  const s = await scene('flowchart LR\n  subgraph TOP\n    i1 --> f1\n  end\n  A --> TOP --> B');
  const box = (id: string) => s.nodes.find((n) => n.id === id) ?? s.groups.find((g) => g.id === id)!;
  const [a, top, b] = ['A', 'TOP', 'B'].map(box);
  expect(a.x + a.w).toBeLessThan(top.x);
  expect(top.x + top.w).toBeLessThan(b.x);
  checkInvariants(s);
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

describe('ER and class layout', () => {
  test('ER sample: compartments sized to their rows, markers on both ends', async () => {
    const s = await scene(sample('er'));
    checkInvariants(s);
    const order = s.nodes.find((n) => n.id === 'ORDER')!;
    expect(order.compartments![0].rows).toHaveLength(4);
    // Title band plus four rows.
    expect(order.h).toBeGreaterThanOrEqual(4 * 18 + 30);
    expect(s.edges.every((e) => e.ends?.start && e.ends?.end)).toBe(true);
  });

  test('class sample: multiplicities sit beside their own end', async () => {
    const s = await scene(sample('class'));
    checkInvariants(s);
    const e = s.edges.find((x) => x.from === 'LineItem' && x.to === 'Order')!;
    expect(e.endLabels!.map((l) => l.text)).toEqual(['1..*', '1']);
    const [start, end] = [e.points[0], e.points.at(-1)!];
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    expect(d(e.endLabels![0], start)).toBeLessThan(d(e.endLabels![0], end));
    expect(d(e.endLabels![1], end)).toBeLessThan(d(e.endLabels![1], start));
  });

  test('long attribute comments are cut to fit, not wrapped', async () => {
    const long = 'x'.repeat(80);
    const s = await scene(`erDiagram\n  A {\n    string name "${long}"\n  }`);
    checkInvariants(s);
    expect(s.nodes[0].w).toBeLessThan(textWidth(long, 12));
  });
});

test('class relations keep their written layout order: parents above children', async () => {
  const s = await scene('classDiagram\n  Animal <|-- Duck\n  Duck --|> Bird');
  const y = (id: string) => s.nodes.find((n) => n.id === id)!.y;
  // Edges still point at the marked end (Duck → Animal) ...
  expect(s.edges[0]).toMatchObject({ from: 'Duck', to: 'Animal' });
  // ... but lay out as written, like Mermaid: Animal first, then Duck, then Bird.
  expect(y('Animal')).toBeLessThan(y('Duck'));
  expect(y('Duck')).toBeLessThan(y('Bird'));
  checkInvariants(s);
});

test.each([
  ['class', 'classDiagram\n  Order ..> Payment\n  Customer o-- Order'],
  ['flowchart', 'flowchart TD\n  Order --> Payment\n  Customer --> Order'],
  ['state', 'stateDiagram-v2\n  Order --> Payment\n  Customer --> Order'],
])('%s layering ignores mention order: only real cycles are reversed', async (_, src) => {
  // Customer is mentioned after Order, yet Customer -> Order still puts Customer first.
  const s = await scene(src);
  const y = (id: string) => s.nodes.find((n) => n.id === id)!.y;
  expect(y('Customer')).toBeLessThan(y('Order'));
  expect(y('Order')).toBeLessThan(y('Payment'));
  checkInvariants(s);
});
describe('layout settings', () => {
  const flow = sample('architecture-flowchart');
  const x = (s: Scene, id: string) => s.nodes.find((n) => n.id === id)!.x;

  test('direction override flips the flow', async () => {
    const s = await scene(flow, { direction: 'RL' });
    checkInvariants(s);
    expect(x(s, 'user')).toBeGreaterThan(x(s, 'db'));
    const tb = await scene(flow, { direction: 'TB' });
    const y = (id: string) => tb.nodes.find((n) => n.id === id)!.y;
    expect(y('user')).toBeLessThan(y('db'));
  });

  test('spacing grows the scene, inside groups too', async () => {
    const base = await scene(flow);
    const roomy = await scene(flow, { nodeSpacing: 120, rankSpacing: 200 });
    checkInvariants(roomy);
    expect(roomy.width).toBeGreaterThan(base.width); // ranks run left to right
    expect(roomy.height).toBeGreaterThan(base.height); // nodes within a rank (here all in groups)
    const gap = (s: Scene) => {
      const [a, b] = ['cache', 'db'].map((id) => s.nodes.find((n) => n.id === id)!);
      return b.y - (a.y + a.h);
    };
    expect(gap(roomy)).toBeGreaterThan(gap(base));
  });

  test('splines are sampled into smooth routes that still attach', async () => {
    const s = await scene(flow, { routing: 'splines' });
    checkInvariants(s);
    expect(s.edges.some((e) => e.points.length > 4)).toBe(true);
    // A diagonal segment exists: not every step is axis-aligned.
    const diagonal = s.edges.some((e) => e.points.some((p, i) => i && p.x !== e.points[i - 1].x && p.y !== e.points[i - 1].y));
    expect(diagonal).toBe(true);
  });

  test('flattenBeziers keeps endpoints and ignores non-cubic chains', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }];
    const out = flattenBeziers(ctrl, 4);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual(ctrl[0]);
    expect(out.at(-1)).toEqual(ctrl[3]);
    expect(flattenBeziers(ctrl.slice(0, 3))).toEqual(ctrl.slice(0, 3));
  });

  test('settings reach the ELK graph', async () => {
    const ir = await parseMermaid(flow);
    const opts = toElkGraph(ir, { routing: 'polyline', placement: 'brandes-koepf', nodeSpacing: 88 }).graph.layoutOptions!;
    expect(opts).toMatchObject({
      'elk.edgeRouting': 'POLYLINE',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.spacing.nodeNode': '88',
      'elk.spacing.edgeNode': '48',
    });
    expect(toElkGraph(ir).graph.layoutOptions).toMatchObject({ 'elk.edgeRouting': 'ORTHOGONAL', 'elk.spacing.nodeNode': '44' });
  });

  test('layout is deterministic for every placement strategy', async () => {
    for (const placement of ['network-simplex', 'brandes-koepf', 'linear-segments', 'simple'] as const) {
      const a = await scene(flow, { placement, routing: 'splines' });
      const b = await scene(flow, { placement, routing: 'splines' });
      checkInvariants(a);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test('sequence diagrams ignore settings', async () => {
    const src = sample('sequence');
    expect(await scene(src, { direction: 'TB', nodeSpacing: 160 })).toEqual(await scene(src));
  });
});

describe('subgraph palette', () => {
  const groups = `graph TB
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph two
    b1-->b2
    subgraph inner
    b3
    end
    end
    subgraph three
    c1-->c2
    end
    loose-->c2`;
  const accent = (s: Scene, id: string) => [...s.nodes, ...s.groups].find((b) => b.id === id)?.accent;
  const edge = (s: Scene, from: string, to: string) => s.edges.find((e) => e.from === from && e.to === to)?.accent;

  test('auto colours an untyped diagram by top-level subgraph, in source order', async () => {
    const s = await scene(groups);
    expect(['one', 'two', 'three'].map((g) => accent(s, g))).toEqual(['tone-0', 'tone-1', 'tone-2']);
    expect(accent(s, 'inner')).toBe('tone-1'); // nested groups keep their top-level hue
    expect(accent(s, 'b3')).toBe('tone-1');
    expect(accent(s, 'a1')).toBe('tone-0');
    expect(accent(s, 'loose')).toBeUndefined(); // outside every subgraph
    expect(edge(s, 'c1', 'a2')).toBe('tone-2'); // edges take their source's hue
    expect(edge(s, 'loose', 'c2')).toBeUndefined();
  });

  test('auto stays neutral when any node has a component type, or there are no subgraphs', async () => {
    const typed = await scene(`${groups}\n    db[(Orders DB)] --> a1`);
    expect(typed.groups.some((g) => g.accent)).toBe(false);
    expect(typed.nodes.some((n) => n.accent)).toBe(false);
    const flat = await scene('graph TB\n  A --> B');
    expect(flat.nodes.some((n) => n.accent) || flat.edges.some((e) => e.accent)).toBe(false);
  });

  test('groups can be forced onto a typed diagram; typed nodes keep their own colour', async () => {
    const s = await scene(`${groups}\n    subgraph four\n    db[(Orders DB)]\n    end`, { palette: 'groups' });
    expect(accent(s, 'four')).toBe('tone-3');
    expect(accent(s, 'db')).toBeUndefined();
  });

  test('depth shades by nesting level only', async () => {
    const s = await scene(groups, { palette: 'depth' });
    expect(accent(s, 'two')).toBe('depth-1');
    expect(accent(s, 'inner')).toBe('depth-2');
    expect(s.nodes.some((n) => n.accent) || s.edges.some((e) => e.accent)).toBe(false);
  });

  test('mono leaves everything neutral; sequence diagrams are untouched', async () => {
    const s = await scene(groups, { palette: 'mono' });
    expect([...s.groups, ...s.nodes, ...s.edges].some((b) => b.accent)).toBe(false);
    const seq = await scene('sequenceDiagram\n  A->>B: hi', { palette: 'groups' });
    expect(seq.nodes.some((n) => n.accent)).toBe(false);
  });
});

describe('region palette', () => {
  const accent = (s: Scene, id: string) => s.nodes.find((n) => n.id === id)?.accent;
  const edge = (s: Scene, from: string, to: string) => s.edges.find((e) => e.from === from && e.to === to)?.accent;
  const legend = (s: Scene) => s.legend?.map((l) => l.label);
  const tinted = (s: Scene) => [...s.groups, ...s.nodes, ...s.edges].some((b) => b.accent) || !!s.legend;
  const [LOOP, DECISION, FAILURE] = ['tone-4', 'tone-2', 'tone-3'];

  test("auto tints #24's loop body, decisions and failure path, with a legend", async () => {
    const s = await scene(readFileSync(`${process.cwd()}/e2e/fixtures/process-regions.mmd`, 'utf8'));
    const by = (tone: string | undefined) => s.nodes.filter((n) => n.accent === tone).map((n) => n.id).sort();
    expect(by(LOOP)).toEqual(['EN', 'EQ', 'KIND', 'LOOP', 'MORE', 'NOP', 'PO', 'RES', 'SV', 'TD', 'TP']);
    expect(by(FAILURE)).toEqual(['FAILOP', 'FR', 'FV', 'RBK']);
    expect(by(DECISION)).toEqual(['SW']); // the other diamonds sit in the loop
    expect(by(undefined)).toEqual(['CM2', 'LV', 'OKR', 'SWI', 'T']);
    expect(edge(s, 'MORE', 'LOOP')).toBe(LOOP); // the back edge closes the coloured circuit
    expect(edge(s, 'PO', 'FAILOP')).toBe(FAILURE); // labelled "exception"
    expect(edge(s, 'CM2', 'FV')).toBe(FAILURE); // labelled "ConstraintViolationException"
    expect(edge(s, 'RBK', 'FR')).toBe(FAILURE);
    expect(edge(s, 'SW', 'LOOP')).toBeUndefined(); // into the loop, not inside it
    expect(edge(s, 'MORE', 'LV')).toBeUndefined();
    expect(legend(s)).toEqual(['loop', 'decision', 'failure path']);
  });

  test('a flow without loops or failures tints only its decisions', async () => {
    const s = await scene('flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|One| D[Laptop]\n  C -->|Two| E[iPhone]');
    expect(s.nodes.filter((n) => n.accent).map((n) => [n.id, n.accent])).toEqual([['C', DECISION]]);
    expect(s.edges.some((e) => e.accent)).toBe(false);
    expect(legend(s)).toEqual(['decision']);
    expect(tinted(await scene('graph TB\n  A --> B'))).toBe(false);
  });

  test('a loop that covers most of the diagram is not a region; its decisions still are', async () => {
    const s = await scene('flowchart LR\n  A --> B{ok?} -->|yes| C --> A\n  B -->|no| D --> A');
    expect(s.nodes.map((n) => n.accent)).toEqual([undefined, DECISION, undefined, undefined]);
    expect(legend(s)).toEqual(['decision']);
  });

  test('a failure edge back into the main flow is tinted, its target is not', async () => {
    const s = await scene('flowchart LR\n  A --> B --> C\n  B -->|on error| A\n  C -->|timeout| X --> Y');
    expect(edge(s, 'B', 'A')).toBe(FAILURE);
    expect(accent(s, 'A')).toBe(LOOP); // A and B form a (retry) loop
    expect(['X', 'Y'].map((id) => accent(s, id))).toEqual([FAILURE, FAILURE]);
    expect(accent(s, 'C')).toBeUndefined();
  });

  test('negated failure words do not count; a self-loop is a loop', async () => {
    const s = await scene('flowchart LR\n  A --> B -->|no errors| C\n  B -->|retry| B\n  C --> D');
    expect(edge(s, 'B', 'C')).toBeUndefined();
    expect(accent(s, 'C')).toBeUndefined();
    expect(accent(s, 'B')).toBe(LOOP);
    expect(edge(s, 'B', 'B')).toBe(LOOP);
    expect(legend(s)).toEqual(['loop']);
  });

  test('separate loops share one hue; the link between them stays neutral', async () => {
    const s = await scene('flowchart LR\n  S --> A --> B --> A\n  B --> C --> D --> C\n  D --> E\n  E --> F');
    expect(['A', 'B', 'C', 'D'].map((id) => accent(s, id))).toEqual([LOOP, LOOP, LOOP, LOOP]);
    expect(edge(s, 'B', 'C')).toBeUndefined();
    expect(['S', 'E', 'F'].map((id) => accent(s, id))).toEqual([undefined, undefined, undefined]);
  });

  test('author styling wins, and edges follow the painted nodes', async () => {
    const s = await scene('flowchart LR\n  S --> A --> B --> C --> A\n  C --> D\n  D --> E\n  classDef hot fill:#f96\n  class A hot\n  linkStyle 2 stroke:gold');
    expect([accent(s, 'A'), accent(s, 'B'), accent(s, 'C')]).toEqual([undefined, LOOP, LOOP]);
    expect([edge(s, 'A', 'B'), edge(s, 'C', 'A')]).toEqual([undefined, undefined]); // A is the author's
    expect(edge(s, 'B', 'C')).toBeUndefined(); // linkStyle 2 set its stroke
    // Fully author-styled (mermaid-demos/flowchart-054): nothing to add, so no legend either.
    const styled = await scene('flowchart LR\n  A --> B{again?} -->|yes| A\n  B -->|no| C\n  C --> D\n  classDef on fill:#0CF\n  class A,B on');
    expect(tinted(styled)).toBe(false);
  });

  test('a lone node is not a flow', async () => {
    expect(tinted(await scene('flowchart LR\n  id1{This is the text in the box}'))).toBe(false);
  });

  test('forced regions: groups stay neutral, typed nodes keep their colour', async () => {
    const s = await scene('flowchart LR\n  subgraph G\n  A --> B{again?} -->|yes| A\n  end\n  B -->|no| db[(Orders DB)]\n  db --> Z\n  Z --> Y', { palette: 'regions' });
    expect(s.groups[0].accent).toBeUndefined();
    expect([accent(s, 'A'), accent(s, 'B'), accent(s, 'db')]).toEqual([LOOP, LOOP, undefined]);
    // Under auto the same diagram keeps today's look: it has subgraphs and a typed node.
    expect(tinted(await scene('flowchart LR\n  subgraph G\n  A --> B{again?} -->|yes| A\n  end\n  B -->|no| db[(Orders DB)]'))).toBe(false);
    expect(tinted(await scene('flowchart LR\n  A --> B{again?} -->|yes| A\n  B -->|no| db[(Orders DB)]'))).toBe(false);
  });

  test('regions only apply to flowcharts', async () => {
    for (const src of ['stateDiagram-v2\n  [*] --> A\n  A --> B\n  B --> A\n  B --> Failed', sample('class'), 'sequenceDiagram\n  A->>B: error']) {
      expect(tinted(await scene(src, { palette: 'regions' }))).toBe(false);
    }
  });
});
