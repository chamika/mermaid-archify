import type { DiagramIR, SeqBlockType } from '../ir/types';
import type { Pt, Scene, SceneActivation, SceneBlock, SceneEdge, SceneNode, SceneNote } from '../scene/types';
import { FONT, edgeLabelSize, textWidth, wrap } from './measure';

const MARGIN = 32;
const HEAD_H = 56;
const COL_GAP = 48;
const SELF_W = 44;
const ACT_W = 10;
const BLOCK_PAD = 18;
const NOTE_MAX = 30;

/** Deterministic sequence layout: participant columns, one row per event. */
export function layoutSequence(ir: DiagramIR): Scene {
  const events = ir.events ?? [];
  const index = new Map(ir.nodes.map((n, i) => [n.id, i]));
  const widths = ir.nodes.map((n) => Math.max(120, Math.ceil(textWidth(n.label, FONT.label) + 36)));

  // --- columns: minimum centre distance between neighbours ---
  const need: number[] = ir.nodes.map((_, i) => (i === 0 ? 0 : (widths[i - 1] + widths[i]) / 2 + COL_GAP));
  const spans: { a: number; b: number; w: number }[] = [];
  for (const ev of events) {
    if (ev.kind === 'message') {
      const a = index.get(ev.from)!;
      const b = index.get(ev.to)!;
      const w = edgeLabelSize(ev.label || ' ').w + 36;
      if (a === b) {
        if (a + 1 < need.length) need[a + 1] = Math.max(need[a + 1], w + SELF_W);
      } else spans.push({ a: Math.min(a, b), b: Math.max(a, b), w });
    } else if (ev.kind === 'note') {
      const ids = ev.over.map((id) => index.get(id)!).sort((x, y) => x - y);
      const w = Math.max(...wrap(ev.text, NOTE_MAX).map((l) => textWidth(l, FONT.note))) + 28;
      if (ev.placement === 'right' && ids[0] + 1 < need.length) need[ids[0] + 1] = Math.max(need[ids[0] + 1], w + 24);
      if (ev.placement === 'left' && ids[0] > 0) need[ids[0]] = Math.max(need[ids[0]], w + 24);
      if (ids.length > 1) spans.push({ a: ids[0], b: ids.at(-1)!, w: w - 40 });
    }
  }
  const cx: number[] = [];
  ir.nodes.forEach((_, i) => {
    cx[i] = i === 0 ? MARGIN + widths[0] / 2 : cx[i - 1] + need[i];
  });
  // Widen for labels spanning several columns, spreading the extra evenly.
  for (const s of spans.sort((x, y) => x.b - x.a - (y.b - y.a))) {
    const have = cx[s.b] - cx[s.a];
    if (have >= s.w) continue;
    const per = (s.w - have) / (s.b - s.a);
    for (let i = s.a + 1; i < cx.length; i++) cx[i] += per * Math.min(i - s.a, s.b - s.a);
  }

  const header = (y: number): SceneNode[] =>
    ir.nodes.map((n, i) => ({
      id: n.id,
      label: n.label,
      lines: [n.label],
      type: n.type,
      shape: n.shape,
      x: cx[i] - widths[i] / 2,
      y,
      w: widths[i],
      h: HEAD_H,
    }));

  // --- rows ---
  let y = MARGIN + HEAD_H + 28;
  const edges: SceneEdge[] = [];
  const notes: SceneNote[] = [];
  const blocks: SceneBlock[] = [];
  const activations: SceneActivation[] = [];
  const active = new Map<string, number[]>(); // actor -> stack of start y
  const openBlocks: {
    id: string;
    type: SeqBlockType;
    label: string;
    y: number;
    sections: { y: number; label: string }[];
    cols: Set<number>;
  }[] = [];
  let lastMessageY = y;

  const actOffset = (actor: string, towardsRight: boolean) => {
    const depth = active.get(actor)?.length ?? 0;
    if (!depth) return 0;
    return (towardsRight ? ACT_W / 2 : -ACT_W / 2) + (depth - 1) * 4;
  };
  const touch = (...cols: number[]) => {
    for (const b of openBlocks) for (const c of cols) b.cols.add(c);
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'message': {
        const a = index.get(ev.from)!;
        const b = index.get(ev.to)!;
        const label = edgeLabelSize(ev.label || ' ');
        const labelH = ev.label ? label.h : 0;
        touch(a, b);
        let points: Pt[];
        let labelBox;
        if (a === b) {
          const x = cx[a] + actOffset(ev.from, true);
          y += labelH + 6;
          points = [
            { x, y },
            { x: x + SELF_W, y },
            { x: x + SELF_W, y: y + 22 },
            { x: cx[a] + actOffset(ev.from, true), y: y + 22 },
          ];
          if (ev.label) labelBox = { x: x + 8, y: y - label.h - 3, w: label.w, h: label.h };
          lastMessageY = y;
          y += 22 + 26;
        } else {
          const right = b > a;
          y += labelH + 4;
          const x1 = cx[a] + actOffset(ev.from, right);
          const x2 = cx[b] + actOffset(ev.to, !right);
          points = [
            { x: x1, y },
            { x: x2, y },
          ];
          if (ev.label) labelBox = { x: (x1 + x2) / 2 - label.w / 2, y: y - label.h - 3, w: label.w, h: label.h };
          lastMessageY = y;
          y += 30;
        }
        edges.push({
          id: ev.id,
          from: ev.from,
          to: ev.to,
          label: ev.label || undefined,
          points,
          labelBox,
          stroke: ev.stroke,
          arrowEnd: ev.arrow !== 'open',
          arrowStart: ev.bidirectional,
          arrowStyle: ev.arrow,
          order: edges.length,
        });
        break;
      }
      case 'note': {
        const cols = ev.over.map((id) => index.get(id)!).sort((p, q) => p - q);
        touch(...cols);
        const lines = wrap(ev.text, NOTE_MAX);
        const w = Math.max(...lines.map((l) => textWidth(l, FONT.note))) + 24;
        const h = lines.length * FONT.note * FONT.lineHeight + 16;
        let x: number;
        let width = w;
        if (ev.placement === 'right') x = cx[cols[0]] + 14;
        else if (ev.placement === 'left') x = cx[cols[0]] - 14 - w;
        else if (cols.length > 1) {
          x = cx[cols[0]] - 24;
          width = Math.max(w, cx[cols.at(-1)!] - cx[cols[0]] + 48);
        } else x = cx[cols[0]] - w / 2;
        notes.push({ id: ev.id, text: ev.text, lines, x, y: y - 6, w: width, h });
        y += h + 16;
        break;
      }
      case 'blockStart':
        y += 8;
        openBlocks.push({ id: ev.id, type: ev.type, label: ev.label, y, sections: [], cols: new Set() });
        y += 34;
        break;
      case 'blockSection': {
        const b = openBlocks.find((o) => o.id === ev.id) ?? openBlocks.at(-1);
        if (b) {
          b.sections.push({ y: y - 8, label: ev.label });
          y += 28;
        }
        break;
      }
      case 'blockEnd': {
        const i = openBlocks.findIndex((o) => o.id === ev.id);
        const b = openBlocks.splice(i >= 0 ? i : openBlocks.length - 1, 1)[0];
        if (!b) break;
        const nesting = openBlocks.length;
        const cols = b.cols.size ? [...b.cols] : ir.nodes.map((_, k) => k);
        const lo = Math.min(...cols);
        const hi = Math.max(...cols);
        const inset = nesting * 8;
        const left = cx[lo] - Math.max(widths[lo] / 2, 60) + inset - BLOCK_PAD + 12;
        const right = cx[hi] + Math.max(widths[hi] / 2, 60) - inset + BLOCK_PAD - 12;
        const selfPad = edges.some((e) => e.from === e.to && index.get(e.from) === hi) ? SELF_W + 20 : 0;
        blocks.push({
          id: b.id,
          type: b.type,
          label: b.label,
          sections: b.sections,
          x: left,
          y: b.y,
          w: right - left + selfPad,
          h: y - b.y - 2,
        });
        touch(...cols);
        y += 14;
        break;
      }
      case 'activate': {
        const stack = active.get(ev.actor) ?? [];
        stack.push(lastMessageY);
        active.set(ev.actor, stack);
        break;
      }
      case 'deactivate': {
        const start = active.get(ev.actor)?.pop();
        if (start === undefined) break;
        const depth = active.get(ev.actor)!.length;
        const i = index.get(ev.actor)!;
        activations.push({ actor: ev.actor, x: cx[i] - ACT_W / 2 + depth * 4, y: start, w: ACT_W, h: lastMessageY - start });
        break;
      }
    }
  }
  // Close any activation left open.
  for (const [actor, stack] of active) {
    const i = index.get(actor)!;
    stack.forEach((start, depth) =>
      activations.push({ actor, x: cx[i] - ACT_W / 2 + depth * 4, y: start, w: ACT_W, h: y - start - 10 }),
    );
  }

  const footY = y + 10;
  const nodes = header(MARGIN);
  const footers = header(footY);
  const lifelines = ir.nodes.map((n, i) => ({ actor: n.id, x: cx[i], y1: MARGIN + HEAD_H, y2: footY }));

  const extents = [
    ...nodes.map((n) => n.x + n.w),
    ...notes.map((n) => n.x + n.w),
    ...blocks.map((b) => b.x + b.w),
    ...edges.flatMap((e) => e.points.map((p) => p.x)),
    ...edges.map((e) => (e.labelBox ? e.labelBox.x + e.labelBox.w : 0)),
  ];
  const minX = Math.min(MARGIN, ...notes.map((n) => n.x), ...blocks.map((b) => b.x));
  const shift = minX < MARGIN ? MARGIN - minX : 0;
  if (shift) {
    for (const n of [...nodes, ...footers, ...notes, ...blocks, ...activations]) n.x += shift;
    for (const l of lifelines) l.x += shift;
    for (const e of edges) {
      e.points = e.points.map((p) => ({ x: p.x + shift, y: p.y }));
      if (e.labelBox) e.labelBox.x += shift;
    }
  }

  return {
    version: 1,
    kind: 'sequence',
    title: ir.title,
    width: Math.ceil(Math.max(...extents) + shift + MARGIN),
    height: Math.ceil(footY + HEAD_H + MARGIN),
    nodes,
    groups: [],
    edges,
    seq: { lifelines, activations, notes, blocks, footers },
  };
}
