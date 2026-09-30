import type { DiagramIR, Side } from '../ir/types';
import type { Box, Pt, Scene, SceneEdge, SceneNode } from '../scene/types';
import { flattenBeziers, GROUP_PAD, MARGIN, placeEndLabels } from './elkGraph';
import { edgeLabelSize } from './measure';
import type { Pins, Routing } from './settings';

/**
 * Hand-placed nodes. ELK cannot hold a node exactly where it was dropped
 * (interactive strategies snap it back into its layer; the fixed algorithm
 * routes no edges), so pins apply after layout: move the node, grow its
 * groups, and re-route only the edges it affects. The automatic layout stays
 * untouched and deterministic; this is a pure function of scene and pins.
 *
 * Each pin is tried on a copy and kept only if the scene stays valid (no
 * overlaps, labels clear); otherwise the node keeps its automatic spot and the
 * pin is reported as ignored, to apply again once there is room.
 */

export interface PinResult {
  scene: Scene;
  applied: string[];
  /** Pins skipped because the node would collide at that offset. */
  ignored: string[];
}

export interface PinOptions {
  routing?: Routing;
  /** For architecture edges' authored port sides. */
  ir?: DiagramIR;
}

/** Room kept between a moved node and its neighbours. */
const GAP = 8;
/** Straight run out of a node before a route may turn. */
const STUB = 16;

export function applyPins(scene: Scene, pins: Pins | undefined, opts: PinOptions = {}): PinResult {
  const applied: string[] = [];
  const ignored: string[] = [];
  if (!pins || scene.seq) return { scene, applied, ignored };
  let cur = scene;
  for (const id of Object.keys(pins).sort()) {
    if (!cur.nodes.some((n) => n.id === id)) continue; // stale id: the source no longer has this node
    const next: Scene = structuredClone(cur);
    if (tryPin(next, id, pins[id], opts)) {
      cur = next;
      applied.push(id);
    } else ignored.push(id);
  }
  if (applied.length) fitCanvas(cur);
  return { scene: cur, applied, ignored };
}

function tryPin(s: Scene, id: string, [dx, dy]: [number, number], opts: PinOptions): boolean {
  const node = s.nodes.find((n) => n.id === id)!;
  node.x += dx;
  node.y += dy;
  const grown = growGroups(s, node);
  const changed = new Set([id, ...grown]);
  const reroute = s.edges.filter(
    (e) => changed.has(e.from) || changed.has(e.to) || (e.from !== id && e.to !== id && pathHits(e.points, node)),
  );
  route(s, reroute, opts);
  return valid(s, node, grown, reroute);
}

/* ---------- groups ---------- */

