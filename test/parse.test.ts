import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { describeIcons, iconKeys, plainText } from '../src/icons/fa';
import { MermaidParseError, parseMermaid } from '../src/parse';

const sample = (name: string) => readFileSync(`${process.cwd()}/src/samples/${name}.mmd`, "utf8");

describe('flowchart', () => {
  test('nodes, nested subgraphs, shapes, edge styles', async () => {
    const ir = await parseMermaid(sample('architecture-flowchart'));
    expect(ir.kind).toBe('flowchart');
    expect(ir.title).toBe('Checkout Platform');
    expect(ir.direction).toBe('LR');
    const byId = Object.fromEntries(ir.nodes.map((n) => [n.id, n]));
    expect(byId.db).toMatchObject({ label: 'Postgres', shape: 'cylinder', type: 'database', parent: 'data' });
    expect(byId.user).toMatchObject({ type: 'frontend', parent: undefined });
    expect(byId.auth.type).toBe('security');
    expect(byId.queue).toMatchObject({ shape: 'hexagon', type: 'messagebus' });
    expect(byId.cdn).toMatchObject({ type: 'cloud', parent: 'edge' });
    expect(byId.stripe.type).toBe('external');
    expect(ir.groups.find((g) => g.id === 'data')).toMatchObject({ parent: 'platform', label: 'Data' });
    const pub = ir.edges.find((e) => e.from === 'api' && e.to === 'queue')!;
    expect(pub).toMatchObject({ stroke: 'dotted', label: 'publish', arrowEnd: true, arrowStart: false });
    expect(ir.edges.filter((e) => e.from === 'cdn')).toHaveLength(1);
    expect(new Set(ir.edges.map((e) => e.id)).size).toBe(ir.edges.length);
  });

  test('graph TD, open and double arrows, br labels', async () => {
    const ir = await parseMermaid('graph TD\n  A["one<br/>two"] --- B\n  B <--> C');
    expect(ir.direction).toBe('TB');
    expect(ir.nodes[0].label).toBe('one\ntwo');
    expect(ir.edges[0]).toMatchObject({ arrowEnd: false, arrowStart: false });
    expect(ir.edges[1]).toMatchObject({ arrowEnd: true, arrowStart: true });
  });
});

describe('sequence', () => {
  test('participants, messages, blocks, notes, activations', async () => {
    const ir = await parseMermaid(sample('sequence'));
    expect(ir.kind).toBe('sequence');
    expect(ir.title).toBe('Cache-miss request');
    expect(ir.nodes.map((n) => n.id)).toEqual(['U', 'W', 'A', 'C', 'D']);
    expect(ir.nodes[0]).toMatchObject({ shape: 'actor', label: 'Shopper', type: 'frontend' });
    expect(ir.nodes.find((n) => n.id === 'C')!.type).toBe('database');
    const kinds = ir.events!.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'message')).toHaveLength(ir.edges.length);
    expect(kinds).toContain('blockStart');
    expect(kinds).toContain('blockSection');
    expect(kinds).toContain('blockEnd');
    expect(kinds.filter((k) => k === 'activate')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'deactivate')).toHaveLength(2);
    const note = ir.events!.find((e) => e.kind === 'note');
    expect(note).toMatchObject({ over: ['A', 'C'], placement: 'over' });
    const asyncSet = ir.events!.find((e) => e.kind === 'message' && e.label.startsWith('SET'));
    expect(asyncSet).toMatchObject({ arrow: 'async', stroke: 'solid' });
    const miss = ir.edges.find((e) => e.label === 'miss')!;
    expect(miss).toMatchObject({ from: 'C', to: 'A', stroke: 'dotted' });
  });
});

describe('state', () => {
  test('pseudo-states, composite state as group, tones', async () => {
    const ir = await parseMermaid(sample('state'));
    expect(ir.kind).toBe('state');
    expect(ir.groups).toEqual([expect.objectContaining({ id: 'Running' })]);
    const byId = Object.fromEntries(ir.nodes.map((n) => [n.id, n]));
    expect(byId.root_start.shape).toBe('start');
    expect(byId.root_end.shape).toBe('end');
    expect(byId.Fetching.parent).toBe('Running');
    expect(byId.Failed.type).toBe('security');
    expect(byId.Succeeded.type).toBe('backend');
    expect(byId.Queued.type).toBe('external');
    expect(byId.Running).toBeUndefined();
    expect(ir.edges.find((e) => e.from === 'Running' && e.to === 'Failed')!.label).toBe('step error');
  });
});

describe('architecture-beta', () => {
  test('services, junctions, nested groups, sides, arrows', async () => {
    const ir = await parseMermaid(sample('architecture-beta'));
    expect(ir.kind).toBe('architecture');
    const byId = Object.fromEntries(ir.nodes.map((n) => [n.id, n]));
    expect(byId.db).toMatchObject({ type: 'database', parent: 'data' });
    expect(byId.cdn.type).toBe('external');
    expect(byId.fanout.shape).toBe('junction');
    expect(ir.groups.find((g) => g.id === 'data')!.parent).toBe('api');
    expect(ir.edges[0]).toMatchObject({ from: 'cdn', to: 'lb', fromSide: 'R', toSide: 'L', arrowEnd: true });
    expect(ir.edges.find((e) => e.to === 'fanout')!.arrowEnd).toBe(false);
  });
});

