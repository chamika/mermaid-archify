import type { Direction } from '../ir/types';

/**
 * User layout settings. They live in the source's front-matter under
 * `config.archify`, so they travel with the diagram (and its share link);
 * Mermaid ignores config keys it does not know.
 */

export type Routing = 'orthogonal' | 'polyline' | 'splines';
export type Placement = 'network-simplex' | 'brandes-koepf' | 'linear-segments' | 'simple';

export interface LayoutSettings {
  /** Overrides the direction written in the source. */
  direction?: Direction;
  nodeSpacing?: number;
  rankSpacing?: number;
  routing?: Routing;
  placement?: Placement;
}

export const DIRECTIONS: readonly Direction[] = ['LR', 'RL', 'TB', 'BT'];
export const ROUTINGS: readonly Routing[] = ['orthogonal', 'polyline', 'splines'];
export const PLACEMENTS: readonly Placement[] = ['network-simplex', 'brandes-koepf', 'linear-segments', 'simple'];

export const DEFAULTS = { nodeSpacing: 44, rankSpacing: 72, routing: 'orthogonal', placement: 'network-simplex' } as const;
export const RANGES = { nodeSpacing: [12, 160], rankSpacing: [24, 240] } as const;

/** Front-matter with its three parts: opening fence, body, closing fence. Same shape `prepareSource` blanks. */
const FRONT = /^(\s*---[ \t]*\r?\n)([\s\S]*?\r?\n)?(\s*---[ \t]*)(?=\r?\n|$)/;

const KEYS = ['direction', 'nodeSpacing', 'rankSpacing', 'routing', 'placement'] as const;

/** Keep only known keys with valid values; numbers are rounded and clamped; defaults are dropped. */
export function normalize(raw: Record<string, unknown>): LayoutSettings {
  const out: LayoutSettings = {};
  const dir = String(raw.direction ?? '').toUpperCase();
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
  return out;
}

interface Line {
  text: string;
  indent: number;
  key?: string;
  value?: string;
}

function parseLine(text: string): Line {
  const indent = /^[ \t]*/.exec(text)![0].length;
  const m = /^[ \t]*([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/.exec(text);
  if (!m || text.trimStart().startsWith('#')) return { text, indent };
  return { text, indent, key: m[1], value: m[2] };
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
  const raw: Record<string, string> = {};
  for (let i = archify + 1; i < blockEnd(lines, archify); i++) {
    const l = lines[i];
    if (l.key && l.value !== undefined) raw[l.key] = unquote(l.value);
  }
  return normalize(raw);
}

/**
 * Write settings into the source's front-matter, touching only the
 * `config.archify` block. Empty settings remove the block (and `config:` or
 * the front-matter itself when nothing else is left). Returns undefined when
 * the front-matter uses flow style (`config: {…}`), which we leave to the author.
 */
export function writeLayoutSettings(source: string, settings: LayoutSettings): string | undefined {
  const clean = normalize(settings as Record<string, unknown>);
  const entries = KEYS.filter((k) => clean[k] !== undefined).map((k) => `${k}: ${clean[k]}`);
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
    const pad = ' '.repeat(loc.lines[loc.archify].indent + 2);
    const end = blockEnd(loc.lines, loc.archify);
    const block = entries.length ? [loc.lines[loc.archify].text, ...entries.map((e) => pad + e)] : [];
    lines.splice(loc.archify, end - loc.archify, ...block);
    // Drop `config:` if removing archify left it empty.
    if (!entries.length && blockEnd(parseAll(lines), loc.config) === loc.config + 1) lines.splice(loc.config, 1);
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
