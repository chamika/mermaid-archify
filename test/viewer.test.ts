import { h, options, render as mount } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { render } from '../src/node';
import { Viewer } from '../src/viewer/Viewer';

// happy-dom lays nothing out; give the viewport a size so fit and pan have room.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
const hosts: HTMLElement[] = [];
afterEach(() => hosts.splice(0).forEach((host) => (mount(null, host), host.remove())));

async function open(source: string) {
  const { scene } = await render(source);
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  await act(() => mount(h(Viewer, { scene }), host));
  return host;
}
const pressed = (host: HTMLElement) => host.querySelector('[aria-label="Animate flow"]')!.getAttribute('aria-pressed');

test('Space activates a focused button instead of toggling animation; elsewhere it animates', async () => {
  const host = await open('flowchart LR\n  A --> B');
  const button = host.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement;
  const onButton = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  await act(() => void button.dispatchEvent(onButton));
  expect(onButton.defaultPrevented).toBe(false);
  expect(pressed(host)).toBe('false');
  await act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
  expect(pressed(host)).toBe('true');
});

test('lifting one finger after a pinch keeps the pinched zoom, without a jump', async () => {
  const host = await open('flowchart LR\n  A --> B');
  const vp = host.querySelector('.ma-viewer') as HTMLElement & { setPointerCapture: () => void };
  vp.setPointerCapture = () => undefined;
  const stage = () => (host.querySelector('.ma-stage') as HTMLElement).style.transform;
  const k = () => Number(/scale\(([\d.]+)\)/.exec(stage())![1]);
  const x = () => Number(/translate\(([-\d.]+)px/.exec(stage())![1]);
  const pointer = (type: string, id: number, clientX: number) =>
    act(() => void vp.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX, clientY: 100, button: 0, bubbles: true })));
  await pointer('pointerdown', 1, 100);
  await pointer('pointerdown', 2, 200);
  await pointer('pointermove', 2, 400); // spread 100 → 300: three times the zoom
  const [pinchedK, pinchedX] = [k(), x()];
  await pointer('pointerup', 2, 400);
  await pointer('pointermove', 1, 105);
  expect(k()).toBeCloseTo(pinchedK);
  expect(x()).toBeCloseTo(pinchedX + 5);
});

test('panning does not re-render the diagram nodes', async () => {
  const host = await open(`flowchart LR\n${Array.from({ length: 30 }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')}`);
  let nodeViews = 0;
  const prev = options.diffed;
  options.diffed = (v) => {
    if ((v.type as { name?: string })?.name?.startsWith('NodeView')) nodeViews++;
    prev?.(v);
  };
  try {
    await act(() => void host.querySelector('.ma-viewer')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true })));
  } finally {
    options.diffed = prev;
  }
  expect(nodeViews).toBe(0);
});

test('an empty scene draws no NaN', async () => {
  const host = await open('flowchart LR');
  expect(host.innerHTML).not.toContain('NaN');
});
