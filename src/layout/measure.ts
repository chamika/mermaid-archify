import type { Direction, IRNode } from '../ir/types';

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
export const textWidth = (text: string, size: number) => text.length * charWidth(size);

/** Word-wrap a label to at most `maxChars` per line, honoring explicit breaks. */
export function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > maxChars * 1.5) {
        out.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
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
    default: {
      const caption = withCaption ? CAPTION_H : 0;
      const pad = node.shape === 'cylinder' ? 18 : 0;
      return {
        w: Math.ceil(Math.max(128, textW + 36)),
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
