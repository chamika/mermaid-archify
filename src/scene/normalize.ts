import { type IRStyle, parseStyle } from '../ir/style';
import { SEMANTIC_TYPES } from '../ir/types';
import type { Scene, SceneEdge, SceneGroup, SceneNode } from './types';

/** The Scene format this viewer reads. */
export const SCENE_VERSION = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isBox = (v: Raw): boolean => isObject(v) && num(v.x) && num(v.y) && num(v.w) && num(v.h);
const isPt = (v: Raw): boolean => isObject(v) && num(v.x) && num(v.y);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v : []);
/** Palette tokens are `tone-3`, `depth-2`, `loop`…: a token prefix, never CSS. */
const token = (v: unknown) => (typeof v === 'string' && /^[a-z]+(-\d+)?$/.test(v) ? v : undefined);

/** Author styles again through the parser's whitelist: a hand-made scene can carry anything. */
function style(v: unknown): IRStyle | undefined {
  if (!isObject(v)) return undefined;
  const css: Record<string, string> = { fill: 'fill', stroke: 'stroke', strokeWidth: 'stroke-width', dash: 'stroke-dasharray', color: 'color', fontWeight: 'font-weight', fontStyle: 'font-style' };
  return parseStyle(Object.entries(v).flatMap(([k, val]) => (css[k] && (typeof val === 'string' || num(val)) ? [`${css[k]}:${val}`] : [])));
}

function node(n: Raw): SceneNode | undefined {
  if (!isBox(n) || typeof (n as Raw).id !== 'string') return undefined;
  const r = n as Raw;
  const label = str(r.label, r.id);
  return {
    ...r,
    label,
    lines: Array.isArray(r.lines) && r.lines.every((l: unknown) => typeof l === 'string') ? r.lines : label.split('\n'),
    type: SEMANTIC_TYPES.includes(r.type) ? r.type : 'plain',
    shape: str(r.shape, 'rect'),
    style: style(r.style),
    accent: token(r.accent),
    link: typeof r.link === 'string' ? r.link : undefined,
  };
}

function group(g: Raw): SceneGroup | undefined {
  if (!isBox(g) || typeof (g as Raw).id !== 'string') return undefined;
  const r = g as Raw;
  return { ...r, label: str(r.label), depth: num(r.depth) ? r.depth : 0, style: style(r.style), accent: token(r.accent) };
}

function edge(e: Raw, i: number): SceneEdge | undefined {
  if (!isObject(e) || typeof e.id !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') return undefined;
  const points = list(e.points).filter(isPt);
  if (points.length < 2) return undefined;
  return {
    ...(e as Raw),
    points,
    label: typeof e.label === 'string' ? e.label : undefined,
    labelBox: isBox(e.labelBox) ? e.labelBox : undefined,
    stroke: ['solid', 'dotted', 'thick', 'invisible'].includes(e.stroke as string) ? e.stroke : 'solid',
    arrowEnd: e.arrowEnd !== false,
    arrowStart: e.arrowStart === true,
    order: num(e.order) ? (e.order as number) : i,
    style: style(e.style),
    accent: token(e.accent),
    endLabels: list(e.endLabels).filter((l) => isPt(l) && typeof l.text === 'string'),
  };
}

/**
 * A Scene from outside this process (exported HTML, `scene-json`, a `scene` URL,
 * the element's `scene` property), made safe to render: missing arrays default
 * to empty, malformed nodes and edges are dropped, unknown types render plain,
 * and author styles are validated again. A scene from a newer format is refused
 * with a message rather than drawn wrong.
 */
export function normalizeScene(raw: unknown): Scene {
  if (!isObject(raw)) throw new Error('Not a mermaid-archify scene: expected a JSON object.');
  const version = raw.version ?? SCENE_VERSION;
  if (!num(version) || (version as number) > SCENE_VERSION)
    throw new Error(`This diagram uses scene format ${String(version)}; this viewer reads format ${SCENE_VERSION}. Update mermaid-archify.`);
  const nodes = list(raw.nodes).map(node).filter((n): n is SceneNode => !!n);
  const groups = list(raw.groups).map(group).filter((g): g is SceneGroup => !!g);
  const ids = new Set([...nodes, ...groups].map((b) => b.id));
  const edges = list(raw.edges)
    .map(edge)
    .filter((e): e is SceneEdge => !!e && ids.has(e.from) && ids.has(e.to));
  const boxes = [...nodes, ...groups];
  const extent = (k: 'x' | 'y', d: 'w' | 'h') => Math.max(0, ...boxes.map((b) => b[k] + b[d])) + 32;
  const seq = isObject(raw.seq)
    ? {
        lifelines: list(raw.seq.lifelines).filter((l) => isObject(l) && typeof l.actor === 'string' && num(l.x) && num(l.y1) && num(l.y2)),
        activations: list(raw.seq.activations).filter(isBox),
        notes: list(raw.seq.notes)
          .filter(isBox)
          .map((n) => ({ ...n, text: str(n.text), lines: Array.isArray(n.lines) ? n.lines.filter((l: unknown) => typeof l === 'string') : str(n.text).split('\n') })),
        blocks: list(raw.seq.blocks)
          .filter(isBox)
          .map((b) => ({ ...b, label: str(b.label), sections: list(b.sections).filter((s) => isObject(s) && num(s.y)).map((s) => ({ y: s.y, label: str(s.label) })) })),
        footers: list(raw.seq.footers).map(node).filter((n): n is SceneNode => !!n),
      }
    : undefined;
  return {
    ...(raw as Raw),
    version: SCENE_VERSION,
    kind: str(raw.kind, 'flowchart'),
    title: typeof raw.title === 'string' ? raw.title : undefined,
    width: num(raw.width) && (raw.width as number) > 0 ? raw.width : extent('x', 'w'),
    height: num(raw.height) && (raw.height as number) > 0 ? raw.height : extent('y', 'h'),
    nodes,
    groups,
    edges,
    seq,
    legend: raw.legend === undefined ? undefined : list(raw.legend).filter((l) => isObject(l) && token(l.accent) && typeof l.label === 'string'),
    icons: isObject(raw.icons) ? raw.icons : undefined,
  } as Scene;
}
