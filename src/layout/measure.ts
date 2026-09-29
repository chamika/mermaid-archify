import { iconsAsCells } from '../icons/fa';
import type { Compartment, Direction, IRNode } from '../ir/types';

/**
 * Text metrics. The UI font is monospace (JetBrains Mono, like Archify), so a
 * glyph advance is 0.6em everywhere; measurement is deterministic without a
 * canvas and identical in tests, workers and exported files.
 */
export const FONT = {
  label: 13,
  caption: 10,
  edge: 11,
  note: 11.5,
  lineHeight: 1.35,
};

export const charWidth = (size: number) => size * 0.6;

/**
 * Wide characters (CJK, Hangul, fullwidth forms, emoji) fall back to a
 * proportional font about twice a monospace cell wide; everything else is one
 * cell.
 */
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

export function cells(text: string): number {
  let n = 0;
  for (const ch of iconsAsCells(text)) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

export const textWidth = (text: string, size: number) => cells(text) * charWidth(size);

/** Split a run that is too wide for one line into chunks of at most `max` cells. */
function chunk(word: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cells(cur + ch) > max && cur) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Word-wrap a label to at most `maxCells` per line, honoring explicit breaks. */
export function wrap(text: string, maxCells: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const pieces = cells(word) > maxCells * 1.5 ? chunk(word, maxCells) : [word];
      for (const piece of pieces) {
        if (!line) line = piece;
        else if (cells(line) + 1 + cells(piece) <= maxCells) line += ' ' + piece;
        else {
          out.push(line);
          line = piece;
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export const NODE_MAX_CHARS = 22;
export const CAPTION_H = 14;

export interface NodeSize {
  w: number;
  h: number;
  lines: string[];
}

export function nodeSize(node: IRNode, direction: Direction, withCaption: boolean): NodeSize {
  const lines = node.label ? wrap(node.label, NODE_MAX_CHARS) : [];
  const textW = Math.max(0, ...lines.map((l) => textWidth(l, FONT.label)));
  const textH = lines.length * FONT.label * FONT.lineHeight;
  const vertical = direction === 'TB' || direction === 'BT';
  switch (node.shape) {
    case 'start':
    case 'end':
      return { w: 22, h: 22, lines: [] };
    case 'junction':
      return { w: 12, h: 12, lines: [] };
    case 'fork':
      return vertical ? { w: 90, h: 8, lines: [] } : { w: 8, h: 90, lines: [] };
    case 'diamond': {
      const w = Math.max(96, textW * 1.5 + 36);
      return { w, h: Math.max(64, textH * 1.6 + 36), lines };
    }
    case 'circle': {
      const d = Math.max(72, Math.max(textW, textH) + 36);
      return { w: d, h: d, lines };
    }
    case 'text':
      return { w: Math.ceil(Math.max(40, textW + 16)), h: Math.ceil(textH + 12), lines };
    case 'compartment': {
      const m = compartmentMetrics(node.label, node.annotation, node.compartments);
      return { w: m.w, h: m.h, lines: m.lines };
    }
    default: {
      const caption = withCaption && node.shape !== 'note' && node.type !== 'plain' ? CAPTION_H : 0;
      const pad = node.shape === 'cylinder' || node.shape === 'document' ? 18 : 0;
      const slant = node.shape === 'parallelogram' || node.shape === 'trapezoid' ? 28 : 0;
      return {
        w: Math.ceil(Math.max(128, textW + 36 + slant)),
        h: Math.ceil(Math.max(52, textH + caption + 24 + pad)),
        lines,
      };
    }
  }
}

export function edgeLabelSize(label: string): { w: number; h: number; lines: string[] } {
  const lines = wrap(label, 26);
  return {
    w: Math.ceil(Math.max(...lines.map((l) => textWidth(l, FONT.edge))) + 12),
    h: Math.ceil(lines.length * FONT.edge * FONT.lineHeight + 6),
    lines,
  };
}

/** Compartment boxes (ER entities, UML classes): a title band, then sections of aligned rows. */
export const ROW = {
  size: 12,
  h: 18,
  padX: 12,
  gap: 14,
  sectionPad: 5,
  headPad: 9,
  annotationH: 15,
  /** Longer cells are cut with an ellipsis; the details panel shows them whole. */
  maxCells: 40,
  titleChars: 30,
};

export function fitCell(text: string): string {
  return cells(text) <= ROW.maxCells ? text : `${chunk(text, ROW.maxCells - 1)[0]}…`;
}

export interface CompartmentMetrics {
  /** Title lines. */
  lines: string[];
  headH: number;
  /** Per section: top offset from the node's y, height, and column x offsets from the node's x. */
  sections: { y: number; h: number; colX: number[] }[];
  w: number;
  h: number;
}

/** Geometry shared by layout (sizing) and the renderer (drawing), so both agree exactly. */
export function compartmentMetrics(title: string, annotation: string | undefined, compartments: Compartment[] = []): CompartmentMetrics {
  const lines = title ? wrap(title, ROW.titleChars) : [];
  const lh = FONT.label * FONT.lineHeight;
  const headH = Math.ceil(Math.max(40, ROW.headPad * 2 + (annotation ? ROW.annotationH : 0) + lines.length * lh));
  let w = Math.max(
    120,
    ...lines.map((l) => textWidth(l, FONT.label) + ROW.padX * 2 + 8),
    annotation ? textWidth(`«${annotation}»`, FONT.caption) + ROW.padX * 2 : 0,
  );
  let y = headH;
  const sections: CompartmentMetrics['sections'] = [];
  for (const c of compartments) {
    if (!c.rows.length) continue;
    const colW = c.cols.map((_, i) => Math.max(0, ...c.rows.map((r) => textWidth(fitCell(r.cells[i] ?? ''), ROW.size))));
    const colX: number[] = [];
    let x = ROW.padX;
    for (const cw of colW) {
      colX.push(x);
      x += cw + ROW.gap;
    }
    w = Math.max(w, x - ROW.gap + ROW.padX);
    const h = ROW.sectionPad * 2 + c.rows.length * ROW.h;
    sections.push({ y, h, colX });
    y += h;
  }
  return { lines, headH, sections, w: Math.ceil(w), h: y };
}
