import type { Scene } from '../scene/types';
import type { Palette } from './settings';

/** Hues in tokens.css (`--tone-0-…` to `--tone-7-…`), handed out in source order. */
export const TONES = 8;
/** Nesting levels with their own shade (`--depth-1-…` to `--depth-4-…`); deeper ones reuse the last. */
export const DEPTHS = 4;

/** Shapes drawn in fixed ink (markers, labels, notes) that a tint would not show on. */
const UNTINTED = new Set(['start', 'end', 'junction', 'fork', 'text', 'note']);

/**
 * `auto` colours by group only when there are groups and no node carries a
 * component type: type colours already mean something, and a second set of
 * hues on top would compete with them.
 */
export function resolvePalette(scene: Scene, palette: Palette = 'auto'): Exclude<Palette, 'auto'> {
  if (palette !== 'auto') return palette;
  if (scene.seq || !scene.groups.length) return 'mono';
  return scene.nodes.every((n) => n.type === 'plain') ? 'groups' : 'mono';
}

/** Set `accent` on groups (and, for `groups`, on their plain nodes and outgoing edges). Mutates `scene`. */
export function applyPalette(scene: Scene, palette?: Palette): Scene {
  const mode = resolvePalette(scene, palette);
  if (mode === 'mono') return scene;

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
