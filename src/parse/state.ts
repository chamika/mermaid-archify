import { FAILURE_WORDS, classify } from '../ir/classify';
import type { DiagramIR, IREdge, IRGroup, IRNode, NodeShape, SemanticType } from '../ir/types';
import { normalizeDirection } from './flowchart';
import { cleanLabel } from './text';

/** Lifecycle semantics: state names map onto the palette by outcome, not by component kind. */
const STATE_TONES: [RegExp, SemanticType][] = [
  [FAILURE_WORDS, 'security'],
  [/done|success|succeed|complete|finish|approved|paid|delivered|resolved|closed|ready|active|healthy|ok\b/i, 'backend'],
  [/idle|wait|pending|queued|new|draft|created|init|sleep|paused|hold|blocked|scheduled/i, 'external'],
  [/run|process|fetch|load|build|deploy|sync|retry|review|progress|execut|work|send|upload|verif|test|check|valid|migrat|install|provision/i, 'frontend'],
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

  // Composite states are groups; collect them first so relations can target them.
  const collectGroups = (doc: Stmt[], parent?: string) => {
    for (const s of doc ?? []) {
      if (s.stmt === 'state' && Array.isArray(s.doc) && s.doc.length) {
        const label = describe(s) || s.id;
        const existing = groups.get(s.id);
        if (!existing) groups.set(s.id, { id: s.id, label, parent });
        collectGroups(s.doc, s.id);
      }
      if (s.stmt === 'applyClass') for (const id of String(s.id).split(',')) classesOf.set(id.trim(), [s.styleClass]);
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
      if (s.classes?.length) existing.classes = s.classes;
      return;
    }
    let shape: NodeShape = 'rounded';
    if (s.start === true) shape = 'start';
    else if (s.start === false) shape = 'end';
    else if (s.type === 'fork' || s.type === 'join') shape = 'fork';
    else if (s.type === 'choice') shape = 'diamond';
    const classes: string[] = s.classes ?? classesOf.get(s.id) ?? [];
    const text = label || (shape === 'start' || shape === 'end' || shape === 'fork' ? '' : s.id);
    nodes.set(s.id, {
      id: s.id,
      label: text,
      shape,
      type: tone(text || s.id, classes),
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

  for (const [id, cls] of classesOf) {
    const n = nodes.get(id);
    if (n && !n.classes.length) {
      n.classes = cls;
      n.type = tone(n.label || id, cls);
    }
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

function describe(s: Stmt): string {
  return stateText(s.descriptions?.length ? s.descriptions : s.description);
}

/** Lifecycle tone: an explicit class wins, then outcome words; otherwise a plain state. */
function tone(label: string, classes: string[]): SemanticType {
  const explicit = classify({ label: '', id: '', classes });
  if (explicit.certainty === 'explicit') return explicit.type;
  for (const [re, t] of STATE_TONES) if (re.test(label)) return t;
  return 'plain';
}
