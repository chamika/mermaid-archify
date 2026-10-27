import type { Direction } from '../ir/types';

/**
 * User layout settings. They live in the source's front-matter under
 * `config.archify`, so they travel with the diagram (and its share link);
 * Mermaid ignores config keys it does not know.
 */

export type Routing = 'orthogonal' | 'polyline' | 'splines';
export type Placement = 'network-simplex' | 'brandes-koepf' | 'linear-segments' | 'simple';
/**
 * How a diagram is coloured beyond its component types. `groups` gives each
 * top-level subgraph its own hue and tints its nodes and outgoing edges;
 * `depth` shades subgraphs by nesting level; `regions` tints a flowchart's
 * loops, decisions and failure paths; `mono` keeps the neutral look. `auto`
 * applies only when no node has a component type (a process flow, not an
 * architecture map): `groups` when there are subgraphs, else `regions`.
 */
export type Palette = 'auto' | 'groups' | 'depth' | 'regions' | 'mono';

export interface LayoutSettings {
  /** Overrides the direction written in the source. */
  direction?: Direction;
  nodeSpacing?: number;
  rankSpacing?: number;
  routing?: Routing;
  placement?: Placement;
  palette?: Palette;
  /** Hand-placed nodes: offset in scene px from the automatic position, by node id. */
  pins?: Pins;
}

export type Pins = Record<string, [number, number]>;

export const DIRECTIONS: readonly Direction[] = ['LR', 'RL', 'TB', 'BT'];
export const ROUTINGS: readonly Routing[] = ['orthogonal', 'polyline', 'splines'];
export const PLACEMENTS: readonly Placement[] = ['network-simplex', 'brandes-koepf', 'linear-segments', 'simple'];
export const PALETTES: readonly Palette[] = ['auto', 'groups', 'depth', 'regions', 'mono'];

export const DEFAULTS = { nodeSpacing: 44, rankSpacing: 72, routing: 'orthogonal', placement: 'network-simplex', palette: 'auto' } as const;
export const RANGES = { nodeSpacing: [12, 160], rankSpacing: [24, 240] } as const;
/** Largest pin offset kept, either axis; beyond this it is a typo, not a nudge. */
const MAX_PIN = 5000;

/** Front-matter with its three parts: opening fence, body, closing fence. Same shape `prepareSource` blanks. */
const FRONT = /^(\s*---[ \t]*\r?\n)([\s\S]*?\r?\n)?(\s*---[ \t]*)(?=\r?\n|$)/;

const KEYS = ['direction', 'nodeSpacing', 'rankSpacing', 'routing', 'placement', 'palette'] as const;

/** Keep only known keys with valid values; numbers are rounded and clamped; defaults are dropped. */
export function normalize(raw: Record<string, unknown>): LayoutSettings {
  const out: LayoutSettings = {};
  // `TD` is Mermaid's spelling of top-down.
  const dir = String(raw.direction ?? '').toUpperCase().replace(/^TD$/, 'TB');
  if (DIRECTIONS.includes(dir as Direction)) out.direction = dir as Direction;
  for (const key of ['nodeSpacing', 'rankSpacing'] as const) {
    const v = Number(raw[key]);
    if (raw[key] === undefined || raw[key] === '' || !Number.isFinite(v)) continue;
    const [lo, hi] = RANGES[key];
    const n = Math.round(Math.min(hi, Math.max(lo, v)));
    if (n !== DEFAULTS[key]) out[key] = n;
  }
  const routing = String(raw.routing ?? '').toLowerCase();
  if (ROUTINGS.includes(routing as Routing) && routing !== DEFAULTS.routing) out.routing = routing as Routing;
  const placement = String(raw.placement ?? '').toLowerCase();
  if (PLACEMENTS.includes(placement as Placement) && placement !== DEFAULTS.placement) out.placement = placement as Placement;
  const palette = String(raw.palette ?? '').toLowerCase();
  if (PALETTES.includes(palette as Palette) && palette !== DEFAULTS.palette) out.palette = palette as Palette;
  const pins = normalizePins(raw.pins);
  if (pins) out.pins = pins;
  return out;
}

/** Finite, rounded, clamped offsets in id order; [0, 0] means "not pinned" and is dropped. */
function normalizePins(raw: unknown): Pins | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Pins = {};
  for (const id of Object.keys(raw).sort()) {
    const v = (raw as Record<string, unknown>)[id];
    if (!id || !Array.isArray(v) || v.length !== 2) continue;
    const [dx, dy] = v.map((n) => Math.round(Math.min(MAX_PIN, Math.max(-MAX_PIN, Number(n))) || 0));
    if (!Number.isFinite(Number(v[0])) || !Number.isFinite(Number(v[1])) || (!dx && !dy)) continue;
    out[id] = [dx, dy];
  }
  return Object.keys(out).length ? out : undefined;
}

