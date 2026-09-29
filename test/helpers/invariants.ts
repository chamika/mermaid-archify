import { expect } from 'vitest';
import { FONT, ROW, compartmentMetrics, edgeLabelSize, fitCell, textWidth } from '../../src/layout/measure';
import { iconKeys } from '../../src/icons/fa';
import { nearestOnPath } from '../../src/layout/elkGraph';
import type { Box, Pt, Scene } from '../../src/scene/types';

export const overlaps = (a: Box, b: Box, slack = 0) =>
  a.x + slack < b.x + b.w && b.x + slack < a.x + a.w && a.y + slack < b.y + b.h && b.y + slack < a.y + a.h;

export const inside = (inner: Box, outer: Box, tol = 0.5) =>
  inner.x >= outer.x - tol &&
  inner.y >= outer.y - tol &&
  inner.x + inner.w <= outer.x + outer.w + tol &&
  inner.y + inner.h <= outer.y + outer.h + tol;

export function onBoundary(p: Pt, b: Box, tol = 1.5) {
  const withinX = p.x >= b.x - tol && p.x <= b.x + b.w + tol;
  const withinY = p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  const onV = Math.abs(p.x - b.x) <= tol || Math.abs(p.x - (b.x + b.w)) <= tol;
  const onH = Math.abs(p.y - b.y) <= tol || Math.abs(p.y - (b.y + b.h)) <= tol;
  return withinX && withinY && (onV || onH);
}

const finite = (...vs: number[]) => vs.every((v) => Number.isFinite(v));

