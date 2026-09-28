import { classify } from '../ir/classify';
import type { DiagramIR, Direction, EdgeStroke, IREdge, IRGroup, IRNode, NodeShape } from '../ir/types';
import { cleanLabel } from './text';

const SHAPE_MAP: Record<string, NodeShape> = {
  square: 'rect',
  rect: 'rect',
  round: 'rounded',
  stadium: 'rounded',
  ellipse: 'rounded',
  cylinder: 'cylinder',
  diamond: 'diamond',
  circle: 'circle',
  doublecircle: 'circle',
  hexagon: 'hexagon',
  subroutine: 'subroutine',
};

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
      type: classify({ label, id: v.id, classes, shape: hint }),
      parent: parentOf.get(v.id),
      classes,
      hint,
    });
  }

  const edges: IREdge[] = [];
  const seen = new Map<string, number>();
  for (const e of db.getEdges()) {
    if (e.stroke === 'invisible') continue;
    const type: string = e.type ?? 'arrow_point';
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
