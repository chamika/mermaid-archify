import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api';
import { settleInk } from '../ir/style';
import type { DiagramIR, Direction, Side } from '../ir/types';
import type { Box, Pt, Scene, SceneEdge, SceneGroup, SceneNode } from '../scene/types';
import { edgeLabelSize, nodeSize } from './measure';
import { DEFAULTS, type LayoutSettings } from './settings';

export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}

const ELK_DIR: Record<Direction, string> = { LR: 'RIGHT', RL: 'LEFT', TB: 'DOWN', BT: 'UP' };
const PORT_SIDE: Record<Side, string> = { L: 'WEST', R: 'EAST', T: 'NORTH', B: 'SOUTH' };
const MARGIN = 32;

/** ELK constant for a settings value: `brandes-koepf` → `BRANDES_KOEPF`. */
const elkConst = (v: string) => v.toUpperCase().replace(/-/g, '_');

function baseOptions(direction: Direction, settings: LayoutSettings): LayoutOptions {
  const nodeNode = settings.nodeSpacing ?? DEFAULTS.nodeSpacing;
  const ranks = settings.rankSpacing ?? DEFAULTS.rankSpacing;
  // Edge clearances follow node spacing, so "compact" really is compact.
  const edgeNode = Math.round((24 * nodeNode) / DEFAULTS.nodeSpacing);
  const edgeEdge = Math.round((14 * nodeNode) / DEFAULTS.nodeSpacing);
  return {
    'elk.algorithm': 'layered',
    'elk.randomSeed': '1',
    'elk.direction': ELK_DIR[direction],
    'elk.edgeRouting': elkConst(settings.routing ?? DEFAULTS.routing),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(ranks),
    'elk.spacing.nodeNode': String(nodeNode),
    'elk.spacing.edgeNode': String(edgeNode),
    'elk.spacing.edgeEdge': String(edgeEdge),
    'elk.spacing.edgeLabel': '6',
    'elk.layered.spacing.edgeNodeBetweenLayers': String(edgeNode),
    'elk.layered.spacing.edgeEdgeBetweenLayers': String(edgeEdge),
    'elk.layered.nodePlacement.strategy': elkConst(settings.placement ?? DEFAULTS.placement),
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    // Break cycles by source order: an edge written "backwards" (retry, loop)
    // is the one reversed, so the main path keeps its authored direction.
    'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER', // backstop; backEdges() pre-breaks cycles
    'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
  };
}

/** ELK's own in-layer spacings, which groups use unless told otherwise. */
const ELK_GROUP_SPACING = { nodeNode: 20, edgeNode: 10, edgeEdge: 10 };

/**
 * In-layer spacing is per parent in ELK (rank spacing is global), so groups
 * keep ELK's defaults unless node spacing is set; then they scale with it.
 */
function groupSpacing(settings: LayoutSettings): LayoutOptions {
  if (settings.nodeSpacing === undefined) return {};
  const k = settings.nodeSpacing / DEFAULTS.nodeSpacing;
  const px = (v: number) => String(Math.max(4, Math.round(v * k)));
  return {
    'elk.spacing.nodeNode': px(ELK_GROUP_SPACING.nodeNode),
    'elk.spacing.edgeNode': px(ELK_GROUP_SPACING.edgeNode),
    'elk.spacing.edgeEdge': px(ELK_GROUP_SPACING.edgeEdge),
  };
}

