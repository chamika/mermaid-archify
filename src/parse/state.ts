import { FAILURE_WORDS, classify } from '../ir/classify';
import { mergeStyles, parseStyle } from '../ir/style';
import type { DiagramIR, IREdge, IRGroup, IRNode, NodeShape, SemanticType } from '../ir/types';
import { normalizeDirection } from './flowchart';
import { cleanLabel } from './text';

/**
 * Lifecycle semantics: state names map onto the palette by outcome, not by component kind.
 * Words match at a word start (`Rerun` is not `run`), and a negating prefix cancels a
 * match (`Incomplete`, `Unhealthy` are not successes).
 */
const STATE_TONES: [RegExp, SemanticType][] = [
  [FAILURE_WORDS, 'security'],
  [/\b(un|in|non|not )?(done|success|succeed|complete|finish|approved|paid|delivered|resolved|closed|ready|active|healthy|ok\b)/gi, 'backend'],
  [/\b(un|in|non|not )?(idle|wait|pending|queued|new\b|draft|created|init|sleep|paused|hold|blocked|scheduled)/gi, 'external'],
  [/\b(un|in|non|not )?(run|process|fetch|load|build|deploy|sync|retry|review|progress|execut|work|send|upload|verif|test|check|valid|migrat|install|provision)/gi, 'frontend'],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stmt = any;

export function stateToIR(db: Stmt): DiagramIR {
  const nodes = new Map<string, IRNode>();
  const groups = new Map<string, IRGroup>();
  const edges: IREdge[] = [];
  const classesOf = new Map<string, string[]>();
  let direction: string | undefined;

  const root = db.getRootDocV2();
  /** Mermaid's per-state record, accumulated over the whole diagram: `class`/`:::`, `style` lines, descriptions. */
  const states: Map<string, { classes?: string[]; styles?: string[]; descriptions?: string[] }> = db.getStates?.() ?? new Map();
  const classDefs: Map<string, { styles?: string[] }> = db.getClasses?.() ?? new Map();
  const classesFor = (id: string, own: string[] = []) => [...new Set([...own, ...(classesOf.get(id) ?? []), ...(states.get(id)?.classes ?? [])])];
  // Mermaid's precedence: classDefs in class order, then `style` statements.
  const styleFor = (id: string, classes: string[]) =>
    mergeStyles(...classes.map((c) => parseStyle(classDefs.get(c)?.styles)), parseStyle(states.get(id)?.styles));
  const describe = (s: Stmt) => {
    const all = states.get(s.id)?.descriptions;
    return stateText(all?.length ? all : s.descriptions?.length ? s.descriptions : s.description);
  };

  // Composite states are groups; collect them first so relations can target them.
  const collectGroups = (doc: Stmt[], parent?: string) => {
    for (const s of doc ?? []) {
      if (s.stmt === 'state' && Array.isArray(s.doc) && s.doc.length) {
        const label = describe(s) || s.id;
        const existing = groups.get(s.id);
        if (!existing) groups.set(s.id, { id: s.id, label, parent });
        collectGroups(s.doc, s.id);
      }
      if (s.stmt === 'applyClass')
        for (const raw of String(s.id).split(',')) {
          const id = raw.trim();
          classesOf.set(id, [...(classesOf.get(id) ?? []), s.styleClass]);
        }
      if (s.stmt === 'dir' && !parent) direction = s.value;
    }
  };
  collectGroups(root.doc);

  const addState = (s: Stmt, parent?: string) => {
    if (groups.has(s.id)) {
      const g = groups.get(s.id)!;
      const d = describe(s);
      if (d && g.label === g.id) g.label = d;
      return;
    }
    const existing = nodes.get(s.id);
    const label = describe(s);
    if (existing) {
      if (label && existing.label === existing.id) existing.label = label;
      if (s.classes?.length) existing.classes = classesFor(s.id, [...existing.classes, ...s.classes]);
      return;
    }
    let shape: NodeShape = 'rounded';
    if (s.start === true) shape = 'start';
    else if (s.start === false) shape = 'end';
    else if (s.type === 'fork' || s.type === 'join') shape = 'fork';
    else if (s.type === 'choice') shape = 'diamond';
    const classes = classesFor(s.id, s.classes);
    const pseudo = shape === 'start' || shape === 'end' || shape === 'fork';
    const text = label || (pseudo ? '' : s.id);
    nodes.set(s.id, {
      id: s.id,
      label: text,
      shape,
      // Pseudo-states have no outcome of their own (`Active_start` is not "active").
      type: pseudo ? 'plain' : tone(text || s.id, classes),
      parent,
      classes,
      hint: s.type,
    });
  };

  /** `note left of X : text` becomes a note node tied to X by a plain dotted connector. */
  const addNote = (stateId: string, note: { position?: string; text: string }, parent?: string) => {
    const id = `${stateId}__note${[...nodes.keys()].filter((k) => k.startsWith(`${stateId}__note`)).length || ''}`;
    nodes.set(id, { id, label: stateText(note.text), shape: 'note', type: 'plain', parent, classes: [], hint: 'note' });
    const left = /left/.test(note.position ?? '');
    edges.push({
      id: `t${edges.length}`,
      from: left ? id : stateId,
      to: left ? stateId : id,
      stroke: 'dotted',
      arrowEnd: false,
      arrowStart: false,
    });
  };

  const walk = (doc: Stmt[], parent?: string) => {
    for (const s of doc ?? []) {
      if (s.stmt === 'state') {
        if (groups.has(s.id)) {
          walk(s.doc, s.id);
        } else if (s.type !== 'divider') {
          addState(s, parent);
        }
        if (s.note?.text) addNote(s.id, s.note, parent);
      } else if (s.stmt === 'relation') {
        addState(s.state1, parent);
        addState(s.state2, parent);
        edges.push({
          id: `t${edges.length}`,
          from: s.state1.id,
          to: s.state2.id,
          label: stateText(s.description) || undefined,
          stroke: 'solid',
          arrowEnd: true,
          arrowStart: false,
        });
      }
    }
  };
  walk(root.doc);

  for (const n of nodes.values()) {
    if (n.shape === 'note') continue;
    const style = styleFor(n.id, n.classes);
    if (style) n.style = style;
  }
  for (const g of groups.values()) {
    const classes = classesFor(g.id);
    const style = styleFor(g.id, classes);
    if (classes.length) g.classes = classes;
    if (style) g.style = style;
  }

  const regions = renameRegions([...groups.values()], [...nodes.values()], edges);

  return {
    kind: 'state',
    title: db.getDiagramTitle?.() || undefined,
    direction: normalizeDirection(direction ?? 'TB'),
    nodes: [...nodes.values()],
    edges,
    groups: regions,
  };
}

/** Mermaid's ids for concurrent regions (`--`): `divider-id-N`, or random `id-xxxx-N`. */
const REGION_ID = /^(divider-)?id-[\w]+-\d+$|^divider-id-\d+$/;

/**
 * Concurrent regions get Mermaid-internal ids, one of them random per parse.
 * Rename them deterministically (`Parent.region1`, …) everywhere they appear,
 * and leave them unlabelled: they are separators, not named states.
 */
function renameRegions(groups: IRGroup[], nodes: IRNode[], edges: IREdge[]): IRGroup[] {
  const rename = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const g of groups) {
    if (!REGION_ID.test(g.id)) continue;
    const n = (counters.get(g.parent ?? '') ?? 0) + 1;
    counters.set(g.parent ?? '', n);
    rename.set(g.id, `${g.parent ?? 'root'}.region${n}`);
  }
  if (!rename.size) return groups;
  const fix = (id: string | undefined) => {
    if (!id) return id;
    if (rename.has(id)) return rename.get(id)!;
    const m = /^(.*)_(start|end)$/.exec(id);
    return m && rename.has(m[1]) ? `${rename.get(m[1])}_${m[2]}` : id;
  };
  for (const g of groups) {
    if (rename.has(g.id)) g.label = '';
    g.id = fix(g.id)!;
    g.parent = fix(g.parent);
  }
  for (const n of nodes) {
    n.id = fix(n.id)!;
    n.parent = fix(n.parent);
  }
  for (const e of edges) {
    e.from = fix(e.from)!;
    e.to = fix(e.to)!;
  }
  return groups;
}

/** Mermaid's state syntax (unlike flowcharts) treats a literal `\n` as a line break. */
const stateText = (raw: unknown) => cleanLabel(Array.isArray(raw) ? raw.map((r) => String(r).replace(/\\n/g, '\n')) : String(raw ?? '').replace(/\\n/g, '\n'));

/** Lifecycle tone: an explicit class wins, then outcome words; otherwise a plain state. */
function tone(label: string, classes: string[]): SemanticType {
  const explicit = classify({ label: '', id: '', classes });
  if (explicit.certainty === 'explicit') return explicit.type;
  // Words split on case changes and separators: `PaymentDone`, `payment_done`.
  const words = label.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ');
  for (const [re, t] of STATE_TONES) {
    if (re.global) {
      if ([...words.matchAll(re)].some((m) => !m[1])) return t;
    } else if (re.test(words)) return t;
  }
  return 'plain';
}
