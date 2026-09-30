import { Window } from 'happy-dom';

/**
 * Mermaid's parser and the SVG serializer need a DOM. Outside a browser, put a
 * happy-dom window on `globalThis`, unless the host already provides a DOM (a
 * browser, jsdom, a test environment), which is then left alone. Globals Node
 * already has (URL, Blob, EventTarget, navigator, ...) are kept.
 */
export function ensureDom(): void {
  if (typeof document !== 'undefined') return;
  const win = new Window({ url: 'http://localhost/' });
  const scope = win as unknown as Record<string, unknown>;
  const globals: Record<string, unknown> = {
    window: win,
    self: win,
    document: win.document,
    getComputedStyle: win.getComputedStyle.bind(win),
  };
  // DOM interfaces: Element, SVGElement, DOMParser, XMLSerializer, ...
  for (const name of Object.getOwnPropertyNames(win)) {
    if (/^[A-Z]/.test(name) && typeof scope[name] === 'function') globals[name] = scope[name];
  }
  for (const [name, value] of Object.entries(globals)) {
    if (!(name in globalThis)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}
