import type { DiagramKind } from '../ir/types';
import { prepareSource } from '../parse/text';

/**
 * Links source lines and diagram elements for the editor. Mermaid's `db` keeps
 * no source positions, so this is a lightweight pass over the text: it finds
 * which known ids each line mentions, then assigns edges to lines in order
 * (every parser emits edges in source order). App-only: nothing here reaches
 * the IR, the Scene or exported files.
 */

/** The parts of a Scene (or IR) the mapping needs. */
export interface Mappable {
  kind: DiagramKind;
  nodes: { id: string; shape: string; parent?: string }[];
  edges: { id: string; from: string; to: string }[];
  groups: { id: string; parent?: string }[];
}

export interface LineTargets {
  nodes: Set<string>;
  edges: Set<string>;
}

export interface SourceMap {
  /** 1-based line that defines each node, edge or group. */
  lineOf: Map<string, number>;
  /** What each 1-based line produces in the diagram. */
  atLine: Map<number, LineTargets>;
}

const STAR = '[*]';
const WORD = /[\w$]+(?:[-.][\w$]+)*/g;
/** Statements that declare the id they name (`class` styles nodes outside class diagrams). */
const DECLARE = new Set(['participant', 'actor', 'create', 'state', 'service', 'junction', 'group', 'subgraph', 'namespace']);

/** Arrow operators per diagram kind; stripped before tokenizing so `A--xB` yields `A`, `B`. */
const ARROWS: Record<DiagramKind, RegExp> = {
  flowchart: /(?:<|(?<=\s)[ox])?(?:-{2,}|={2,}|-\.+-|~{3,})(?:>|[ox](?![\w$]))?/g,
  sequence: /<<-{1,2}>>|-{1,2}(?:>>|>|x|\))/g,
  state: /-->/g,
  class: /(?:<\||\*|(?<=\s)o|<|\(\))?(?:--|\.\.)(?:\|>|\*|o(?![\w$])|>|\(\))?/g,
  er: /[|}{o]{2}(?:--|\.\.)[|{}o]{2}|\s(?:optionally\s+)?to\s/g,
  architecture: /<?--(?:>)?/g,
};

interface Line {
  /** Known ids (and `[*]`) the line mentions, in order. */
  ids: string[];
  /** How many edges the line can produce: arrows, fanned out by `&`. */
  room: number;
  firstWord?: string;
  /** Inside an ER entity or class body. */
  body?: boolean;
}

