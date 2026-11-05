/**
 * SVG for tools that read presentation attributes and only simple CSS (resvg, Figma,
 * Illustrator, Office): the export's stylesheet and `var()` palette resolved, by the
 * cascade, into plain attributes on every element. Runs in a browser or under happy-dom.
 */

const BAKED = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'paint-order',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-decoration',
  'text-anchor',
  'dominant-baseline',
  'display',
  'visibility',
] as const;

/** Inherited properties are written only where they change, so SVG inheritance carries corrected values down. */
const INHERITED = new Set(['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'paint-order', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'visibility']);

/** Elements a browser computes `display: none` for, which their use by reference ignores. */
const NEVER_DRAWN = new Set(['defs', 'marker', 'title', 'desc', 'metadata', 'symbol', 'clipPath', 'mask', 'style']);

/** A browser computes every property; initial values of properties that do not inherit say nothing. */
function isDefault(el: Element, prop: string, value: string): boolean {
  if (prop === 'display') return value === 'inline' || NEVER_DRAWN.has(el.localName);
  if (prop === 'opacity') return value === '1';
  if (prop === 'dominant-baseline') return value === 'auto';
  if (prop === 'text-decoration') return value.startsWith('none');
  return false;
}

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/;

/** A custom property in effect at `el`. happy-dom does not inherit them, so walk up. */
function customProperty(el: Element, name: string): string {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const v = getComputedStyle(at).getPropertyValue(name).trim();
    if (v) return v;
  }
  return '';
}

function resolveVars(value: string, el: Element): string {
  for (let i = 0; i < 10 && VAR.test(value); i++) {
    value = value.replace(VAR, (_, name: string, fallback?: string) => customProperty(el, name) || fallback?.trim() || '');
  }
  return value;
}

/** Every text node below `node`. */
function textNodes(node: Node): Node[] {
  return node.nodeType === 3 ? [node] : [...node.childNodes].flatMap(textNodes);
}

/**
 * Declared `letter-spacing` in em, scaled by the element's own font size. happy-dom
 * resolves em against the root font size instead.
 */
function letterSpacing(el: Element, rules: CSSStyleRule[], fontSize: string): string | undefined {
  let declared: string | undefined;
  for (const rule of rules) if (rule.style.getPropertyValue('letter-spacing') && el.matches(rule.selectorText)) declared = rule.style.getPropertyValue('letter-spacing');
  const em = declared && /^(-?[\d.]+)em$/.exec(declared.trim());
  return em ? `${+em[1] * parseFloat(fontSize)}px` : undefined;
}

/**
 * The SVG export with its stylesheet and palette resolved into presentation
 * attributes: no CSS variables or `context-stroke`, for tools that lack them.
 * `mount` puts the SVG where the cascade runs and returns how to remove it; by default
 * a shadow root off-screen, where the page's own styles cannot reach it.
 */
export function bakeStyles(svgText: string, mount: Mount = inShadow): string {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  const unmount = mount(svg);
  try {
    const els = [svg, ...svg.querySelectorAll('*')];
    const rules = [...svg.querySelectorAll('style')].flatMap((st) => [...(st.sheet?.cssRules ?? [])]).filter((r): r is CSSStyleRule => 'selectorText' in r);
    // Compute everything before changing anything, so the cascade sees the original document.
    const raw = new Map<Element, Map<string, string>>();
    const computed = els.map((el) => {
      const cs = getComputedStyle(el);
      const own = new Map<string, string>();
      for (const p of BAKED) own.set(p, cs.getPropertyValue(p).trim());
      raw.set(el, own);
      const parent = el.parentElement && raw.get(el.parentElement);
      const props = new Map<string, string>();
      for (const p of BAKED) {
        if (parent && INHERITED.has(p) && parent.get(p) === own.get(p)) continue;
        const v = resolveVars(own.get(p)!, el);
        if (v && !isDefault(el, p, v)) props.set(p, v);
      }
      const spacing = letterSpacing(el, rules, cs.getPropertyValue('font-size'));
      if (spacing) props.set('letter-spacing', spacing);
      const attrs = new Map<string, string>();
      for (const a of el.getAttributeNames()) {
        const v = el.getAttribute(a)!;
        if (a !== 'style' && v.includes('var(')) attrs.set(a, resolveVars(v, el));
      }
      return { el, props, attrs, upper: cs.getPropertyValue('text-transform').trim() === 'uppercase' };
    });
    for (const { el, props, attrs, upper } of computed) {
      for (const [a, v] of attrs) el.setAttribute(a, v);
      for (const [p, v] of props) {
        // A presentation attribute the stylesheet did not override keeps its own value.
        if (!el.hasAttribute(p) || attrs.has(p)) el.setAttribute(p, v);
      }
      el.removeAttribute('style');
      el.removeAttribute('class');
      if (upper) for (const n of textNodes(el)) n.textContent = n.textContent!.toUpperCase();
    }
    svg.querySelectorAll('style').forEach((s) => s.remove());
    resolveContextPaint(svg);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  } finally {
    unmount();
  }
}

type Mount = (svg: SVGSVGElement) => () => void;

const inShadow: Mount = (svg) => {
  const host = document.createElement('div');
  host.setAttribute('style', 'all:initial;position:absolute;left:-99999px;top:0');
  host.attachShadow({ mode: 'open' }).appendChild(svg);
  document.body.appendChild(host);
  return () => host.remove();
};

/**
 * Markers are shared and take the edge's colour through `context-stroke`/`context-fill`,
 * and point back along the edge at its start with `orient="auto-start-reverse"`. resvg
 * supports neither, so each colour and end gets its own copy: concrete paint, and
 * `auto` with the shape turned around its reference point at a start.
 */
function resolveContextPaint(svg: SVGSVGElement): void {
  const copies = new Map<string, string>();
  for (const el of svg.querySelectorAll('[marker-start], [marker-mid], [marker-end]')) {
    const stroke = el.getAttribute('stroke') ?? 'none';
    const fill = el.getAttribute('fill') ?? 'none';
    for (const attr of ['marker-start', 'marker-mid', 'marker-end']) {
      const id = /^url\(["']?#([^"')]+)["']?\)$/.exec(el.getAttribute(attr) ?? '')?.[1];
      const marker = id && svg.querySelector(`marker[id="${id}"]`);
      if (!marker) continue;
      const reverse = attr === 'marker-start' && marker.getAttribute('orient') === 'auto-start-reverse';
      const key = `${id}|${stroke}|${fill}|${reverse}`;
      let copyId = copies.get(key);
      if (!copyId) {
        copyId = `${id}-${copies.size}`;
        const copy = marker.cloneNode(true) as Element;
        copy.setAttribute('id', copyId);
        for (const part of [copy, ...copy.querySelectorAll('*')]) {
          for (const a of ['fill', 'stroke']) {
            const v = part.getAttribute(a);
            if (v === 'context-stroke') part.setAttribute(a, stroke);
            else if (v === 'context-fill') part.setAttribute(a, fill);
          }
        }
        if (copy.getAttribute('orient') === 'auto-start-reverse') copy.setAttribute('orient', 'auto');
        if (reverse) {
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('transform', `rotate(180 ${copy.getAttribute('refX') ?? 0} ${copy.getAttribute('refY') ?? 0})`);
          g.append(...copy.childNodes);
          copy.appendChild(g);
        }
        marker.parentNode!.appendChild(copy);
        copies.set(key, copyId);
      }
      el.setAttribute(attr, `url(#${copyId})`);
    }
  }
  const used = new Set(copies.values());
  for (const marker of svg.querySelectorAll('marker')) if (!used.has(marker.id)) marker.remove();
}

