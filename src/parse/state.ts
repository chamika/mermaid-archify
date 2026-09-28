import { classify } from '../ir/classify';
import type { DiagramIR, IREdge, IRGroup, IRNode, NodeShape, SemanticType } from '../ir/types';
import { normalizeDirection } from './flowchart';
import { cleanLabel } from './text';

/** Lifecycle semantics: state names map onto the palette by outcome, not by component kind. */
const STATE_TONES: [RegExp, SemanticType][] = [
  [/fail|error|err\b|cancel|reject|abort|timeout|timed ?out|dead|crash|denied|invalid|expired/i, 'security'],
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

  const walk = (doc: Stmt[], parent?: string) => {
    for (const s of doc ?? []) {
      if (s.stmt === 'state') {
        if (groups.has(s.id)) {
          walk(s.doc, s.id);
        } else if (s.type !== 'divider') {
          addState(s, parent);
        }
      } else if (s.stmt === 'relation') {
        addState(s.state1, parent);
        addState(s.state2, parent);
        edges.push({
          id: `t${edges.length}`,
          from: s.state1.id,
          to: s.state2.id,
          label: cleanLabel(s.description) || undefined,
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

  return {
    kind: 'state',
    title: db.getDiagramTitle?.() || undefined,
    direction: normalizeDirection(direction ?? 'TB'),
    nodes: [...nodes.values()],
    edges,
    groups: [...groups.values()],
  };
}

function describe(s: Stmt): string {
  const d = s.descriptions?.length ? s.descriptions : s.description;
  return cleanLabel(d);
}

function tone(label: string, classes: string[]): SemanticType {
  if (classes.length) {
    const explicit = classify({ label: '', id: '', classes });
    if (explicit !== 'backend' || classes.some((c) => /backend|service|api/i.test(c))) return explicit;
  }
  for (const [re, t] of STATE_TONES) if (re.test(label)) return t;
  return 'backend';
}
