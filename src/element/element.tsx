import { render } from 'preact';
import { imageExports } from '../export/actions';
import type { Scene } from '../scene/types';
import { VIEWER_CSS, Viewer } from '../viewer/Viewer';

type Theme = 'light' | 'dark';

const TAG = 'mermaid-archify';

const SHADOW_CSS = `
:host { display: block; position: relative; height: var(--ma-height, 480px); contain: content; }
:host([hidden]) { display: none; }
.ma-embed { all: initial; display: block; position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
.ma-embed .ma-viewer:focus-visible { outline: 2px solid var(--arrow-emphasis); outline-offset: -2px; }
.ma-message { box-sizing: border-box; height: 100%; display: grid; place-items: center; padding: 16px; background: var(--bg);
  color: var(--text-muted); font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: center; white-space: pre-wrap; }
.ma-message.error { color: var(--security-stroke); }
`;

/** Theme of the host page: `<html data-theme>` (Docusaurus, Starlight), `<html class="dark">` (VitePress, Tailwind), else the OS. */
function hostTheme(): Theme {
  const root = document.documentElement;
  const set = root.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Shared by every element on the page: one observer each for `<html>` and the OS preference. */
const themeListeners = new Set<() => void>();
let watching = false;
function watchHostTheme(fn: () => void): () => void {
  themeListeners.add(fn);
  if (!watching) {
    watching = true;
    const notify = () => themeListeners.forEach((f) => f());
    new MutationObserver(notify).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', notify);
  }
  return () => themeListeners.delete(fn);
}

/** Starts work only once the element is near the viewport. */
let lazy: IntersectionObserver | undefined;
const onVisible = new WeakMap<Element, () => void>();
function whenVisible(el: Element, fn: () => void) {
  if (typeof IntersectionObserver === 'undefined') return fn();
  lazy ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        lazy!.unobserve(e.target);
        const run = onVisible.get(e.target);
        onVisible.delete(e.target);
        run?.();
      }
    },
    { rootMargin: '200px' },
  );
  onVisible.set(el, fn);
  lazy.observe(el);
}
function cancelVisible(el: Element) {
  onVisible.delete(el);
  lazy?.unobserve(el);
}

const toHeight = (v: string | null) => (!v ? null : /^\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()}px` : v);

// Defined against a stub outside the browser, so SSR builds can import this module.
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<mermaid-archify>`: an interactive Archify diagram, isolated in shadow DOM.
 *
 * Content, first match wins: `scene="diagram.json"`, an inline
 * `<script type="application/json">` Scene (or `scene-json` attribute), as
 * written by the Markdown plugins, `src="diagram.mmd"`, or Mermaid source as
 * the element's text (or in a child `<script type="text/mermaid">`). Only Mermaid source loads Mermaid + ELK, on demand.
 *
 * Attributes: `theme` (`auto` | `light` | `dark`), `height` (CSS length,
 * number = px), `controls` (`false` hides toolbar, legend and minimap).
 */
export class MermaidArchifyElement extends Base {
  static observedAttributes = ['scene', 'scene-json', 'src', 'theme', 'height', 'controls'];

  #mount?: HTMLDivElement;
  #scene?: Scene;
  #userTheme?: Theme;
  #started = false;
  #load = 0;
  #unwatch?: () => void;

  connectedCallback() {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = VIEWER_CSS + SHADOW_CSS;
      this.#mount = document.createElement('div');
      this.#mount.className = 'ma-embed';
      this.#mount.setAttribute('part', 'viewer');
      root.append(style, this.#mount);
    }
    this.#applyHeight();
    this.#unwatch = watchHostTheme(() => this.#paint());
    this.#paint();
    if (!this.#started) whenVisible(this, () => this.#start());
  }

  disconnectedCallback() {
    cancelVisible(this);
    this.#unwatch?.();
    this.#unwatch = undefined;
    // Unmount so listeners and timers go; reconnecting (moving the element) renders again.
    if (this.#mount) render(null, this.#mount);
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value || !this.#mount) return;
    if (name === 'height') this.#applyHeight();
    else if (name === 'theme') {
      this.#userTheme = undefined;
      this.#paint();
    } else if (name === 'controls') this.#paint();
    else if (this.#started) this.#start();
  }

  /** The laid-out diagram, once loaded. */
  get scene(): Scene | undefined {
    return this.#scene;
  }

  /** Render a Scene directly (e.g. one produced by the `mermaid-archify` library). */
  set scene(scene: Scene | undefined) {
    this.#load++;
    this.#scene = scene;
    this.#started = true;
    cancelVisible(this);
    this.#paint();
  }

  get theme(): Theme {
    const attr = this.getAttribute('theme');
    return this.#userTheme ?? (attr === 'light' || attr === 'dark' ? attr : hostTheme());
  }

  #applyHeight() {
    const h = toHeight(this.getAttribute('height'));
    if (h) this.style.setProperty('--ma-height', h);
    else this.style.removeProperty('--ma-height');
  }

  async #start() {
    this.#started = true;
    const load = ++this.#load;
    const done = (scene?: Scene, error?: string) => {
      if (load !== this.#load) return; // superseded by a newer load
      this.#scene = scene;
      this.#paint(error);
      if (scene) this.dispatchEvent(new CustomEvent('ma-ready', { detail: { scene } }));
      else this.dispatchEvent(new CustomEvent('ma-error', { detail: { message: error } }));
    };
    try {
      const sceneUrl = this.getAttribute('scene');
      const inline = this.getAttribute('scene-json') ?? this.querySelector(':scope > script[type="application/json"]')?.textContent;
      if (sceneUrl) return done(await fetchText(sceneUrl).then(JSON.parse));
      if (inline) return done(JSON.parse(inline));
      const src = this.getAttribute('src');
      const source = src ? await fetchText(src) : sourceText(this);
      if (!source.trim()) return done(undefined, 'No diagram: set scene, src, or put Mermaid source inside the element.');
      this.#paint(undefined, 'Rendering…');
      const { renderScene } = await import('./render');
      done(await renderScene(source));
    } catch (err) {
      const e = err as Error & { line?: number };
      done(undefined, e.line ? `Line ${e.line}: ${e.message}` : e.message);
    }
  }

  #paint(error?: string, pending?: string) {
    const mount = this.#mount;
    if (!mount) return;
    const theme = this.theme;
    mount.dataset.theme = theme;
    if (!this.#scene || error || pending) {
      const msg = error ?? pending ?? '';
      render(<div class={`ma-message${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>{msg}</div>, mount);
      return;
    }
    render(
      <Viewer
        key={this.#load}
        scene={this.#scene}
        embedded
        theme={theme}
        onThemeChange={(t) => {
          this.#userTheme = t;
          this.#paint();
        }}
        controls={this.getAttribute('controls') !== 'false'}
        exports={imageExports}
      />,
      mount,
    );
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.text();
}

/**
 * Inline Mermaid source, dedented (Markdown and templates indent it). A child
 * `<script type="text/mermaid">` keeps `<br>` and friends from being parsed as HTML.
 */
function sourceText(el: HTMLElement): string {
  const script = el.querySelector(':scope > script[type="text/mermaid"]');
  const raw = script ? script.textContent ?? '' : [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('');
  const lines = raw.replace(/^\s*\n/, '').trimEnd().split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG)) customElements.define(TAG, MermaidArchifyElement);

declare global {
  interface HTMLElementTagNameMap {
    [TAG]: MermaidArchifyElement;
  }
}
