import type { DiagramIR } from '../ir/types';
import type { Scene } from '../scene/types';
import { type ElkLike, fromElk, toElkGraph } from './elkGraph';
import { layoutSequence } from './sequence';

export type { ElkLike };

export async function layout(ir: DiagramIR, elk: ElkLike): Promise<Scene> {
  const scene = ir.kind === 'sequence' ? layoutSequence(ir) : await layoutGraph(ir, elk);
  if (ir.icons) scene.icons = ir.icons;
  return scene;
}

async function layoutGraph(ir: DiagramIR, elk: ElkLike): Promise<Scene> {
  const { graph, lines, flipped } = toElkGraph(ir);
  const laid = await elk.layout(graph);
  return fromElk(ir, laid, lines, flipped);
}