/** Build the ELK input graph. Group ids become compound nodes. */
export function toElkGraph(
  ir: DiagramIR,
  settings: LayoutSettings = {},
): { graph: ElkNode; lines: Map<string, string[]>; flipped: Set<string> } {
  const direction = settings.direction ?? ir.direction;
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
      layoutOptions: { 'elk.padding': '[top=42,left=22,bottom=22,right=22]', ...groupSpacing(settings) },
    });
  }

  for (const n of ir.nodes) {
    const size = nodeSize(n, direction, withCaption);
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
      ...baseOptions(direction, settings),
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
    bump(e.authoredReversed ? e.to : e.from);
    bump(e.authoredReversed ? e.from : e.to);
  }
  for (const id of elkNodes.keys()) bump(id);
  const back = backEdges(ir, rank);
  // ER and class diagrams declare structure rather than a flow: the order things
  // are first mentioned says nothing about direction. Rank them topologically
  // so ELK's model-order cycle breaking reverses only true back-edges.
  if (ir.kind === 'er' || ir.kind === 'class') {
    const order = topoOrder(ir, rank, back);
    rank.clear();
    for (const id of order) bump(id);
    for (const id of elkNodes.keys()) bump(id);
  }
  const ordered = [...elkNodes].sort((a, b) => rank.get(a[0])! - rank.get(b[0])!);
  for (const [id, elkNode] of ordered) {
    const parent = parentOf(id);
    const container = (parent && elkNodes.get(parent)) || root;
    container.children!.push(elkNode);
  }

  const flipped = new Set<string>();
  const edges: ElkExtendedEdge[] = [];
  for (const e of ir.edges) {
    if (!elkNodes.has(e.from) || !elkNodes.has(e.to)) continue;
    // Back-edges go to ELK reversed (and are flipped back in fromElk), so the
    // authored main path always flows forward. Edges written the other way
    // round go in their written order.
    const flip = back.has(e.id) !== !!e.authoredReversed;
    if (flip) flipped.add(e.id);
    let source = flip ? e.to : e.from;
    let target = flip ? e.from : e.to;
    if (usesPorts) {
      source = addPort(elkNodes.get(source)!, `${e.id}:s`, flip ? e.toSide : e.fromSide);
      target = addPort(elkNodes.get(target)!, `${e.id}:t`, flip ? e.fromSide : e.toSide);
    }
    const edge: ElkExtendedEdge = { id: e.id, sources: [source], targets: [target] };
    if (e.label) {
      const s = edgeLabelSize(e.label);
      edge.labels = [{ id: `${e.id}:label`, text: e.label, width: s.w, height: s.h }];
    }
    edges.push(edge);
  }
  root.edges = edges;
  return { graph: root, lines, flipped };
}

/**
 * Edges that close a cycle, found by depth-first search in source order
 * (starting from nodes nothing points at). ELK's own cycle breaking ignores
 * authored order inside nested groups, so we decide instead.
 */
export function backEdges(ir: DiagramIR, rank: Map<string, number>): Set<string> {
  const out = new Map<string, { id: string; to: string }[]>();
  const indeg = new Map<string, number>();
  for (const e of ir.edges) {
    if (e.from === e.to) continue;
    const [from, to] = e.authoredReversed ? [e.to, e.from] : [e.from, e.to];
    if (!out.has(from)) out.set(from, []);
    out.get(from)!.push({ id: e.id, to });
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
  }
  const ids = [...new Set([...rank.keys(), ...out.keys()])].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  const roots = [...ids.filter((id) => !indeg.get(id)), ...ids];
  const state = new Map<string, 1 | 2>(); // 1 = on the stack, 2 = done
  const back = new Set<string>();
  for (const root of roots) {
    if (state.has(root)) continue;
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack.at(-1)!;
      const next = out.get(top.id)?.[top.i++];
      if (!next) {
        state.set(top.id, 2);
        stack.pop();
      } else if (state.get(next.to) === 1) back.add(next.id);
      else if (!state.has(next.to)) {
        state.set(next.to, 1);
        stack.push({ id: next.to, i: 0 });
      }
    }
  }
  return back;
}

/** Layout-direction edges (written order, back-edges reversed): endpoints of each. */
function layoutEnds(ir: DiagramIR, back: Set<string>): [string, string][] {
  return ir.edges
    .filter((e) => e.from !== e.to)
    .map((e) => {
      const written: [string, string] = e.authoredReversed ? [e.to, e.from] : [e.from, e.to];
      return back.has(e.id) ? [written[1], written[0]] : written;
    });
}

/** Topological order of the (acyclic) layout edges, ties broken by first mention. */
export function topoOrder(ir: DiagramIR, rank: Map<string, number>, back: Set<string>): string[] {
  const ends = layoutEnds(ir, back);
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const id of rank.keys()) indeg.set(id, 0);
  for (const [a, b] of ends) {
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
    if (!indeg.has(a)) indeg.set(a, 0);
    if (!out.has(a)) out.set(a, []);
    out.get(a)!.push(b);
  }
  const byRank = (a: string, b: string) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity);
  const ready = [...indeg].filter(([, d]) => d === 0).map(([id]) => id).sort(byRank);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) {
        ready.push(next);
        ready.sort(byRank);
      }
    }
  }
  // Anything left sits on a cycle backEdges missed (edges into groups); keep first-mention order.
  for (const id of [...indeg.keys()].sort(byRank)) if (!order.includes(id)) order.push(id);
  return order;
}