/** Markup or Mermaid internals that must never reach a rendered label. */
const LEAKS = /ﬂ°|¶ß|<\/?(br|b|i|em|strong|span|div|sub|sup)\b[^>]*>|&(amp|lt|gt|quot|nbsp|#\d+);/i;

/**
 * Geometry and content invariants every laid-out Scene must satisfy. `where`
 * prefixes messages so a corpus failure names its fixture.
 */
export function checkScene(s: Scene, where = '') {
  const at = (msg: string) => `${where}${where ? ': ' : ''}${msg}`;
  expect(finite(s.width, s.height) && s.width > 0 && s.height > 0, at('canvas size')).toBe(true);
  const canvas = { x: 0, y: 0, w: s.width, h: s.height };
  const boxes = new Map<string, Box>([...s.groups, ...s.nodes].map((n) => [n.id, n]));

  for (const n of [...s.nodes, ...s.groups, ...(s.seq?.footers ?? []), ...(s.seq?.notes ?? []), ...(s.seq?.blocks ?? [])]) {
    const id = 'id' in n ? n.id : '?';
    expect(finite(n.x, n.y, n.w, n.h), at(`${id} has non-finite geometry`)).toBe(true);
    expect(inside(n, canvas, 1), at(`${id} outside the canvas`)).toBe(true);
  }

  // Content: no leaked markup, labels fit their boxes.
  for (const n of s.nodes) {
    expect(LEAKS.test(n.label), at(`node ${n.id} label leaks markup: ${JSON.stringify(n.label)}`)).toBe(false);
    if (['rect', 'rounded', 'cylinder', 'subroutine', 'hexagon', 'participant', 'actor', 'document', 'parallelogram', 'trapezoid', 'note', 'text'].includes(n.shape)) {
      const widest = Math.max(0, ...n.lines.map((l) => textWidth(l, FONT.label)));
      expect(widest, at(`node ${n.id} label wider than its box`)).toBeLessThanOrEqual(n.w - 16);
      const tall = n.lines.length * FONT.label * FONT.lineHeight;
      expect(tall, at(`node ${n.id} label taller than its box`)).toBeLessThanOrEqual(n.h);
    }
  }
  // Compartments: title, «annotation» and every row fit the box; sections stack inside it.
  for (const n of s.nodes) {
    if (n.shape !== 'compartment') continue;
    const m = compartmentMetrics(n.label, n.annotation, n.compartments);
    for (const l of m.lines) expect(textWidth(l, FONT.label), at(`title of ${n.id} wider than its box`)).toBeLessThanOrEqual(n.w - 16);
    const sections = (n.compartments ?? []).filter((c) => c.rows.length);
    expect(m.sections.length, at(`${n.id} section count`)).toBe(sections.length);
    sections.forEach((c, i) => {
      const sec = m.sections[i];
      expect(sec.y + sec.h, at(`section ${i} of ${n.id} below its box`)).toBeLessThanOrEqual(n.h + 0.5);
      for (const r of c.rows) {
        expect(LEAKS.test(r.cells.join(' ')), at(`row of ${n.id} leaks markup: ${JSON.stringify(r.cells)}`)).toBe(false);
        r.cells.forEach((cell, k) => {
          const right = sec.colX[k] + textWidth(fitCell(cell), ROW.size);
          expect(right, at(`row ${JSON.stringify(cell)} of ${n.id} wider than its box`)).toBeLessThanOrEqual(n.w - ROW.padX + 0.5);
        });
      }
    });
  }
  for (const e of s.edges) {
    if (e.label) expect(LEAKS.test(e.label), at(`edge ${e.id} label leaks markup: ${JSON.stringify(e.label)}`)).toBe(false);
  }
  for (const g of s.groups) expect(LEAKS.test(g.label), at(`group ${g.id} label leaks markup`)).toBe(false);

  // Icons: no raw Font Awesome token survives, and every inline icon has path data.
  for (const text of [...s.nodes.map((n) => n.label), ...s.edges.map((e) => e.label ?? ''), ...s.groups.map((g) => g.label)]) {
    expect(/\bfa[bklrs]?:fa-/.test(text), at(`raw icon token in ${JSON.stringify(text)}`)).toBe(false);
    for (const key of iconKeys(text)) expect(s.icons?.[key], at(`icon ${key} has no path data`)).toBeDefined();
  }

  // Nodes never overlap each other.
  for (let i = 0; i < s.nodes.length; i++)
    for (let j = i + 1; j < s.nodes.length; j++)
      expect(overlaps(s.nodes[i], s.nodes[j]), at(`${s.nodes[i].id} overlaps ${s.nodes[j].id}`)).toBe(false);

  if (s.seq) return checkSequence(s, at);

  // Hierarchy: children inside their group; sibling groups disjoint; nodes not inside unrelated groups.
  for (const n of [...s.nodes, ...s.groups])
    if (n.parent) expect(inside(n, boxes.get(n.parent)!), at(`${n.id} outside its group ${n.parent}`)).toBe(true);
  for (let i = 0; i < s.groups.length; i++)
    for (let j = i + 1; j < s.groups.length; j++) {
      const a = s.groups[i];
      const b = s.groups[j];
      if (a.parent === b.parent) expect(overlaps(a, b), at(`groups ${a.id} and ${b.id} overlap`)).toBe(false);
    }

  // Edges: attached to their endpoints, inside the canvas, labels clear of nodes.
  const detached: { id: string; gap: number }[] = [];
  for (const e of s.edges) {
    expect(e.points.length, at(`edge ${e.id} has no route`)).toBeGreaterThanOrEqual(2);
    for (const p of e.points) {
      expect(finite(p.x, p.y), at(`edge ${e.id} non-finite point`)).toBe(true);
      expect(p.x >= -1 && p.x <= s.width + 1 && p.y >= -1 && p.y <= s.height + 1, at(`edge ${e.id} leaves the canvas`)).toBe(true);
    }
    expect(onBoundary(e.points[0], boxes.get(e.from)!), at(`edge ${e.id} does not start on ${e.from}`)).toBe(true);
    expect(onBoundary(e.points.at(-1)!, boxes.get(e.to)!), at(`edge ${e.id} does not end on ${e.to}`)).toBe(true);
    if (e.labelBox) {
      const c = { x: e.labelBox.x + e.labelBox.w / 2, y: e.labelBox.y + e.labelBox.h / 2 };
      const q = nearestOnPath(e.points, c);
      const gap = Math.max(Math.abs(q.x - c.x) - e.labelBox.w / 2, Math.abs(q.y - c.y) - e.labelBox.h / 2, 0);
      detached.push({ id: e.id, gap });
      for (const n of s.nodes)
        expect(overlaps(e.labelBox, n, 1), at(`edge ${e.id} label covers node ${n.id}`)).toBe(false);
    }
  }
  // End labels (multiplicities) stay on the canvas and off every node.
  for (const e of s.edges)
    for (const l of e.endLabels ?? []) {
      const { w, h } = edgeLabelSize(l.text);
      const box = { x: l.x - w / 2, y: l.y - h / 2, w, h };
      expect(inside(box, canvas, 1), at(`end label ${JSON.stringify(l.text)} of ${e.id} outside the canvas`)).toBe(true);
      for (const n of s.nodes) expect(overlaps(box, n, 1), at(`end label ${JSON.stringify(l.text)} of ${e.id} covers node ${n.id}`)).toBe(false);
    }
  // Labels sit on (or right beside) their own route, and never on each other.
  for (const d of detached) expect(d.gap, at(`label of ${d.id} is ${d.gap.toFixed(0)}px away from its edge`)).toBeLessThanOrEqual(maxLabelGap);
  const boxes2 = s.edges.flatMap((e) => (e.labelBox ? [{ id: e.id, b: e.labelBox }] : []));
  for (let i = 0; i < boxes2.length; i++)
    for (let j = i + 1; j < boxes2.length; j++)
      expect(overlaps(boxes2[i].b, boxes2[j].b, 1), at(`labels ${boxes2[i].id} and ${boxes2[j].id} overlap`)).toBe(false);
}

/** How far a label may sit from its own edge when re-anchoring onto it was blocked. */
export const maxLabelGap = 12;

function checkSequence(s: Scene, at: (m: string) => string) {
  const seq = s.seq!;
  const lifeline = new Map(seq.lifelines.map((l) => [l.actor, l.x]));
  // Participants left to right in declared order, headers and footers aligned.
  for (let i = 1; i < s.nodes.length; i++)
    expect(s.nodes[i].x, at(`participant ${s.nodes[i].id} out of order`)).toBeGreaterThan(s.nodes[i - 1].x + s.nodes[i - 1].w);
  seq.footers.forEach((f, i) => expect(f.x, at('footer misaligned')).toBe(s.nodes[i].x));

  let lastY = -Infinity;
  for (const e of s.edges) {
    const [a, b] = [e.points[0], e.points.at(-1)!];
    expect(finite(a.x, a.y, b.x, b.y), at(`message ${e.id} non-finite`)).toBe(true);
    // Messages run top to bottom, in authored order.
    expect(a.y, at(`message ${e.id} out of order`)).toBeGreaterThan(lastY);
    lastY = a.y;
    // Anchored to lifelines (allowing for activation bar offsets).
    expect(Math.abs(a.x - lifeline.get(e.from)!), at(`message ${e.id} detached from ${e.from}`)).toBeLessThanOrEqual(24);
    expect(Math.abs(b.x - lifeline.get(e.to)!), at(`message ${e.id} detached from ${e.to}`)).toBeLessThanOrEqual(24);
    expect(a.y > seq.lifelines[0].y1 && a.y < seq.lifelines[0].y2, at(`message ${e.id} outside the lifelines`)).toBe(true);
  }
  const labels = s.edges.flatMap((e) => (e.labelBox ? [{ id: e.id, b: e.labelBox }] : []));
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      expect(overlaps(labels[i].b, labels[j].b, 1), at(`labels ${labels[i].id} and ${labels[j].id} overlap`)).toBe(false);
  for (const n of seq.notes)
    for (const l of labels) expect(overlaps(n, l.b, 1), at(`note ${n.id} covers label ${l.id}`)).toBe(false);
  // Blocks enclose everything drawn within their rows.
  for (const b of seq.blocks) {
    const rows = (y: number) => y > b.y && y < b.y + b.h;
    for (const n of seq.notes)
      if (rows(n.y + n.h / 2)) expect(n.x >= b.x - 1 && n.x + n.w <= b.x + b.w + 1, at(`note ${n.id} sticks out of block ${b.id}`)).toBe(true);
    for (const e of s.edges) {
      if (!rows(e.points[0].y)) continue;
      const xs = [...e.points.map((p) => p.x), ...(e.labelBox ? [e.labelBox.x, e.labelBox.x + e.labelBox.w] : [])];
      expect(Math.min(...xs) >= b.x - 1 && Math.max(...xs) <= b.x + b.w + 1, at(`message ${e.id} sticks out of block ${b.id}`)).toBe(true);
    }
  }
  // Blocks are properly nested: two blocks either nest or are disjoint vertically.
  for (let i = 0; i < seq.blocks.length; i++)
    for (let j = i + 1; j < seq.blocks.length; j++) {
      const [p, q] = [seq.blocks[i], seq.blocks[j]];
      const disjoint = p.y + p.h <= q.y || q.y + q.h <= p.y;
      expect(disjoint || inside(p, q, 1) || inside(q, p, 1), at(`blocks ${p.id} and ${q.id} cross`)).toBe(true);
    }
}
