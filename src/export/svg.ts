import type { Scene } from '../scene/types';
import diagramCss from '../viewer/diagram.css?inline';
import tokensCss from '../viewer/tokens.css?inline';

// Minified builds add `--lightningcss-*` helpers for `color-scheme`; they are not palette tokens.
const TOKEN_NAMES = [...new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))].filter((n) => !n.startsWith('--lightningcss-'));

/** Palette values in effect at `el` (the document's theme, or an embed's own inside its shadow root). */
function resolvedTokens(el: Element): string {
  const cs = getComputedStyle(el);
  return TOKEN_NAMES.map((name) => `${name}:${cs.getPropertyValue(name).trim()}`).join(';');
}

/** Palette values for `theme`, read from tokens.css without a live document (headless rendering). */
export function themeTokens(theme: 'light' | 'dark'): string {
  // Quotes and whitespace vary: the CSS is minified in builds. The light block
  // inside the prefers-color-scheme query (`:root:not(...)`) is not matched.
  const selector = theme === 'light' ? /(?:^|[\s}])\[data-theme=['"]?light['"]?\]\s*\{([^}]*)\}/ : /:root,\s*\[data-theme=['"]?dark['"]?\]\s*\{([^}]*)\}/;
  const block = selector.exec(tokensCss)![1];
  const values = new Map([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
  return TOKEN_NAMES.map((name) => `${name}:${values.get(name) ?? ''}`).join(';');
}

const VIEW_STATE_CLASSES = ['dimmed', 'previewing', 'tracing', 'lit', 'focused', 'route-end', 'on-route', 'pinned', 'trace-now', 'trace-done'];

/**
 * Canonical SVG: the diagram only, current theme baked in, and every piece of
 * viewer state (focus, route, trace, hover) removed.
 */
export function serializeSvg(live: SVGSVGElement, scene: Scene, tokens = resolvedTokens(live)): string {
  const svg = live.cloneNode(true) as SVGSVGElement;
  svg.querySelectorAll('.ma-overlay').forEach((el) => el.remove());
  for (const cls of VIEW_STATE_CLASSES) svg.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
  svg.classList.remove(...VIEW_STATE_CLASSES);
  // Preact sets `tabIndex` as an attribute on SVG elements, where selectors are case-sensitive.
  for (const name of ['tabindex', 'tabIndex']) svg.querySelectorAll(`[${name}]`).forEach((el) => el.removeAttribute(name));

  const pad = 24;
  const w = scene.width + pad * 2;
  const h = scene.height + pad * 2;
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('style', tokens);

  const ns = 'http://www.w3.org/2000/svg';
  const style = document.createElementNS(ns, 'style');
  style.textContent = diagramCss;
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', String(-pad));
  bg.setAttribute('y', String(-pad));
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', 'var(--bg)');
  svg.insertBefore(bg, svg.firstChild);
  svg.insertBefore(style, svg.firstChild);
  if (scene.title) {
    const title = document.createElementNS(ns, 'title');
    title.textContent = scene.title;
    svg.insertBefore(title, svg.firstChild);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}