/** A pin key as written: bare when it is a plain identifier, else a JSON string. */
const pinKey = (id: string) => (/^[A-Za-z_][\w-]*$/.test(id) ? id : JSON.stringify(id));

/** The archify block's entries as lines relative to its own indent. */
function entryLines(clean: LayoutSettings): string[] {
  return [...KEYS.filter((k) => clean[k] !== undefined).map((k) => `${k}: ${clean[k]}`), ...pinLines(clean)];
}

const pinLines = (clean: LayoutSettings) =>
  clean.pins ? ['pins:', ...Object.entries(clean.pins).map(([id, [dx, dy]]) => `  ${pinKey(id)}: [${dx}, ${dy}]`)] : [];

/** A trailing `# comment` on a line, with the space before it. */
const trailingComment = (text: string) => /\s+#.*$/.exec(text)?.[0] ?? '';

/**
 * The archify block rewritten for `clean`: known keys are updated in place (keeping
 * their trailing comments) or dropped; comments, blank lines and keys we do not
 * know, with anything nested under them, are kept; new keys go at the end.
 */
function rewriteBlock(lines: Line[], at: number, clean: LayoutSettings): { block: string[]; empty: boolean } {
  const end = blockEnd(lines, at);
  const indent = lines.slice(at + 1, end).find((l) => !blank(l))?.indent ?? lines[at].indent + 2;
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  const done = new Set<string>();
  let kept = false;
  for (let i = at + 1; i < end; i++) {
    const l = lines[i];
    if (blank(l) || l.indent !== indent || !l.key) {
      out.push(l.text);
      continue;
    }
    const sub = blockEnd(lines, i);
    if ((KEYS as readonly string[]).includes(l.key)) {
      const k = l.key as (typeof KEYS)[number];
      if (clean[k] !== undefined && !done.has(k)) out.push(`${pad}${k}: ${clean[k]}${trailingComment(l.value ?? '')}`);
      done.add(k);
    } else if (l.key === 'pins') {
      if (!done.has('pins')) out.push(...pinLines(clean).map((p) => pad + p));
      done.add('pins');
    } else {
      out.push(...lines.slice(i, sub).map((x) => x.text));
      kept = true;
    }
    i = sub - 1;
  }
  for (const k of KEYS) if (clean[k] !== undefined && !done.has(k)) out.push(`${pad}${k}: ${clean[k]}`);
  if (!done.has('pins')) out.push(...pinLines(clean).map((p) => pad + p));
  // Trailing blank lines belong after the block, not inside it.
  let tail = out.length;
  while (tail > 0 && !out[tail - 1].trim()) tail--;
  const block = [lines[at].text, ...out.slice(0, tail)];
  return { block: [...block, ...out.slice(tail)], empty: !kept && !entryLines(clean).length };
}

interface Line {
  text: string;
  indent: number;
  key?: string;
  value?: string;
}

function parseLine(text: string): Line {
  const indent = /^[ \t]*/.exec(text)![0].length;
  // Keys are bare identifiers or quoted strings (pin ids can hold anything).
  const m = /^[ \t]*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/.exec(text);
  if (!m || text.trimStart().startsWith('#')) return { text, indent };
  // `config: # layout` has no value: in YAML a `#` after a space starts a comment.
  const value = m[2]?.startsWith('#') ? undefined : m[2];
  return { text, indent, key: unquoteKey(m[1]), value };
}

function unquoteKey(k: string): string {
  if (k.startsWith('"')) {
    try {
      return JSON.parse(k);
    } catch {
      return k.slice(1, -1);
    }
  }
  return k.startsWith("'") ? k.slice(1, -1) : k;
}

const blank = (l: Line) => !l.text.trim() || l.text.trimStart().startsWith('#');

/** Index range [start, end) of the lines nested under `lines[at]` (by indentation). */
function blockEnd(lines: Line[], at: number): number {
  let end = at + 1;
  for (let i = at + 1; i < lines.length; i++) {
    if (blank(lines[i])) continue;
    if (lines[i].indent <= lines[at].indent) break;
    end = i + 1;
  }
  return end;
}

function findChild(lines: Line[], from: number, to: number, key: string, indent?: number): number {
  let childIndent = indent;
  for (let i = from; i < to; i++) {
    if (blank(lines[i])) continue;
    childIndent ??= lines[i].indent;
    if (lines[i].indent === childIndent && lines[i].key === key) return i;
  }
  return -1;
}