function addPort(node: ElkNode, id: string, side: Side | undefined): string {
  if (!side || !node.ports) return node.id;
  const port: ElkPort = { id, width: 0, height: 0, layoutOptions: { 'elk.port.side': PORT_SIDE[side] } };
  node.ports.push(port);
  return id;
}

/** Convert ELK output (ROOT coordinates) into a Scene. */
export function fromElk(
  ir: DiagramIR,
  laid: ElkNode,
  lines: Map<string, string[]>,
  flipped = new Set<string>(),
  settings: LayoutSettings = {},
): Scene {
  const splines = settings.routing === 'splines';
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
    ...(n.style && { style: settleInk(n.style) }),
    ...(n.link && { link: n.link }),
    ...(n.tooltip && { tooltip: n.tooltip }),
    ...(n.compartments?.length && { compartments: n.compartments }),
    ...(n.annotation && { annotation: n.annotation }),
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
    if (e.invisible) continue;
    const le = laidEdges.get(e.id);
    if (!le?.sections?.length) continue;
    const points: Pt[] = [];
    for (const s of le.sections) {
      const raw = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      const pts = splines ? flattenBeziers(raw) : raw;
      points.push(...(points.length ? pts.slice(1) : pts));
    }
    const lab = le.labels?.[0];
    edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label,
      points: dedupe(flipped.has(e.id) ? points.reverse() : points),
      labelBox: lab ? { x: lab.x ?? 0, y: lab.y ?? 0, w: lab.width ?? 0, h: lab.height ?? 0 } : undefined,
      stroke: e.stroke,
      arrowEnd: e.arrowEnd,
      arrowStart: e.arrowStart,
      ...(e.marker && { arrowStyle: e.marker }),
      order: order.get(e.id) ?? 0,
      ...(e.style && { style: e.style }),
      ...(e.ends && { ends: e.ends }),
    });
  }

  anchorLabels(edges, nodes);
  const boxOf = new Map<string, Box>([...groups, ...nodes].map((b) => [b.id, b]));
  for (const e of edges) placeEndLabels(e, boxOf);

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

const hit = (a: Box, b: Box, pad = 2) =>
  a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

