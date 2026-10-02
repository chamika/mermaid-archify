import { escapeHtml, escapeScript } from '../export/html';
import type { LayoutSettings } from '../layout/settings';
import type { Scene } from '../scene/types';

/** Options shared by the remark and markdown-it plugins. */
export interface EmbedOptions {
  /**
   * `'build'` (default): lay diagrams out at build time, so pages ship only the
   * viewer. `'client'`: emit the Mermaid source and render it in the browser
   * (the element then loads Mermaid + ELK on demand).
   */
  mode?: 'build' | 'client';
  /** Code block languages to replace. Default `['mermaid', 'mermaid-archify']`. */
  languages?: string[];
  /** `theme` attribute. Default `'auto'`: follow the host page. */
  theme?: 'auto' | 'light' | 'dark';
  /** `height` attribute (CSS length, or px). Default: the element's 480px. */
  height?: string | number;
  /** `false` hides the toolbar, legend and minimap. */
  controls?: boolean;
  /** Layout overrides applied to every diagram, on top of its front-matter. */
  layout?: LayoutSettings;
  /**
   * What to do when a diagram fails to parse at build time. `'throw'` (default)
   * fails the build with `file:line: message`; `'warn'` logs it and falls back to
   * client mode, so the page shows the error in place.
   */
  onError?: 'throw' | 'warn';
}

export const DEFAULT_LANGUAGES = ['mermaid', 'mermaid-archify'];

/** Element attributes, in order; values are unescaped. */
export type Attrs = [name: string, value: string][];

/**
 * Attributes for one diagram: the plugin options, overridden by `key=value`
 * pairs in the code block's info string (```` ```mermaid height=320 theme=light ````).
 */
export function elementAttrs(opts: EmbedOptions, meta: string | null | undefined): Attrs {
  const values: Record<string, string> = {};
  if (opts.theme && opts.theme !== 'auto') values.theme = opts.theme;
  if (opts.height !== undefined) values.height = String(opts.height);
  if (opts.controls === false) values.controls = 'false';
  for (const m of (meta ?? '').matchAll(/([a-z-]+)=("[^"]*"|'[^']*'|\S+)/g)) {
    if (['theme', 'height', 'controls'].includes(m[1])) values[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return Object.entries(values);
}

/**
 * `<mermaid-archify>` markup: the Scene inline as JSON, or the Mermaid source for
 * client rendering. `vue`: markup a Vue template compiles unchanged (VitePress),
 * which drops `<script>` tags and interpolates `{{ }}`: the Scene goes in the
 * `scene-json` attribute, the source is escaped text, and `v-pre` stops compilation.
 */
export function elementHtml(attrs: Attrs, content: { scene: Scene } | { source: string }, vue = false): string {
  if (vue) {
    const all: Attrs = 'scene' in content ? [...attrs, ['scene-json', JSON.stringify(content.scene)]] : attrs;
    const open = ['mermaid-archify v-pre', ...all.map(([k, v]) => `${k}="${escapeHtml(v)}"`)].join(' ');
    return `<${open}>${'source' in content ? escapeHtml(content.source) : ''}</mermaid-archify>\n`;
  }
  const open = ['mermaid-archify', ...attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`)].join(' ');
  const body =
    'scene' in content
      ? `<script type="application/json">${escapeScript(JSON.stringify(content.scene))}</script>`
      : `<script type="text/mermaid">${escapeScript(content.source)}</script>`;
  return `<${open}>${body}</mermaid-archify>\n`;
}

/** `file:line: message` for a diagram that failed to render. `line` is the fence's first line (1-based). */
export function diagramError(err: unknown, file: string | undefined, fenceLine: number | undefined): Error {
  const e = err as Error & { line?: number };
  const line = fenceLine !== undefined ? fenceLine + (e.line ?? 1) : undefined;
  const where = [file ?? '<markdown>', line].filter((x) => x !== undefined).join(':');
  return Object.assign(new Error(`mermaid-archify: ${where}: ${e.message}`), { cause: err });
}

/** Same source, same options: same Scene. Docs builds re-render unchanged pages often (dev servers, i18n copies). */
export function cacheKey(source: string, layout: LayoutSettings | undefined): string {
  return layout ? `${JSON.stringify(layout)}\0${source}` : source;
}
