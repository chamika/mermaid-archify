import type { Scene, SceneEdge } from '../scene/types';
import { findRegions } from './regions';
import type { Palette } from './settings';

/** Hues in tokens.css (`--tone-0-…` to `--tone-7-…`), handed out in source order. */
export const TONES = 8;
/** Nesting levels with their own shade (`--depth-1-…` to `--depth-4-…`); deeper ones reuse the last. */
export const DEPTHS = 4;

/** Region hues for the `regions` palette, and what the legend calls them. Listed in legend order. */
export const REGIONS = {
  loop: { accent: 'tone-4', label: 'loop' },
  decision: { accent: 'tone-2', label: 'decision' },
  failure: { accent: 'tone-3', label: 'failure path' },
} as const;
type Region = keyof typeof REGIONS;

/** Shapes drawn in fixed ink (markers, labels, notes) that a tint would not show on. */
const UNTINTED = new Set(['start', 'end', 'junction', 'fork', 'text', 'note']);

/**
 * `auto` colours only diagrams where no node carries a component type: type
 * colours already mean something, and a second set of hues on top would
 * compete with them. With subgraphs it colours by group; a flowchart without
 * any gets its loops, decisions and failure paths tinted instead.
 */
export function resolvePalette(scene: Scene, palette: Palette = 'auto'): Exclude<Palette, 'auto'> {
  if (palette !== 'auto') return palette;
  if (scene.seq || !scene.nodes.every((n) => n.type === 'plain')) return 'mono';
  if (scene.groups.length) return 'groups';
  return scene.kind === 'flowchart' ? 'regions' : 'mono';
}

/**
 * Set `accent` on groups (and, for `groups`, on their plain nodes and outgoing
 * edges), or for `regions` on nodes and edges by role, with a legend. Mutates `scene`.
 */
export function applyPalette(scene: Scene, palette?: Palette): Scene {
  const mode = resolvePalette(scene, palette);
  if (mode === 'mono') return scene;
  if (mode === 'regions') return paintRegions(scene);

  if (mode === 'depth') {
    for (const g of scene.groups) g.accent = `depth-${Math.min(g.depth + 1, DEPTHS)}`;
    return scene;
  }

  const parentOf = new Map<string, string | undefined>([...scene.groups, ...scene.nodes].map((b) => [b.id, b.parent]));
  const tone = new Map(scene.groups.filter((g) => !g.parent).map((g, i) => [g.id, `tone-${i % TONES}`]));
  /** The tone of the top-level group that holds `id`, if any. */
  const toneOf = (id: string): string | undefined => {
    let top = id;
    for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p)) top = p;
    return tone.get(top);
  };

  const paint = (item: { accent?: string }, id: string) => {
    const t = toneOf(id);
    if (t) item.accent = t;
  };
  for (const g of scene.groups) paint(g, g.id);
  for (const n of scene.nodes) if (n.type === 'plain' && !UNTINTED.has(n.shape)) paint(n, n.id);
  for (const e of scene.edges) paint(e, e.from);
  return scene;
}

/**
 * Flowcharts only. A node gets one role: failure path, else loop, else
 * decision (a diamond). An edge takes a region's hue when both its ends were
 * painted with it, and a failure edge is always tinted. Typed or author-styled
 * nodes and edges keep their own look.
 */
function paintRegions(scene: Scene): Scene {
  if (scene.kind !== 'flowchart' || !scene.edges.length) return scene;
  const { loop, failure, failureEdges } = findRegions(scene);
  const regionOf = (id: string): Region | undefined => (failure.has(id) ? 'failure' : loop.has(id) ? 'loop' : undefined);
  const painted = new Map<string, Region>();

  for (const n of scene.nodes) {
    if (n.type !== 'plain' || UNTINTED.has(n.shape) || n.style) continue;
    const role = regionOf(n.id) ?? (n.shape === 'diamond' ? 'decision' : undefined);
    if (!role) continue;
    n.accent = REGIONS[role].accent;
    painted.set(n.id, role);
  }
  const used = new Set(painted.values());
  /** Inside one painted region: the failure path, or the same loop (two loops in a row stay apart). */
  const inside = (e: SceneEdge): Region | undefined => {
    const role = painted.get(e.from);
    if (role === 'decision' || role !== painted.get(e.to)) return undefined;
    return role === 'loop' && loop.get(e.from) !== loop.get(e.to) ? undefined : role;
  };
  for (const e of scene.edges) {
    if (e.style?.stroke) continue;
    const role = failureEdges.has(e.id) ? 'failure' : inside(e);
    if (!role) continue;
    e.accent = REGIONS[role].accent;
    used.add(role);
  }

  const legend = (Object.keys(REGIONS) as Region[]).filter((r) => used.has(r)).map((r) => ({ ...REGIONS[r] }));
  if (legend.length) scene.legend = legend;
  return scene;
}