/** Grow each ancestor group to contain its children again. Groups never shrink. */
function growGroups(s: Scene, node: SceneNode): string[] {
  const grown: string[] = [];
  let gid = node.parent;
  while (gid) {
    const g = s.groups.find((x) => x.id === gid)!;
    const kids = [...s.nodes, ...s.groups].filter((c) => c.parent === gid);
    const x1 = Math.min(g.x, ...kids.map((c) => c.x - GROUP_PAD.left));
    const y1 = Math.min(g.y, ...kids.map((c) => c.y - GROUP_PAD.top));
    const x2 = Math.max(g.x + g.w, ...kids.map((c) => c.x + c.w + GROUP_PAD.right));
    const y2 = Math.max(g.y + g.h, ...kids.map((c) => c.y + c.h + GROUP_PAD.bottom));
    if (x1 !== g.x || y1 !== g.y || x2 !== g.x + g.w || y2 !== g.y + g.h) {
      Object.assign(g, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      grown.push(g.id);
    }
    gid = g.parent;
  }
  return grown;
}

/* ---------- validity ---------- */

const overlaps = (a: Box, b: Box, slack = 0) =>
  a.x - slack < b.x + b.w && b.x - slack < a.x + a.w && a.y - slack < b.y + b.h && b.y - slack < a.y + a.h;

function endLabelBoxes(e: SceneEdge): Box[] {
  return (e.endLabels ?? []).map((l) => {
    const { w, h } = edgeLabelSize(l.text);
    return { x: l.x - w / 2, y: l.y - h / 2, w, h };
  });
}

/** Checks only what this pin could have broken; the automatic scene was valid before it. */
function valid(s: Scene, node: SceneNode, grown: string[], rerouted: SceneEdge[]): boolean {
  const parentOf = new Map<string, string | undefined>([...s.nodes, ...s.groups].map((b) => [b.id, b.parent]));
  const within = (id: string, gid: string) => {
    for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (p === gid) return true;
    return false;
  };
  if (s.nodes.some((m) => m !== node && overlaps(node, m, GAP))) return false;
  if (s.groups.some((g) => !within(node.id, g.id) && overlaps(node, g))) return false;
  for (const gid of grown) {
    const g = s.groups.find((x) => x.id === gid)!;
    if (s.nodes.some((m) => !within(m.id, gid) && overlaps(m, g))) return false;
    if (s.groups.some((h) => h !== g && h.parent === g.parent && overlaps(g, h))) return false;
  }
  const moved = new Set(rerouted.map((e) => e.id));
  const labels = s.edges.flatMap((e) => (e.labelBox ? [{ e, b: e.labelBox }] : []));
  for (const { e, b } of labels) {
    const fresh = moved.has(e.id);
    if (fresh ? s.nodes.some((m) => overlaps(b, m, 1)) : overlaps(b, node, 1)) return false;
    if (fresh && labels.some((o) => o.e !== e && overlaps(b, o.b, 1))) return false;
  }
  for (const e of s.edges)
    for (const b of endLabelBoxes(e))
      if (moved.has(e.id) ? s.nodes.some((m) => overlaps(b, m, 1)) : overlaps(b, node, 1)) return false;
  return true;
}

/* ---------- routing ---------- */

const NORMAL: Record<Side, Pt> = { L: { x: -1, y: 0 }, R: { x: 1, y: 0 }, T: { x: 0, y: -1 }, B: { x: 0, y: 1 } };
const SIDES: Side[] = ['R', 'B', 'L', 'T'];
type Shape = 'HV' | 'VH' | 'ZH' | 'ZV';
const SHAPES: Shape[] = ['ZH', 'ZV', 'HV', 'VH'];

/** Point on side `side` of `b`, at fraction `t` along it. */
function port(b: Box, side: Side, t = 0.5): Pt {
  switch (side) {
    case 'L':
      return { x: b.x, y: b.y + b.h * t };
    case 'R':
      return { x: b.x + b.w, y: b.y + b.h * t };
    case 'T':
      return { x: b.x + b.w * t, y: b.y };
    case 'B':
      return { x: b.x + b.w * t, y: b.y + b.h };
  }
}

function orthogonal(pa: Pt, sa: Side, pb: Pt, sb: Side, shape: Shape): Pt[] {
  const a = { x: pa.x + NORMAL[sa].x * STUB, y: pa.y + NORMAL[sa].y * STUB };
  const b = { x: pb.x + NORMAL[sb].x * STUB, y: pb.y + NORMAL[sb].y * STUB };
  const mid =
    shape === 'HV'
      ? [{ x: b.x, y: a.y }]
      : shape === 'VH'
        ? [{ x: a.x, y: b.y }]
        : shape === 'ZH'
          ? [{ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }]
          : [{ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }];
  return simplify([pa, a, ...mid, b, pb]);
}

/** Drop repeated points and interior points on a straight run. */
function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (out.length && out.at(-1)!.x === p.x && out.at(-1)!.y === p.y) continue;
    if (out.length >= 2) {
      const [a, b] = [out.at(-2)!, out.at(-1)!];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Does segment a→b pass through the inside of `box` (edges touching its border are fine)? */
function segmentHits(a: Pt, b: Pt, box: Box): boolean {
  const inset = 1;
  const [x1, y1, x2, y2] = [box.x + inset, box.y + inset, box.x + box.w - inset, box.y + box.h - inset];
  if (x2 <= x1 || y2 <= y1) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x1],
    [dx, x2 - a.x],
    [-dy, a.y - y1],
    [dy, y2 - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return t1 - t0 > 1e-9;
}

function pathHits(points: Pt[], box: Box): boolean {
  for (let i = 1; i < points.length; i++) if (segmentHits(points[i - 1], points[i], box)) return true;
  return false;
}

/** Nodes a route crosses, not counting its own ends where it leaves and arrives. */
function crossings(points: Pt[], obstacles: SceneNode[], from: string, to: string): number {
  let n = 0;
  for (let i = 1; i < points.length; i++)
    for (const o of obstacles) {
      if ((o.id === from && i === 1) || (o.id === to && i === points.length - 1)) continue;
      if (segmentHits(points[i - 1], points[i], o)) n++;
    }
  return n;
}

type Seg = [Pt, Pt];
const segments = (p: Pt[]): Seg[] => p.slice(1).map((q, i) => [p[i], q]);

/**
 * How much a route runs along or across the routes it must live beside:
 * length shared with them (drawn on top of each other, unreadable) and the
 * number of crossings (fine, but fewer is calmer).
 */
function tangle(points: Pt[], others: Seg[]): { along: number; across: number } {
  let along = 0;
  let across = 0;
  for (const [a, b] of segments(points))
    for (const [c, d] of others) {
      const horiz = a.y === b.y && c.y === d.y;
      const vert = a.x === b.x && c.x === d.x;
      if (horiz && Math.abs(a.y - c.y) < 3) along += overlap(a.x, b.x, c.x, d.x);
      else if (vert && Math.abs(a.x - c.x) < 3) along += overlap(a.y, b.y, c.y, d.y);
      else if (properCross(a, b, c, d)) across++;
    }
  return { along, across };
}

const overlap = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)));

