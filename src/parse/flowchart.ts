import { classify, typed } from '../ir/classify';
import type { DiagramIR, Direction, EdgeStroke, IREdge, IRGroup, IRNode, NodeShape } from '../ir/types';
import { cleanLabel } from './text';

/**
 * Mermaid shape names (classic syntax and v11 `@{ shape: … }` names/aliases)
 * mapped onto the shape families we draw. Unlisted shapes render as rectangles.
 */
const SHAPE_MAP: Record<string, NodeShape> = {
  square: 'rect', rect: 'rect', proc: 'rect', process: 'rect',
  round: 'rounded', rounded: 'rounded', event: 'rounded', stadium: 'rounded', pill: 'rounded', terminal: 'rounded', ellipse: 'rounded',
  cylinder: 'cylinder', cyl: 'cylinder', db: 'cylinder', database: 'cylinder', das: 'cylinder', 'h-cyl': 'cylinder',
  'horizontal-cylinder': 'cylinder', 'lin-cyl': 'cylinder', disk: 'cylinder', 'lined-cylinder': 'cylinder',
  datastore: 'cylinder', 'bow-rect': 'cylinder', 'stored-data': 'cylinder',
  diamond: 'diamond', diam: 'diamond', decision: 'diamond', question: 'diamond',
  circle: 'circle', circ: 'circle', doublecircle: 'circle', 'dbl-circ': 'circle', 'double-circle': 'circle', 'cross-circ': 'circle',
  'crossed-circle': 'circle', summary: 'circle',
  hexagon: 'hexagon', hex: 'hexagon', prepare: 'hexagon',
  subroutine: 'subroutine', 'fr-rect': 'subroutine', subproc: 'subroutine', subprocess: 'subroutine', 'framed-rectangle': 'subroutine',
  processes: 'subroutine', procs: 'subroutine', 'st-rect': 'subroutine', 'stacked-rectangle': 'subroutine', 'div-rect': 'subroutine',
  'divided-rectangle': 'subroutine', 'div-proc': 'subroutine',
  'sm-circ': 'start', start: 'start', 'small-circle': 'start',
  'framed-circle': 'end', stop: 'end', 'fr-circ': 'end',
  'f-circ': 'junction', junction: 'junction', 'filled-circle': 'junction',
  fork: 'fork', join: 'fork',
  doc: 'document', document: 'document', docs: 'document', documents: 'document', 'st-doc': 'document', 'stacked-document': 'document',
  'lin-doc': 'document', 'lined-document': 'document', 'tag-doc': 'document', 'tagged-document': 'document',
  lean_right: 'parallelogram', lean_left: 'parallelogram', 'lean-r': 'parallelogram', 'lean-l': 'parallelogram',
  'lean-right': 'parallelogram', 'lean-left': 'parallelogram', 'in-out': 'parallelogram', 'out-in': 'parallelogram',
  trapezoid: 'trapezoid', inv_trapezoid: 'trapezoid', 'trap-b': 'trapezoid', 'trap-t': 'trapezoid', priority: 'trapezoid',
  'manual-input': 'trapezoid', 'sl-rect': 'trapezoid', 'sloped-rectangle': 'trapezoid', 'curv-trap': 'trapezoid', display: 'trapezoid',
  'inv-trapezoid': 'trapezoid', 'trapezoid-bottom': 'trapezoid', 'trapezoid-top': 'trapezoid', 'manual': 'trapezoid',
  comment: 'note', 'brace-r': 'note', braces: 'note', brace: 'note', 'brace-l': 'note',
  text: 'text',
};

/** Shapes whose meaning implies a data store. */
const STORAGE_SHAPES = new Set(['cylinder', 'cyl', 'db', 'database', 'das', 'h-cyl', 'horizontal-cylinder', 'lin-cyl', 'disk', 'lined-cylinder', 'datastore', 'bow-rect', 'stored-data']);

export function normalizeDirection(d: string | undefined): Direction {
  switch ((d ?? '').toUpperCase()) {
    case 'LR':
      return 'LR';
    case 'RL':
      return 'RL';
    case 'BT':
      return 'BT';
    default:
      return 'TB';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flowchartToIR(db: any): DiagramIR {
  const groups: IRGroup[] = [];
  const parentOf = new Map<string, string>();
  const groupIds = new Set<string>(db.getSubGraphs().map((s: { id: string }) => s.id));

  // Mermaid registers inner subgraphs first, so the first claim is the innermost.
  for (const sg of db.getSubGraphs()) {
    for (const member of sg.nodes as string[]) {
      if (member !== sg.id && !parentOf.has(member)) parentOf.set(member, sg.id);
    }
  }
  for (const sg of db.getSubGraphs()) {
    groups.push({ id: sg.id, label: cleanLabel(sg.title) || sg.id, parent: parentOf.get(sg.id) });
  }

  const nodes: IRNode[] = [];
  for (const v of db.getVertices().values()) {
    if (groupIds.has(v.id)) continue;
    const label = cleanLabel(v.text) || v.id;
    const classes: string[] = v.classes ?? [];
    const hint = v.type ?? 'square';
    nodes.push({
      id: v.id,
      label,
      shape: SHAPE_MAP[hint] ?? 'rect',
      ...typed(classify({ label, id: v.id, classes, shape: STORAGE_SHAPES.has(hint) ? 'cylinder' : hint })),
      parent: parentOf.get(v.id),
      classes,
      hint,
    });
  }

  const edges: IREdge[] = [];
  const seen = new Map<string, number>();
  for (const e of db.getEdges()) {
    const type: string = e.type ?? 'arrow_point';
    const marker = type.endsWith('_circle') ? 'circle' : type.endsWith('_cross') ? 'cross' : 'arrow';
    const base = e.id ?? `L_${e.start}_${e.end}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    edges.push({
      id: n ? `${base}_${n}` : base,
      from: e.start,
      to: e.end,
      label: cleanLabel(e.text) || undefined,
      stroke: (e.stroke === 'dotted' || e.stroke === 'thick' ? e.stroke : 'solid') as EdgeStroke,
      arrowEnd: type !== 'arrow_open',
      arrowStart: type.startsWith('double_'),
      ...(marker !== 'arrow' && { marker }),
      ...(e.stroke === 'invisible' && { invisible: true }),
    });
  }

  return {
    kind: 'flowchart',
    title: db.getDiagramTitle?.() || undefined,
    direction: normalizeDirection(db.getDirection?.()),
    nodes,
    edges,
    groups,
  };
}
