import { Window } from 'happy-dom';

let win: Window | undefined;
/** Globals installed for the renders in flight, removed when the last one ends. */
let installed: string[] | undefined;
let users = 0;

/**
 * Run `task` with a DOM, which Mermaid's parser and the SVG serializer need.
 * When the host provides one (a browser, jsdom, a test environment), it is used
 * as is. Otherwise a happy-dom window is put on `globalThis` for the duration of
 * the task only, so the rest of the process (an SSR build checking "is this a
 * browser?") never finds one between renders. Overlapping tasks share it.
 * Globals Node already has (URL, Blob, EventTarget, navigator, ...) are kept.
 */
export async function withDom<T>(task: () => Promise<T> | T): Promise<T> {
  if (!enter()) return task();
  try {
    return await task();
  } finally {
    leave();
  }
}

/** `withDom` for synchronous work. */
export function withDomSync<T>(task: () => T): T {
  if (!enter()) return task();
  try {
    return task();
  } finally {
    leave();
  }
}

/** Install the window unless the host has its own DOM; false when it does. */
function enter(): boolean {
  if (!installed && typeof document !== 'undefined') return false;
  if (!users++) install();
  return true;
}

function leave() {
  if (!--users) uninstall();
}

function install() {
  win ??= new Window({ url: 'http://localhost/' });
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
  installed = [];
  for (const [name, value] of Object.entries(globals)) {
    if (name in globalThis) continue;
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    installed.push(name);
  }
}

function uninstall() {
  for (const name of installed ?? []) delete (globalThis as Record<string, unknown>)[name];
  installed = undefined;
}