describe('errors', () => {
  test('syntax error carries a line', async () => {
    const err = await parseMermaid('flowchart LR\n  A --> B\n  B -->> C -->').catch((e) => e);
    expect(err).toBeInstanceOf(MermaidParseError);
    expect(err.line).toBe(3);
  });
  test('unsupported type', async () => {
    const err = await parseMermaid('pie\n "a": 1').catch((e) => e);
    expect(err).toBeInstanceOf(MermaidParseError);
    expect(err.message).toMatch(/not supported/);
  });
  test('garbage header', async () => {
    const err = await parseMermaid('hello world').catch((e) => e);
    expect(err.message).toMatch(/Unrecognized/);
  });
});

describe('error lines stay aligned with the source', () => {
  test('frontmatter and comments do not shift the reported line', async () => {
    const src = '---\ntitle: T\n---\nflowchart LR\n  %% a comment\n  A --> B\n  B -->';
    const err = await parseMermaid(src).catch((e) => e);
    expect(err.line).toBe(7);
    expect(err.message).toBe('Unexpected end of input');
  });
  test('frontmatter title still read', async () => {
    expect((await parseMermaid('---\ntitle: "Hello"\n---\nflowchart LR\n  A-->B')).title).toBe('Hello');
  });
});

describe('label cleanup', () => {
  test('LaTeX backslash sequences are not turned into line breaks', async () => {
    const ir = await parseMermaid('flowchart LR\n  A["$$\\nu + \\nabla$$"]');
    expect(ir.nodes[0].label).toBe('$$\\nu + \\nabla$$');
  });
  test('Font Awesome tokens become icons, text kept', async () => {
    const ir = await parseMermaid('flowchart LR\n  A[fa:fa-ban forbidden] --> B["fab:fa-github GitHub"]');
    expect(ir.nodes.map((n) => plainText(n.label))).toEqual(['forbidden', 'GitHub']);
    expect(ir.nodes.map((n) => iconKeys(n.label))).toEqual([['fa:ban'], ['fab:github']]);
  });
  test('Mermaid entity codes are decoded', async () => {
    const ir = await parseMermaid('sequenceDiagram\n  A->>B: I #9829; you #infin; times #quot;more#quot;');
    expect(ir.edges[0].label).toBe('I ♥ you ∞ times "more"');
  });
  test('CJK labels wrap by display width', async () => {
    const { wrap, cells } = await import('../src/layout/measure');
    expect(cells('负责人审批')).toBe(10);
    expect(cells('abc')).toBe(3);
    const lines = wrap('负'.repeat(30), 22);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(22);
  });
});

test('concurrent state regions get stable, unlabelled ids', async () => {
  const src = 'stateDiagram-v2\n  state Active {\n    [*] --> A\n    --\n    [*] --> B\n    --\n    [*] --> C\n  }';
  const [one, two] = [await parseMermaid(src), await parseMermaid(src)];
  expect(one.groups.map((g) => g.id)).toEqual(two.groups.map((g) => g.id));
  expect(one.groups.filter((g) => g.parent === 'Active').map((g) => [g.id, g.label])).toEqual([
    ['Active.region1', ''],
    ['Active.region2', ''],
    ['Active.region3', ''],
  ]);
  expect(one.nodes.find((n) => n.id === 'C')!.parent).toBe('Active.region3');
  expect(one.edges.map((e) => e.from)).toContain('Active.region3_start');
});

test('Mermaid v11 shape names map to shape families', async () => {
  const src = [
    'flowchart LR',
    '  a@{ shape: cyl, label: "Orders" }',
    '  b@{ shape: docs, label: "Reports" }',
    '  c@{ shape: lean-r, label: "Input" }',
    '  d@{ shape: trap-t, label: "Manual" }',
    '  e@{ shape: sm-circ }',
    '  f@{ shape: text, label: "Plain" }',
    '  g@{ shape: brace-r, label: "Remark" }',
    '  h@{ shape: datastore, label: "Things" }',
    '  i@{ shape: bolt, label: "Zap" }',
  ].join('\n');
  const ir = await parseMermaid(src);
  const shape = Object.fromEntries(ir.nodes.map((n) => [n.id, n.shape]));
  expect(shape).toEqual({ a: 'cylinder', b: 'document', c: 'parallelogram', d: 'trapezoid', e: 'start', f: 'text', g: 'note', h: 'cylinder', i: 'rect' });
  expect(ir.nodes.find((n) => n.id === 'h')!.type).toBe('database');
});

test('state transition text honours literal \\n line breaks', async () => {
  const ir = await parseMermaid('stateDiagram-v2\n  A --> B: first\\nsecond');
  expect(ir.edges[0].label).toBe('first\nsecond');
});

