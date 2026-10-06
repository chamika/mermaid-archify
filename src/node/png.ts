import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { ensureDom } from './dom';

/**
 * PNG without a browser: resvg rasterizes the SVG export. resvg reads presentation
 * attributes and only simple CSS, so the export's stylesheet and `var()` palette are
 * first resolved (by happy-dom's cascade) into plain attributes on every element.
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

/** The SVG export with its stylesheet and palette resolved into presentation attributes. */
export function bakeStyles(svgText: string): string {
  ensureDom();
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  document.body.appendChild(svg);
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
        if (v) props.set(p, v);
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
    svg.remove();
  }
}

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

/** WOFF 1.0 → TrueType/OpenType: the same tables, zlib-inflated, behind an sfnt header. */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('Not a WOFF 1.0 font');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = Array.from({ length: numTables }, (_, i) => {
    const at = 44 + i * 20;
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + compLength);
    return {
      tag: woff.subarray(at, at + 4),
      checksum: woff.readUInt32BE(at + 16),
      data: compLength < origLength ? inflateSync(raw) : raw,
    };
  });
  const pad4 = (n: number) => (n + 3) & ~3;
  const headerSize = 12 + 16 * numTables;
  const out = Buffer.alloc(headerSize + tables.reduce((s, t) => s + pad4(t.data.length), 0));
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    t.tag.copy(out, at);
    out.writeUInt32BE(t.checksum, at + 4);
    out.writeUInt32BE(offset, at + 8);
    out.writeUInt32BE(t.data.length, at + 12);
    t.data.copy(out, offset);
    offset += pad4(t.data.length);
  });
  return out;
}

export const FONT_FACES = ['400-normal', '400-italic', '600-normal', '600-italic', '700-normal', '700-italic'];

let fontFiles: Promise<string[]> | undefined;

/**
 * JetBrains Mono as TrueType files resvg can load. The package ships them in
 * dist-node/fonts (scripts/lib-fonts.mjs); from source they are converted once
 * from @fontsource's WOFF files into a temp directory.
 */
function jetBrainsMono(): Promise<string[]> {
  return (fontFiles ??= (async () => {
    const name = (face: string) => `jetbrains-mono-latin-${face}.ttf`;
    for (const rel of ['./fonts/', '../fonts/']) {
      const dir = fileURLToPath(new URL(rel, import.meta.url));
      if (FONT_FACES.every((f) => existsSync(join(dir, name(f))))) return FONT_FACES.map((f) => join(dir, name(f)));
    }
    const require = createRequire(import.meta.url);
    const dir = join(tmpdir(), 'mermaid-archify-fonts');
    await mkdir(dir, { recursive: true });
    return Promise.all(
      FONT_FACES.map(async (face) => {
        const ttf = join(dir, name(face));
        if (!existsSync(ttf)) {
          const woff = require.resolve(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${face}.woff`);
          await writeFile(ttf, woffToSfnt(await readFile(woff)));
        }
        return ttf;
      }),
    );
  })());
}

/** Characters outside the bundled JetBrains Mono latin subset (CJK, emoji, Cyrillic, ...). */
const BEYOND_LATIN = /[^\u0000-\u024F\u2000-\u206F\u20AC\u2122]/u;

/** The text content of serialized SVG, entities decoded well enough to classify scripts. */
function textOf(svg: string): string {
  return [...svg.matchAll(/>([^<]+)</g)].map((m) => m[1].replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))).join('');
}

/**
 * Rasterize an SVG export (from `render`) at `scale`× without a browser, like the
 * app's PNG export. Loads the native resvg module on first use.
 */
export async function svgToPng(svgText: string, scale = 2): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js');
  const svg = bakeStyles(svgText);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    // Scanning system fonts costs as much as the render; only text the bundled faces lack needs them.
    font: { fontFiles: await jetBrainsMono(), loadSystemFonts: BEYOND_LATIN.test(textOf(svg)), defaultFontFamily: 'JetBrains Mono' },
  });
  return resvg.render().asPng();
}
