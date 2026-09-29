import { readFileSync, readdirSync } from 'node:fs';
import LZString from 'lz-string';

const ROOT = `${process.cwd()}/test/corpus`;

export const INVALID: Record<string, string> = JSON.parse(readFileSync(`${ROOT}/invalid.json`, 'utf8'));

export const FIXTURES = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(`${ROOT}/${d.name}`)
      .filter((f) => f.endsWith('.mmd'))
      .map((f) => `${d.name}/${f.replace(/\.mmd$/, '')}`),
  )
  .sort();

export const source = (name: string) => readFileSync(`${ROOT}/${name}.mmd`, 'utf8');
export const urlFor = (src: string) => `/#src=${LZString.compressToEncodedURIComponent(src)}`;

/** Runs in the page: checks the rendered SVG with real fonts. Returns problems found. */
export function renderedProblems(): string[] {
  const problems: string[] = [];
  const svg = document.querySelector('.ma-svg') as SVGSVGElement | null;
  if (!svg) return ['no diagram rendered'];
  const within = (inner: DOMRect, outer: DOMRect, tol = 1) =>
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol;
  const fmt = (r: DOMRect) => `${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`;

  for (const el of svg.querySelectorAll('*'))
    for (const a of el.attributes)
      if (/NaN|Infinity|undefined/.test(a.value)) problems.push(`<${el.tagName} ${a.name}="${a.value.slice(0, 60)}">`);

  for (const g of svg.querySelectorAll<SVGGElement>('.ma-node')) {
    const body = g.querySelector<SVGGraphicsElement>('.body');
    if (!body) continue;
    const bb = body.getBBox();
    for (const icon of g.querySelectorAll<SVGPathElement>('.ma-icon')) {
      const ib = icon.getBoundingClientRect();
      const nb = body.getBoundingClientRect();
      if (!(ib.width > 0 && ib.left >= nb.left - 1 && ib.right <= nb.right + 1 && ib.top >= nb.top - 1 && ib.bottom <= nb.bottom + 1))
        problems.push(`icon in node ${g.dataset.id} is empty or outside the node`);
    }
    for (const t of g.querySelectorAll<SVGTextElement>('text.label, text.caption, text.row')) {
      if (!t.textContent?.trim()) continue;
      const tb = t.getBBox();
      if (!within(tb, bb)) problems.push(`${t.getAttribute('class')} of node ${g.dataset.id} overflows: text ${fmt(tb)} vs box ${fmt(bb)}`);
    }
  }
  for (const g of svg.querySelectorAll<SVGGElement>('.ma-edge')) {
    const t = g.querySelector<SVGTextElement>('.label-text');
    const r = g.querySelector<SVGRectElement>('.label-bg');
    if (t && r && !within(t.getBBox(), r.getBBox())) problems.push(`label of edge ${g.dataset.id} overflows its mask`);
  }
  for (const b of svg.querySelectorAll('.ma-block')) {
    const texts = b.querySelectorAll<SVGTextElement>('text.cond');
    const masks = b.querySelectorAll<SVGRectElement>('rect.cond-bg');
    texts.forEach((t, i) => {
      if (masks[i] && !within(t.getBBox(), masks[i].getBBox())) problems.push(`block condition "${t.textContent}" overflows its mask`);
    });
  }
  for (const n of svg.querySelectorAll('.ma-note')) {
    const t = n.querySelector('text')!;
    const r = n.querySelector('rect')!;
    if (!within(t.getBBox(), r.getBBox())) problems.push(`note "${t.textContent?.slice(0, 30)}" overflows`);
  }
  return problems;
}
