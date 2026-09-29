import type { DiagramIR } from '../ir/types';
import type { Scene } from '../scene/types';
import { type ElkLike, fromElk, toElkGraph } from './elkGraph';
import { layoutSequence } from './sequence';
import type { LayoutSettings } from './settings';

export type { ElkLike, LayoutSettings };

/** Sequence diagrams have their own layout and ignore `settings`. */
export async function layout(ir: DiagramIR, elk: ElkLike, settings: LayoutSettings = {}): Promise<Scene> {
  const scene = ir.kind === 'sequence' ? layoutSequence(ir) : await layoutGraph(ir, elk, settings);
  if (ir.icons) scene.icons = ir.icons;
  return scene;
}

async function layoutGraph(ir: DiagramIR, elk: ElkLike, settings: LayoutSettings): Promise<Scene> {
  const { graph, lines, flipped } = toElkGraph(ir, settings);
  const laid = await elk.layout(graph);
  return fromElk(ir, laid, lines, flipped, settings);
}