const unquote = (v: string) => v.replace(/\s+#.*$/, '').replace(/^(["'])(.*)\1$/, '$2');

interface Located {
  lines: Line[];
  /** Index of `config:` (or -1). */
  config: number;
  /** Index of `archify:` under config (or -1). */
  archify: number;
  /** A flow-style (`{…}`) value we will not edit by hand. */
  flow: boolean;
}

function locate(body: string): Located {
  const lines = body.split(/\r?\n/).map(parseLine);
  const config = findChild(lines, 0, lines.length, 'config', 0);
  let archify = -1;
  let flow = false;
  if (config >= 0) {
    if (lines[config].value) flow = true;
    else {
      archify = findChild(lines, config + 1, blockEnd(lines, config), 'archify');
      if (archify >= 0 && lines[archify].value) flow = true;
    }
  }
  return { lines, config, archify, flow };
}

/** Read `config.archify` from the source's front-matter. */
export function readLayoutSettings(source: string): LayoutSettings {
  const fm = FRONT.exec(source);
  if (!fm?.[2]) return {};
  const { lines, archify, flow } = locate(fm[2]);
  if (archify < 0 || flow) return {};
  const raw: Record<string, unknown> = {};
  const end = blockEnd(lines, archify);
  const childIndent = lines.slice(archify + 1, end).find((l) => !blank(l))?.indent;
  for (let i = archify + 1; i < end; i++) {
    const l = lines[i];
    if (!l.key || l.indent !== childIndent) continue;
    if (l.value !== undefined) raw[l.key] = unquote(l.value);
    else if (l.key === 'pins') raw.pins = readPins(lines, i);
  }
  return normalize(raw);
}

/** `pins:` children, each `id: [dx, dy]`. */
function readPins(lines: Line[], at: number): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (let i = at + 1; i < blockEnd(lines, at); i++) {
    const l = lines[i];
    const m = l.key && /^\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]$/.exec(unquote(l.value ?? ''));
    if (m) out[l.key!] = [Number(m[1]), Number(m[2])];
  }
  return out;
}

/**
 * Write settings into the source's front-matter, touching only the
 * `config.archify` block. Empty settings remove the block (and `config:` or
 * the front-matter itself when nothing else is left). Returns undefined when
 * the front-matter uses flow style (`config: {…}`), which we leave to the author.
 */
export function writeLayoutSettings(source: string, settings: LayoutSettings): string | undefined {
  const clean = normalize(settings as Record<string, unknown>);
  const entries = entryLines(clean);
  const fm = FRONT.exec(source);

  if (!fm) {
    if (!entries.length) return source;
    return `---\nconfig:\n  archify:\n${entries.map((e) => `    ${e}`).join('\n')}\n---\n${source}`;
  }

  const nl = /\r\n/.test(fm[0]) ? '\r\n' : '\n';
  const loc = locate(fm[2] ?? '');
  if (loc.flow) return undefined;
  const lines = loc.lines.map((l) => l.text);
  // A body ends with a newline, so the split leaves a trailing '' we put back at the end.
  if (lines.at(-1) === '') lines.pop();

  if (loc.archify >= 0) {
    const end = blockEnd(loc.lines, loc.archify);
    const { block, empty } = rewriteBlock(loc.lines, loc.archify, clean);
    lines.splice(loc.archify, end - loc.archify, ...(empty ? [] : block));
    // Drop `config:` if removing archify left nothing but comments under it.
    const after = parseAll(lines);
    if (empty && blockEnd(after, loc.config) === loc.config + 1) {
      let stop = loc.config + 1;
      while (stop < after.length && after[stop].text.trim() && blank(after[stop]) && after[stop].indent > after[loc.config].indent) stop++;
      lines.splice(loc.config, stop - loc.config);
    }
  } else if (entries.length) {
    if (loc.config >= 0) {
      const end = blockEnd(loc.lines, loc.config);
      const child = loc.lines.slice(loc.config + 1, end).find((l) => !blank(l));
      const pad = ' '.repeat(child?.indent ?? loc.lines[loc.config].indent + 2);
      lines.splice(end, 0, `${pad}archify:`, ...entries.map((e) => `${pad}  ${e}`));
    } else {
      lines.push('config:', '  archify:', ...entries.map((e) => `    ${e}`));
    }
  } else return source;

  const rest = source.slice(fm[0].length);
  if (!lines.some((l) => l.trim())) return rest.replace(/^\r?\n/, '');
  return `${fm[1]}${lines.join(nl)}${nl}${fm[3]}${rest}`;
}

const parseAll = (texts: string[]) => texts.map(parseLine);
