import type { DiagramIR } from '../ir/types';
import type { Scene } from '../scene/types';
import { type ElkLike, fromElk, toElkGraph } from './elkGraph';
import { applyPalette } from './palette';
import { applyPins } from './pins';
import { layoutSequence } from './sequence';
import { type LayoutSettings, normalize } from './settings';

export type { ElkLike, LayoutSettings };
export { applyPalette, applyPins };

/** Sequence diagrams have their own layout and ignore `settings` (a palette has nothing to colour there). */
export async function layout(ir: DiagramIR, elk: ElkLike, raw: LayoutSettings = {}): Promise<Scene> {
  // Callers pass library options and UI state as well as front-matter: all get the same clamping.
  const settings = normalize(raw as Record<string, unknown>);
  const scene = ir.kind === 'sequence' ? layoutSequence(ir) : await layoutGraph(ir, elk, settings);
  if (ir.icons) scene.icons = ir.icons;
  return applyPalette(scene, settings.palette);
}

async function layoutGraph(ir: DiagramIR, elk: ElkLike, settings: LayoutSettings): Promise<Scene> {
  const { graph, lines, flipped } = toElkGraph(ir, settings);
  const laid = await elk.layout(graph);
  const auto = fromElk(ir, laid, lines, flipped, settings);
  return applyPins(auto, settings.pins, { routing: settings.routing, ir }).scene;
}
