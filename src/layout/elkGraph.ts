import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api';
import type { DiagramIR, Direction, Side } from '../ir/types';
import type { Pt, Scene, SceneEdge, SceneGroup, SceneNode } from '../scene/types';
import { edgeLabelSize, nodeSize } from './measure';

export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}

const ELK_DIR: Record<Direction, string> = { LR: 'RIGHT', RL: 'LEFT', TB: 'DOWN', BT: 'UP' };
const PORT_SIDE: Record<Side, string> = { L: 'WEST', R: 'EAST', T: 'NORTH', B: 'SOUTH' };
const MARGIN = 32;

function baseOptions(direction: Direction): LayoutOptions {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': ELK_DIR[direction],
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.spacing.nodeNodeBetweenLayers': '72',
    'elk.spacing.nodeNode': '44',
    'elk.spacing.edgeNode': '24',
    'elk.spacing.edgeEdge': '14',
    'elk.spacing.edgeLabel': '6',
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    // Break cycles by source order: an edge written "backwards" (retry, loop)
    // is the one reversed, so the main path keeps its authored direction.
    'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
    'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
  };
}

/** Build the ELK input graph. Group ids become compound nodes. */
export function toElkGraph(ir: DiagramIR): { graph: ElkNode; lines: Map<string, string[]> } {
  const withCaption = ir.kind !== 'state';
  const lines = new Map<string, string[]>();
  const elkNodes = new Map<string, ElkNode>();
  const usesPorts = ir.kind === 'architecture';

  for (const g of ir.groups) {
    elkNodes.set(g.id, {
      id: g.id,
      children: [],
      // With INCLUDE_CHILDREN the root's options apply inside groups too; repeating
      // considerModelOrder on nested compounds crashes ELK, so set padding only.
      layoutOptions: { 'elk.padding': '[top=42,left=22,bottom=22,right=22]' },
    });
  }

  for (const n of ir.nodes) {
    const size = nodeSize(n, ir.direction, withCaption);
    lines.set(n.id, size.lines);
    const layoutOptions: LayoutOptions = {};
    if (n.shape === 'start') layoutOptions['elk.layered.layering.layerConstraint'] = 'FIRST';
    if (n.shape === 'end') layoutOptions['elk.layered.layering.layerConstraint'] = 'LAST';
    if (usesPorts) layoutOptions['elk.portConstraints'] = 'FIXED_SIDE';
    elkNodes.set(n.id, { id: n.id, width: size.w, height: size.h, layoutOptions, ports: [] });
  }

  const root: ElkNode = {
    id: '__root',
    children: [],
    edges: [],
    layoutOptions: {
      ...baseOptions(ir.direction),
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.json.edgeCoords': 'ROOT',
      'elk.json.shapeCoords': 'ROOT',
      'elk.padding': `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
    },
  };

  const parentOf = (id: string) =>
    ir.nodes.find((n) => n.id === id)?.parent ?? ir.groups.find((g) => g.id === id)?.parent;
  // Model order = order of first appearance in the authored edges, then the rest.
  // ELK uses it for cycle breaking and tie-breaks, so layout follows the source.
  const rank = new Map<string, number>();
  const bump = (id: string | undefined) => {
    while (id && !rank.has(id)) {
      rank.set(id, rank.size);
      id = parentOf(id);
    }
  };
  for (const e of ir.edges) {
    bump(e.from);
    bump(e.to);
  }
  for (const id of elkNodes.keys()) bump(id);
  const ordered = [...elkNodes].sort((a, b) => rank.get(a[0])! - rank.get(b[0])!);
  for (const [id, elkNode] of ordered) {
    const parent = parentOf(id);
    const container = (parent && elkNodes.get(parent)) || root;
    container.children!.push(elkNode);
  }

  const edges: ElkExtendedEdge[] = [];
  for (const e of ir.edges) {
    if (!elkNodes.has(e.from) || !elkNodes.has(e.to)) continue;
    let source = e.from;
    let target = e.to;
    if (usesPorts) {
      source = addPort(elkNodes.get(e.from)!, `${e.id}:s`, e.fromSide);
      target = addPort(elkNodes.get(e.to)!, `${e.id}:t`, e.toSide);
    }
    const edge: ElkExtendedEdge = { id: e.id, sources: [source], targets: [target] };
    if (e.label) {
      const s = edgeLabelSize(e.label);
      edge.labels = [{ id: `${e.id}:label`, text: e.label, width: s.w, height: s.h }];
    }
    edges.push(edge);
  }
  root.edges = edges;
  return { graph: root, lines };
}

function addPort(node: ElkNode, id: string, side: Side | undefined): string {
  if (!side || !node.ports) return node.id;
  const port: ElkPort = { id, width: 0, height: 0, layoutOptions: { 'elk.port.side': PORT_SIDE[side] } };
  node.ports.push(port);
  return id;
}

/** Convert ELK output (ROOT coordinates) into a Scene. */
export function fromElk(ir: DiagramIR, laid: ElkNode, lines: Map<string, string[]>): Scene {
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  const visit = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      boxes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 });
      visit(c);
    }
  };
  visit(laid);

  const nodes: SceneNode[] = ir.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    lines: lines.get(n.id) ?? [],
    type: n.type,
    shape: n.shape,
    parent: n.parent,
    ...boxes.get(n.id)!,
  }));

  const depthOf = (id: string | undefined): number => {
    let d = 0;
    let cur = id;
    while (cur) {
      d++;
      cur = ir.groups.find((g) => g.id === cur)?.parent;
    }
    return d;
  };
  const groups: SceneGroup[] = ir.groups.map((g) => ({
    id: g.id,
    label: g.label,
    parent: g.parent,
    depth: depthOf(g.parent),
    ...boxes.get(g.id)!,
  }));

  const order = traceOrder(ir);
  const laidEdges = new Map<string, ElkExtendedEdge>();
  const collect = (n: ElkNode) => {
    for (const e of n.edges ?? []) laidEdges.set(e.id, e);
    for (const c of n.children ?? []) collect(c);
  };
  collect(laid);

  const edges: SceneEdge[] = [];
  for (const e of ir.edges) {
    const le = laidEdges.get(e.id);
    if (!le?.sections?.length) continue;
    const points: Pt[] = [];
    for (const s of le.sections) {
      if (!points.length) points.push(s.startPoint);
      points.push(...(s.bendPoints ?? []), s.endPoint);
    }
    const lab = le.labels?.[0];
    edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label,
      points: dedupe(points),
      labelBox: lab ? { x: lab.x ?? 0, y: lab.y ?? 0, w: lab.width ?? 0, h: lab.height ?? 0 } : undefined,
      stroke: e.stroke,
      arrowEnd: e.arrowEnd,
      arrowStart: e.arrowStart,
      order: order.get(e.id) ?? 0,
    });
  }

  return {
    version: 1,
    kind: ir.kind,
    title: ir.title,
    width: Math.ceil(laid.width ?? 0),
    height: Math.ceil(laid.height ?? 0),
    nodes,
    groups,
    edges,
  };
}

function dedupe(points: Pt[]): Pt[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

/** Edge order for trace playback: BFS depth of the source node from the graph's sources. */
export function traceOrder(ir: DiagramIR): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const n of ir.nodes) incoming.set(n.id, 0);
  for (const e of ir.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const depth = new Map<string, number>();
  let frontier = ir.nodes.filter((n) => !incoming.get(n.id)).map((n) => n.id);
  if (!frontier.length && ir.nodes.length) frontier = [ir.nodes[0].id];
  let d = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const e of ir.edges) if (e.from === id && !depth.has(e.to)) next.push(e.to);
    }
    frontier = next;
    d++;
  }
  const out = new Map<string, number>();
  for (const e of ir.edges) out.set(e.id, depth.get(e.from) ?? d);
  return out;
}
