import type { DiagramIR } from '../ir/types';
import type { Scene } from '../scene/types';
import { type ElkLike, fromElk, toElkGraph } from './elkGraph';
import { layoutSequence } from './sequence';

export type { ElkLike };

export async function layout(ir: DiagramIR, elk: ElkLike): Promise<Scene> {
  if (ir.kind === 'sequence') return layoutSequence(ir);
  const { graph, lines } = toElkGraph(ir);
  const laid = await elk.layout(graph);
  return fromElk(ir, laid, lines);
}