test('state notes become note nodes with a plain connector', async () => {
  const ir = await parseMermaid('stateDiagram-v2\n  A --> B\n  note right of A : check this\n  note left of B\n    multi\n    line\n  end note');
  const notes = ir.nodes.filter((n) => n.shape === 'note');
  expect(notes.map((n) => [n.id, n.label])).toEqual([
    ['A__note', 'check this'],
    ['B__note', 'multi\nline'],
  ]);
  const links = ir.edges.filter((e) => e.from.includes('__note') || e.to.includes('__note'));
  expect(links.every((e) => e.stroke === 'dotted' && !e.arrowEnd && !e.arrowStart)).toBe(true);
});

describe('type markers only where the source gives evidence', () => {
  const types = async (src: string) => Object.fromEntries((await parseMermaid(src)).nodes.map((n) => [n.id, n.type]));

  test('a process flow stays plain (the Mermaid docs "Christmas" example)', async () => {
    const src = [
      'flowchart TD',
      '    A[Christmas] -->|Get money| B(Go shopping)',
      '    B --> C{Let me think}',
      '    C -->|One| D[Laptop]',
      '    C -->|Two| E[iPhone]',
      '    C -->|Three| F[fa:fa-car Car]',
    ].join('\n');
    expect(Object.values(await types(src))).toEqual(Array(6).fill('plain'));
  });

  test('a stray keyword in a process flow is not promoted to a component type', async () => {
    expect(await types('flowchart LR\n  A[Login] --> B[Check cart] --> C[Pay] --> D[Done]')).toEqual({
      A: 'plain',
      B: 'plain',
      C: 'plain',
      D: 'plain',
    });
  });

  test('explicit evidence always shows, even in a process flow', async () => {
    expect(await types('flowchart LR\n  A[Start] --> B[(Orders)] --> C[Ship it]:::external --> D[Done]')).toEqual({
      A: 'plain',
      B: 'database',
      C: 'external',
      D: 'plain',
    });
  });

  test('an architecture-like diagram keeps its keyword types', async () => {
    expect(await types('flowchart LR\n  W[Web app] --> G[API gateway] --> S[Order service] --> P[Postgres]\n  S --> K[Kafka]')).toEqual({
      W: 'frontend',
      G: 'cloud',
      S: 'backend',
      P: 'database',
      K: 'messagebus',
    });
  });

  test('states without an outcome word are plain, outcome words keep their tone', async () => {
    expect(await types('stateDiagram-v2\n  [*] --> Still\n  Still --> Crash\n  Crash --> Done')).toMatchObject({
      Still: 'plain',
      Crash: 'security',
      Done: 'backend',
    });
  });
});

describe('Font Awesome icons', () => {
  test('flowchart icons become markers with resolved path data', async () => {
    const ir = await parseMermaid('flowchart LR\n  A[fa:fa-car Car] -->|fa:fa-bolt fast| B[fab:fa-github Repo]');
    expect(plainText(ir.nodes[0].label)).toBe('Car');
    expect(iconKeys(ir.nodes[0].label)).toEqual(['fa:car']);
    expect(iconKeys(ir.edges[0].label!)).toEqual(['fa:bolt']);
    expect(Object.keys(ir.icons!).sort()).toEqual(['fa:bolt', 'fa:car', 'fab:github']);
    const [w, h, d] = ir.icons!['fa:car'];
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(d).toMatch(/^M/);
  });

  test('icons can sit mid-label and on their own', async () => {
    const ir = await parseMermaid('flowchart LR\n  A[A fa:fa-camera-retro perhaps?] --> B[fa:fa-spinner]');
    expect(describeIcons(ir.nodes[0].label)).toBe('A [fa:camera-retro] perhaps?');
    expect(describeIcons(ir.nodes[1].label)).toBe('[fa:spinner]');
  });

  test('old FA4 names resolve through the shims, brands fall back from fa:', async () => {
    const ir = await parseMermaid('flowchart LR\n  A[fa:fa-cogs Build] --> B[fa:fa-twitter Tweet] --> C[fa:fa-area-chart Stats]');
    expect(Object.keys(ir.icons!).sort()).toEqual(['fa:area-chart', 'fa:cogs', 'fa:twitter']);
  });

  test('unknown icons are removed from the text, not left as tokens', async () => {
    const ir = await parseMermaid('flowchart LR\n  A[fa:fa-not-a-real-icon Thing] --> B[fak:fa-custom-kit Kit]');
    expect(ir.nodes.map((n) => n.label)).toEqual(['Thing', 'Kit']);
    expect(ir.icons).toBeUndefined();
  });

  test('icons are dropped where Mermaid does not render them (sequence)', async () => {
    const ir = await parseMermaid('sequenceDiagram\n  A->>B: fa:fa-car drive');
    expect(ir.edges[0].label).toBe('drive');
  });
});

test('icon names count as keyword evidence for component types', async () => {
  const ir = await parseMermaid('flowchart LR\n  A[fa:fa-server Alpha] --> B[fa:fa-database Beta] --> C[fa:fa-server Gamma]');
  expect(ir.nodes.map((n) => n.type)).toEqual(['backend', 'database', 'backend']);
});
