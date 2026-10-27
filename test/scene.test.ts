import { describe, expect, test } from 'vitest';
import { h, render } from 'preact';
import { normalizeScene } from '../src/scene/normalize';
import { Viewer } from '../src/viewer/Viewer';
import type { Scene } from '../src/scene/types';

const node = (id: string, x: number) => ({ id, label: id, lines: [id], type: 'plain', shape: 'rect', x, y: 20, w: 100, h: 40 });
const base = () => ({
  version: 1,
  kind: 'flowchart',
  width: 400,
  height: 100,
  nodes: [node('a', 20), node('b', 200)],
  groups: [],
  edges: [{ id: 'e', from: 'a', to: 'b', points: [{ x: 120, y: 40 }, { x: 200, y: 40 }], stroke: 'solid', arrowEnd: true, arrowStart: false, order: 0 }],
});

describe('normalizeScene', () => {
  test('a valid scene comes back unchanged in substance', () => {
    const s = normalizeScene(base());
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(s.edges[0].points).toHaveLength(2);
  });

  test('missing arrays, fields and sizes get defaults; malformed entries are dropped', () => {
    const raw = { ...base(), groups: undefined, nodes: [{ ...node('a', 20), lines: undefined, type: 'queue' }, node('b', 200), { id: 'bad' }], width: 'x' };
    raw.edges.push({ id: 'dangling', from: 'a', to: 'nope', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } as never, { id: 'short', from: 'a', to: 'b', points: [] } as never);
    const s = normalizeScene(raw);
    expect(s.groups).toEqual([]);
    expect(s.nodes.map((n) => [n.id, n.type, n.lines])).toEqual([
      ['a', 'plain', ['a']],
      ['b', 'plain', ['b']],
    ]);
    expect(s.edges.map((e) => e.id)).toEqual(['e']);
    expect(s.width).toBe(332);
  });

  test('author styles and palette tokens are validated again', () => {
    const raw = base();
    Object.assign(raw.nodes[0], { style: { fill: 'url(https://evil.example/x.svg)', stroke: '#f00' }, accent: 'x) url(https://evil' });
    const s = normalizeScene(raw);
    expect(s.nodes[0].style).toEqual({ stroke: '#f00' });
    expect(s.nodes[0].accent).toBeUndefined();
  });

  test('not a scene, or a newer format, is refused with a message', () => {
    expect(() => normalizeScene(null)).toThrow(/Not a mermaid-archify scene/);
    expect(() => normalizeScene([])).toThrow(/Not a mermaid-archify scene/);
    expect(() => normalizeScene({ ...base(), version: 2 })).toThrow(/scene format 2.*format 1/);
  });

  test('the viewer renders a normalized hostile scene without throwing', () => {
    const host = document.createElement('div');
    const raw = { ...base(), groups: undefined, nodes: [{ ...node('a', 20), lines: undefined, type: 'queue' }, node('b', 200)], icons: { 'fa:x': 5 } };
    expect(() => render(h(Viewer, { scene: normalizeScene(raw) as Scene }), host)).not.toThrow();
    expect(host.querySelectorAll('.ma-node')).toHaveLength(2);
    render(null, host);
  });
});
