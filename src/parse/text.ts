import { encodeIcons, stripIconTokens } from '../icons/fa';

/** Line-break placeholder that survives Mermaid's HTML sanitizer. */
export const BR = '\u23CE';

/**
 * Prepare source for Mermaid without shifting line numbers: `<br>` becomes a
 * placeholder that survives sanitizing, and frontmatter and `%%` comment lines
 * become blank lines (Mermaid would otherwise delete them and misreport lines).
 */
export function prepareSource(source: string): string {
  let text = source.replace(/<br\s*\/?>/gi, BR);
  const fm = /^(\s*---[ \t]*\r?\n)([\s\S]*?\r?\n)(\s*---[ \t]*)(?=\r?\n|$)/.exec(text);
  if (fm) text = fm[0].replace(/[^\n]/g, '') + text.slice(fm[0].length);
  return text.replace(/^[ \t]*%%.*$/gm, '');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** Named entities common in diagrams; anything else is resolved via the DOM when available. */
const NAMED: Record<string, string> = {
  quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', infin: '∞', hearts: '♥', rarr: '→', larr: '←',
  harr: '↔', uarr: '↑', darr: '↓', rArr: '⇒', lArr: '⇐', hellip: '…', mdash: '—', ndash: '–', middot: '·',
  bull: '•', times: '×', divide: '÷', plusmn: '±', le: '≤', ge: '≥', ne: '≠', deg: '°', copy: '©', reg: '®',
  trade: '™', check: '✓', cross: '✗', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', lambda: 'λ', mu: 'μ',
  pi: 'π', sigma: 'σ', omega: 'ω', num: '#', semi: ';', colon: ':', lpar: '(', rpar: ')', lsqb: '[', rsqb: ']',
  lcub: '{', rcub: '}', vert: '|', excl: '!', quest: '?', commat: '@', percnt: '%',
};

function named(name: string): string {
  if (NAMED[name]) return NAMED[name];
  if (typeof document !== 'undefined') {
    const el = document.createElement('textarea');
    el.innerHTML = `&${name};`;
    if (el.value !== `&${name};`) return el.value;
  }
  return `&${name};`;
}

/**
 * Mermaid rewrites its entity syntax (`#quot;`, `#9829;`) into private
 * placeholders while parsing and only reverses them in its own renderer.
 */
export function decodeMermaidEntities(s: string): string {
  return s
    .replace(/ﬂ°°(\d+)¶ß/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/ﬂ°(\w+)¶ß/g, (_, name: string) => named(name));
}

/** Normalize Mermaid label markup (br tags, html, markdown backticks) to plain text with \n breaks. */
export interface CleanOptions {
  /** Keep Font Awesome tokens as inline icon markers (flowcharts); otherwise drop them. */
  icons?: boolean;
}

export function cleanLabel(raw: unknown, { icons = false }: CleanOptions = {}): string {
  let s = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
  s = decodeMermaidEntities(s)
    .replaceAll(BR, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/^"`|`"$/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1');
  // Mermaid renders `fa:` icons in flowcharts only; elsewhere the token is dropped.
  s = icons ? encodeIcons(s) : stripIconTokens(s);
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Decode code-like text (ER attribute types, class members) without treating
 * `<…>` as markup: `List<int>` must survive. Line breaks become spaces.
 */
export function decodeText(raw: unknown): string {
  return decodeMermaidEntities(String(raw ?? ''))
    .replaceAll(BR, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}