function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

const pathLength = (p: Pt[]) => p.slice(1).reduce((sum, q, i) => sum + Math.hypot(q.x - p[i].x, q.y - p[i].y), 0);

interface Plan {
  e: SceneEdge;
  a: Box;
  b: Box;
  sa: Side;
  sb: Side;
  shape: Shape;
}

function route(s: Scene, edges: SceneEdge[], opts: PinOptions) {
  if (!edges.length) return;
  const boxOf = new Map<string, Box>([...s.groups, ...s.nodes].map((b) => [b.id, b]));
  const sides = new Map((opts.ir?.edges ?? []).map((e) => [e.id, e]));
  const routing = opts.routing ?? 'orthogonal';

  // 1. Pick sides and a shape per edge, scored with centred ports: avoid nodes
  // above all, then running along the routes that stay, then bends and length.
  const staying = new Set(edges);
  const others = s.edges.filter((e) => !staying.has(e)).flatMap((e) => segments(e.points));
  const plans: Plan[] = edges.map((e) => {
    const a = boxOf.get(e.from)!;
    const b = boxOf.get(e.to)!;
    const ir = sides.get(e.id);
    let best: Plan & { score: number } = { e, a, b, sa: 'R', sb: 'L', shape: 'ZH', score: Infinity };
    for (const sa of ir?.fromSide ? [ir.fromSide] : SIDES)
      for (const sb of ir?.toSide ? [ir.toSide] : SIDES)
        for (const shape of SHAPES) {
          const pts = orthogonal(port(a, sa), sa, port(b, sb), sb, shape);
          const { along, across } = tangle(pts, others);
          const score = crossings(pts, s.nodes, e.from, e.to) * 1e6 + along * 12 + across * 40 + (pts.length - 2) * 24 + pathLength(pts);
          if (score < best.score) best = { e, a, b, sa, sb, shape, score };
        }
    return best;
  });

  // 2. Spread the ports of edges sharing a side, ordered by where their other end lies.
  const bySide = new Map<string, { plan: Plan; end: 'a' | 'b'; key: number }[]>();
  for (const plan of plans)
    for (const end of ['a', 'b'] as const) {
      const id = end === 'a' ? plan.e.from : plan.e.to;
      const side = end === 'a' ? plan.sa : plan.sb;
      const other = end === 'a' ? plan.b : plan.a;
      const k = `${id}:${side}`;
      const key = side === 'L' || side === 'R' ? other.y + other.h / 2 : other.x + other.w / 2;
      if (!bySide.has(k)) bySide.set(k, []);
      bySide.get(k)!.push({ plan, end, key });
    }
  const t = new Map<string, number>();
  for (const list of bySide.values()) {
    list.sort((p, q) => p.key - q.key || (p.plan.e.id < q.plan.e.id ? -1 : 1));
    list.forEach((x, i) => t.set(`${x.plan.e.id}:${x.end}`, (i + 1) / (list.length + 1)));
  }

  // 3. Build the final routes in the chosen style.
  for (const plan of plans) {
    const { e, a, b, sa, sb, shape } = plan;
    const pa = port(a, sa, t.get(`${e.id}:a`));
    const pb = port(b, sb, t.get(`${e.id}:b`));
    const square = orthogonal(pa, sa, pb, sb, shape);
    let pts = square;
    if (routing === 'polyline') pts = [pa, pb];
    else if (routing === 'splines') {
      const k = Math.max(24, Math.hypot(pb.x - pa.x, pb.y - pa.y) / 3);
      pts = flattenBeziers([pa, { x: pa.x + NORMAL[sa].x * k, y: pa.y + NORMAL[sa].y * k }, { x: pb.x + NORMAL[sb].x * k, y: pb.y + NORMAL[sb].y * k }, pb]);
    }
    if (pts !== square && crossings(pts, s.nodes, e.from, e.to) > crossings(square, s.nodes, e.from, e.to)) pts = square;
    e.points = pts;
  }

  placeLabels(s, edges);
  for (const e of edges) {
    delete e.endLabels;
    placeEndLabels(e, boxOf);
  }
}

