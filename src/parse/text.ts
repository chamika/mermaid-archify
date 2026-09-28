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

/** Normalize Mermaid label markup (br tags, html, markdown backticks) to plain text with \n breaks. */
export function cleanLabel(raw: unknown): string {
  let s = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
  s = s
    .replaceAll(BR, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/^"`|`"$/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\\n/g, '\n');
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}