export function buildSourceMap(source: string, d: Mappable): SourceMap {
  const known = new Set([...d.nodes.map((n) => n.id), ...d.groups.map((g) => g.id)]);
  const nodeById = new Map(d.nodes.map((n) => [n.id, n]));
  // Strings are labels (they may span lines); quoted ER entity names (`"HOSPITAL" {`) are ids.
  const lines = prepareSource(source)
    .replace(/"([^"]*)"/g, (m, q: string) => (d.kind === 'er' && known.has(q) ? ` ${q} ` : m.replace(/[^\n]/g, ' ')))
    .split('\n')
    .map((raw) => scan(raw, d.kind, known));

  const lineOf = new Map<string, number>();
  const atLine = new Map<number, LineTargets>();
  const at = (i: number) => {
    let t = atLine.get(i + 1);
    if (!t) atLine.set(i + 1, (t = { nodes: new Set(), edges: new Set() }));
    return t;
  };

  // ER entities and class bodies: lines inside `NAME {` … `}` belong to NAME.
  if (d.kind === 'er' || d.kind === 'class') {
    let owner: string | undefined;
    for (const [i, raw] of source.split('\n').entries()) {
      if (owner) {
        if (/^\s*}/.test(raw)) owner = undefined;
        else {
          lines[i].ids.push(owner);
          lines[i].body = true;
        }
        continue;
      }
      const open = /^\s*(?:class\s+)?([\w$-]+)(?:~[^~]*~)?(?:\s*\[[^\]]*\])?[^{}]*\{\s*$/.exec(raw);
      if (open && nodeById.has(open[1])) owner = open[1];
    }
  }

  // Notes (`note right of X`, `note for X`) become nodes named `X__…`; claim note lines in order.
  const noteLine = new Map<string, number>();
  const claimed = new Set<number>();
  for (const n of d.nodes) {
    if (n.shape !== 'note' || !n.id.includes('__')) continue;
    const owner = n.id.slice(0, n.id.indexOf('__'));
    const i = lines.findIndex(
      (l, k) => !claimed.has(k) && l.firstWord?.toLowerCase() === 'note' && (owner ? l.ids.includes(owner) : !l.ids.some((x) => nodeById.has(x))),
    );
    if (i < 0) continue;
    claimed.add(i);
    noteLine.set(n.id, i);
    lines[i].ids.push(n.id);
  }

  const isPseudo = (id: string) => ['start', 'end'].includes(nodeById.get(id)?.shape ?? '');
  const named = new Set(lines.flatMap((l) => l.ids));
  const mentions = (l: Line, id: string) =>
    l.ids.includes(id) ||
    // Never written out (class lollipop interfaces, names the scan cannot read): any end will do.
    (!named.has(id) && !isPseudo(id) && d.kind !== 'architecture') ||
    (l.ids.includes(STAR) && isPseudo(id)) ||
    // architecture-beta `A{group} --> B`: the edge starts at A's group.
    (d.kind === 'architecture' && l.ids.some((x) => nodeById.get(x)?.parent === id));

  // Edges, in source order: each takes the next arrow line naming both ends.
  let cursor = 0;
  const used = lines.map(() => 0);
  for (const e of d.edges) {
    const note = noteLine.get(e.from) ?? noteLine.get(e.to);
    let i = note ?? -1;
    if (i < 0) {
      const fits = (l: Line) => l.room > 0 && mentions(l, e.from) && mentions(l, e.to);
      i = lines.findIndex((l, k) => k >= cursor && used[k] < l.room && fits(l));
      if (i >= 0) cursor = i;
      else i = lines.findIndex(fits);
    }
    if (i < 0) continue;
    used[i]++;
    lineOf.set(e.id, i + 1);
    const t = at(i);
    t.edges.add(e.id);
    t.nodes.add(e.from);
    t.nodes.add(e.to);
  }

  const declares = (w = '') => DECLARE.has(w.toLowerCase()) || (d.kind === 'class' && w === 'class');
  // Nodes and groups: the declaring line if there is one, else the first mention.
  for (const id of known) {
    const note = noteLine.get(id);
    const declared =
      note ??
      lines.findIndex((l) => !l.room && !l.body && l.ids.find((x) => x !== STAR) === id && (l.firstWord === id || declares(l.firstWord)));
    const i = declared >= 0 ? declared : lines.findIndex((l) => l.ids.includes(id));
    if (i >= 0) lineOf.set(id, i + 1);
  }
  // Never named on their own (`[*]`): the first transition that touches them.
  for (const e of d.edges) {
    for (const id of [e.from, e.to]) if (!lineOf.has(id) && lineOf.has(e.id)) lineOf.set(id, lineOf.get(e.id)!);
  }

  // Lines without edges light what they mention: declarations, `style A`, notes, member rows.
  const descendants = (group: string) => d.nodes.filter((n) => inside(n.parent, group)).map((n) => n.id);
  const groupParent = new Map(d.groups.map((g) => [g.id, g.parent]));
  const inside = (p: string | undefined, group: string): boolean => !!p && (p === group || inside(groupParent.get(p), group));
  for (const [i, l] of lines.entries()) {
    if (atLine.get(i + 1)?.edges.size) continue;
    for (const id of l.ids) {
      if (nodeById.has(id)) at(i).nodes.add(id);
      else if (groupParent.has(id) && lineOf.get(id) === i + 1) for (const n of descendants(id)) at(i).nodes.add(n);
    }
  }
  for (const [k, t] of atLine) if (!t.nodes.size && !t.edges.size) atLine.delete(k);

  return { lineOf, atLine };
}

/** Known ids a line mentions, with labels, strings and arrows removed first. */
function scan(raw: string, kind: DiagramKind, known: Set<string>): Line {
  let s = raw.replace(/\[\*\]/g, ' __STAR__ ');
  if (kind === 'flowchart') {
    s = s
      .replace(/\|[^|]*\|/g, ' ')
      .replace(/@\{[^}]*\}/g, ' ')
      // Edge text written inside the arrow: `A -- text --> B`, `A -. text .-> B`.
      .replace(/(--|==)\s.*?\s\1+([>ox]?)(?![\w$])/g, ' $1$2 ')
      .replace(/-\.\s.*?\s\.-(>?)/g, ' -.-$1 ');
    // Node shapes (`A[text]`, `B((text))`, `C{text}`); innermost first, so nesting unwinds.
    for (let prev = ''; prev !== s; ) {
      prev = s;
      s = s.replace(/\[[^[\]]*\]|\([^()]*\)|\{[^{}]*\}/g, ' ');
    }
    s = s.replace(/(?<=[\w$])>[^\]]*\]/g, ' ');
  } else if (kind === 'architecture') {
    s = s
      .replace(/-\[[^\]]*\]-/g, ' -- ')
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/(?<![\w$])[LRTB]:|:[LRTB](?![\w$])/g, ' ');
  } else {
    // `A --> B : label`, `Alice->>Bob: hi`, `CUSTOMER ||--o{ ORDER : places`.
    s = s.replace(/:::[\w-]+/g, ' ');
    const colon = s.indexOf(':');
    if (colon >= 0) s = s.slice(0, colon);
    if (kind === 'class') s = s.replace(/~[^~]*~/g, ' ');
  }
  // `A & B --> C` makes one edge per pair across each arrow.
  const sides = s.split(ARROWS[kind]).map((side) => 1 + (side.match(/&/g)?.length ?? 0));
  const room = sides.slice(1).reduce((sum, n, i) => sum + sides[i] * n, 0);
  const words = s.replace(ARROWS[kind], ' ').match(WORD) ?? [];
  return {
    ids: words.map((w) => (w === '__STAR__' ? STAR : w)).filter((w) => w === STAR || known.has(w)),
    room,
    firstWord: words[0] === '__STAR__' ? STAR : words[0],
  };
}
