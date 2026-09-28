import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
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