/** Centre each re-routed label on its route, sliding along it to the nearest clear spot. */
function placeLabels(s: Scene, rerouted: SceneEdge[]) {
  const fresh = new Set(rerouted);
  const taken: Box[] = s.edges.filter((e) => !fresh.has(e) && e.labelBox).map((e) => e.labelBox!);
  for (const e of rerouted) {
    if (!e.labelBox) continue;
    const { w, h } = e.labelBox;
    const at = (p: Pt) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
    const clear = (b: Box) => !s.nodes.some((n) => overlaps(b, n, 2)) && !taken.some((o) => overlaps(b, o, 2));
    const samples = sample(e.points, 6);
    const mid = samples[Math.floor(samples.length / 2)] ?? e.points[0];
    const spot = clear(at(mid))
      ? at(mid)
      : samples
          .map(at)
          .filter(clear)
          .sort((p, q) => Math.hypot(p.x + w / 2 - mid.x, p.y + h / 2 - mid.y) - Math.hypot(q.x + w / 2 - mid.x, q.y + h / 2 - mid.y))[0];
    e.labelBox = spot ?? at(mid);
    taken.push(e.labelBox);
  }
}

/** Points every `step` px along a polyline, including both ends. */
function sample(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (points.length) out.push(points.at(-1)!);
  return out;
}

/* ---------- canvas ---------- */

/** Keep everything at least MARGIN from the top-left, and size the canvas to the content. */
function fitCanvas(s: Scene) {
  const boxes: Box[] = [
    ...s.nodes,
    ...s.groups,
    ...s.edges.flatMap((e) => [...e.points.map((p) => ({ ...p, w: 0, h: 0 })), ...(e.labelBox ? [e.labelBox] : []), ...endLabelBoxes(e)]),
  ];
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const sx = Math.max(0, MARGIN - minX);
  const sy = Math.max(0, MARGIN - minY);
  if (sx || sy) {
    const move = (b: { x: number; y: number }) => {
      b.x += sx;
      b.y += sy;
    };
    [...s.nodes, ...s.groups].forEach(move);
    for (const e of s.edges) {
      e.points.forEach(move);
      if (e.labelBox) move(e.labelBox);
      e.endLabels?.forEach(move);
    }
  }
  s.width = Math.ceil(maxX + sx + MARGIN);
  s.height = Math.ceil(maxY + sy + MARGIN);
}
