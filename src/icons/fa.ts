/**
 * Font Awesome icons in labels (`fa:fa-car Car`, as in Mermaid flowcharts).
 *
 * Parsing replaces each token with an inline marker `style:name`
 * that travels with the label text, so wrapping and measuring stay correct; an
 * icon occupies ICON_CELLS monospace cells. Resolved path data is attached to
 * the IR/Scene, which keeps exported diagrams self-contained.
 */

export const ICON_CELLS = 2;
const OPEN = '';
const CLOSE = '';
export const MARKER_RE = /([\w-]+:[\w-]+)/g;

/** [viewBox width, viewBox height, path d] */
export type IconDef = [number, number, string];
export type IconSet = Record<string, IconDef>;

const TOKEN_RE = /(^|[^\w-])(fa[bklrs]?):fa-([\w-]+)[ \t]*/g;

/** `fa:fa-car Car` → `<marker> Car`. */
export function encodeIcons(text: string): string {
  return text.replace(TOKEN_RE, (_, lead: string, style: string, name: string, offset: number, all: string) => {
    const end = offset + _.length;
    const spacer = end < all.length && all[end] !== '\n' ? ' ' : '';
    return `${lead}${OPEN}${style}:${name}${CLOSE}${spacer}`;
  });
}

/** Drop icon tokens entirely (diagram types where Mermaid has no icon support). */
export const stripIconTokens = (text: string) => text.replace(TOKEN_RE, '$1');

export const hasIcons = (text: string) => text.includes(OPEN);

/** Label text for search, details panels and accessibility: icons removed. */
export function plainText(label: string): string {
  return label.replace(MARKER_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/^ +| +$/gm, '');
}

/** Human-readable form for snapshots and debugging: `[fa:car] Car`. */
export const describeIcons = (label: string) => label.replace(MARKER_RE, '[$1]');

export function iconKeys(label: string): string[] {
  return [...label.matchAll(MARKER_RE)].map((m) => m[1]);
}

export const removeIcon = (label: string, key: string) =>
  label.split(`${OPEN}${key}${CLOSE}`).join('').replace(/[ \t]{2,}/g, ' ').replace(/^ +| +$/gm, '');

export type Run = { text: string } | { icon: string };

/** Split one display line into text and icon runs. */
export function runs(line: string): Run[] {
  const out: Run[] = [];
  let last = 0;
  for (const m of line.matchAll(MARKER_RE)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    out.push({ icon: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/** Replace markers by same-width filler so cell counting treats an icon as ICON_CELLS. */
export const iconsAsCells = (text: string) => text.replace(MARKER_RE, 'M'.repeat(ICON_CELLS));