/** Closest point on a polyline to `p`. */
export function nearestOnPath(points: Pt[], p: Pt): Pt {
  let best = points[0];
  let bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/**
 * ELK parks labels beside their edge, which gets ambiguous when routes run in
 * parallel. Move each label onto the nearest point of its own route (drawn on a
 * mask, Archify-style) unless that would collide with a node or another label.
 */
function anchorLabels(edges: SceneEdge[], nodes: SceneNode[]) {
  const placed: Box[] = [];
  const labelled = edges.filter((e) => e.labelBox);
  for (const e of labelled) {
    const box = e.labelBox!;
    const on = nearestOnPath(e.points, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
    const moved = { x: on.x - box.w / 2, y: on.y - box.h / 2, w: box.w, h: box.h };
    const others = labelled.filter((o) => o !== e && !placed.includes(o.labelBox!)).map((o) => o.labelBox!);
    const clear = (b: Box) => !nodes.some((n) => hit(b, n)) && !placed.some((p) => hit(b, p)) && !others.some((o) => hit(b, o));
    if (clear(moved)) e.labelBox = moved;
    else if (gapTo(e.points, box) > LABEL_SLACK) {
      // ELK's spot is off the route (splines: it placed against the control
      // polygon). Slide along the route to the clear spot nearest the original.
      const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const spot = samplePath(e.points, 6)
        .map((p) => ({ x: p.x - box.w / 2, y: p.y - box.h / 2, w: box.w, h: box.h }))
        .filter(clear)
        .sort((a, b) => dist2(a, c, box) - dist2(b, c, box))[0];
      if (spot) e.labelBox = spot;
    }
    placed.push(e.labelBox!);
  }
}

/**
 * Class multiplicities sit just outside each end of the route, beside the
 * line: clear of the node the edge meets and of the marker drawn on it.
 */
function placeEndLabels(e: SceneEdge, boxOf: Map<string, Box>) {
  const out: NonNullable<SceneEdge['endLabels']> = [];
  const place = (text: string | undefined, tip: Pt, prev: Pt, node: Box | undefined) => {
    if (!text) return;
    const { w, h } = edgeLabelSize(text);
    // Direction into the node: across the side the route meets. Orthogonal
    // routes arrive square to that side anyway; polyline and spline routes can
    // arrive at a slant, and backing off along the slant can land on the node.
    const inward = node && sideInward(tip, node);
    const len = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
    const dx = inward ? inward.x : (tip.x - prev.x) / len;
    const dy = inward ? inward.y : (tip.y - prev.y) / len;
    // Back off from the node by the label's own extent along the line, then step aside.
    const back = Math.abs(dx) * (w / 2) + Math.abs(dy) * (h / 2) + 16;
    const side = Math.abs(dy) * (w / 2) + Math.abs(dx) * (h / 2) + 4;
    out.push({ text, x: Math.round(tip.x - dx * back - dy * side), y: Math.round(tip.y - dy * back + dx * side) });
  };
  const p = e.points;
  if (p.length < 2) return;
  place(e.ends?.startLabel, p[0], p[1], boxOf.get(e.from));
  place(e.ends?.endLabel, p.at(-1)!, p.at(-2)!, boxOf.get(e.to));
  if (out.length) e.endLabels = out;
}

/** Unit vector pointing into `b` across the side `p` lies on (the nearest side). */
function sideInward(p: Pt, b: Box): Pt {
  const sides: [number, Pt][] = [
    [Math.abs(p.x - b.x), { x: 1, y: 0 }],
    [Math.abs(p.x - (b.x + b.w)), { x: -1, y: 0 }],
    [Math.abs(p.y - b.y), { x: 0, y: 1 }],
    [Math.abs(p.y - (b.y + b.h)), { x: 0, y: -1 }],
  ];
  return sides.reduce((a, c) => (c[0] < a[0] ? c : a))[1];
}

/** How far off its route a label may sit before we go looking for a better spot. */
const LABEL_SLACK = 8;

const dist2 = (b: Box, c: Pt, box: Box) => (b.x + box.w / 2 - c.x) ** 2 + (b.y + box.h / 2 - c.y) ** 2;

/** Gap between a label box and the nearest point of its route (0 when the route touches it). */
function gapTo(points: Pt[], b: Box): number {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const q = nearestOnPath(points, c);
  return Math.max(Math.abs(q.x - c.x) - b.w / 2, Math.abs(q.y - c.y) - b.h / 2, 0);
}

/** Points every `step` px along a polyline. */
function samplePath(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * ELK's spline router returns a chain of cubic Béziers as control points
 * (start, c1, c2, end, c1, c2, end, …). Sample it into a polyline so the Scene
 * stays a list of points on the route. Anything not shaped 3k+1 is left as is.
 */
export function flattenBeziers(ctrl: Pt[], steps = 8): Pt[] {
  if (ctrl.length < 4 || (ctrl.length - 1) % 3) return ctrl;
  const out: Pt[] = [ctrl[0]];
  for (let i = 0; i + 3 < ctrl.length; i += 3) {
    const [p0, p1, p2, p3] = ctrl.slice(i, i + 4);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
    }
  }
  return out;
}

function dedupe(points: Pt[]): Pt[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

/** Edge order for trace playback: BFS depth of the source node from the graph's sources. */
export function traceOrder(ir: DiagramIR): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const n of ir.nodes) incoming.set(n.id, 0);
  const visible = ir.edges.filter((e) => !e.invisible);
  for (const e of visible) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const depth = new Map<string, number>();
  let frontier = ir.nodes.filter((n) => !incoming.get(n.id)).map((n) => n.id);
  if (!frontier.length && ir.nodes.length) frontier = [ir.nodes[0].id];
  let d = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const e of visible) if (e.from === id && !depth.has(e.to)) next.push(e.to);
    }
    frontier = next;
    d++;
  }
  const out = new Map<string, number>();
  for (const e of visible) out.set(e.id, depth.get(e.from) ?? d);
  return out;
}
