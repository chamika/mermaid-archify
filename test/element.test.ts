import { h, render } from 'preact';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import '../src/element/element';

// happy-dom's IntersectionObserver never fires; without one, elements start at once (as in old browsers).
beforeAll(() => vi.stubGlobal('IntersectionObserver', undefined));

const scene = {
  version: 1,
  kind: 'flowchart',
  width: 300,
  height: 100,
  nodes: [{ id: 'a', label: 'A', lines: ['A'], type: 'plain', shape: 'rect', x: 20, y: 20, w: 100, h: 40 }],
  groups: [],
  edges: [],
};

const mount = (el: HTMLElement) => {
  document.body.append(el);
  return () => el.remove();
};
const message = (el: HTMLElement) => el.shadowRoot!.querySelector('.ma-message')?.textContent;
const nextError = (el: HTMLElement) => new Promise<string>((resolve) => el.addEventListener('ma-error', (e) => resolve((e as CustomEvent).detail.message), { once: true }));

describe('<mermaid-archify>', () => {
  test('a framework setting scene and theme as properties gets the attributes', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const url = `data:application/json,${encodeURIComponent(JSON.stringify(scene))}`;
    expect(() => render(h('mermaid-archify', { scene: url, theme: 'light' }), host)).not.toThrow();
    const el = host.querySelector('mermaid-archify')!;
    expect(el.getAttribute('scene')).toBe(url);
    expect(el.getAttribute('theme')).toBe('light');
    (el as HTMLElement & { theme: string }).theme = 'auto';
    expect(el.hasAttribute('theme')).toBe(false);
    render(null, host);
    host.remove();
  });

  test('a Scene property renders; a bad one shows why', () => {
    const el = document.createElement('mermaid-archify') as HTMLElement & { scene: unknown };
    const done = mount(el);
    el.scene = scene;
    expect(el.shadowRoot!.querySelectorAll('.ma-node')).toHaveLength(1);
    el.scene = { ...scene, version: 9 };
    expect(message(el)).toMatch(/scene format 9/);
    done();
  });

  test('scene-json that is not a scene reports a message', async () => {
    const el = document.createElement('mermaid-archify');
    el.setAttribute('scene-json', 'null');
    const error = nextError(el);
    const done = mount(el);
    expect(await error).toMatch(/Not a mermaid-archify scene/);
    expect(message(el)).toMatch(/Not a mermaid-archify scene/);
    done();
  });

  test('inline content replaced after the first render is rendered again', async () => {
    const el = document.createElement('mermaid-archify');
    const json = document.createElement('script');
    json.type = 'application/json';
    json.textContent = JSON.stringify(scene);
    el.append(json);
    const first = new Promise((resolve) => el.addEventListener('ma-ready', resolve, { once: true }));
    const done = mount(el);
    await first;
    const second = new Promise<CustomEvent>((resolve) => el.addEventListener('ma-ready', (e) => resolve(e as CustomEvent), { once: true }));
    json.textContent = JSON.stringify({ ...scene, nodes: [...scene.nodes, { ...scene.nodes[0], id: 'b', x: 160 }] });
    expect((await second).detail.scene.nodes).toHaveLength(2);
    done();
  });
});
