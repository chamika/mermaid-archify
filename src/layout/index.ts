import type { DiagramIR } from '../ir/types';
import type { Scene } from '../scene/types';
import { type ElkLike, fromElk, toElkGraph } from './elkGraph';
import { applyPins } from './pins';
import { layoutSequence } from './sequence';
import type { LayoutSettings } from './settings';

export type { ElkLike, LayoutSettings };
export { applyPins };

/** Sequence diagrams have their own layout and ignore `settings`. */
export async function layout(ir: DiagramIR, elk: ElkLike, settings: LayoutSettings = {}): Promise<Scene> {
  const scene = ir.kind === 'sequence' ? layoutSequence(ir) : await layoutGraph(ir, elk, settings);
  if (ir.icons) scene.icons = ir.icons;
  return scene;
}

async function layoutGraph(ir: DiagramIR, elk: ElkLike, settings: LayoutSettings): Promise<Scene> {
  const { graph, lines, flipped } = toElkGraph(ir, settings);
  const laid = await elk.layout(graph);
  const auto = fromElk(ir, laid, lines, flipped, settings);
  return applyPins(auto, settings.pins, { routing: settings.routing, ir }).scene;
}
