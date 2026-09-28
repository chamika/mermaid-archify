import { classify } from '../ir/classify';
import type { DiagramIR, IREdge, IRGroup, IRNode, Side } from '../ir/types';
import { cleanLabel } from './text';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function architectureToIR(db: any): DiagramIR {
  const groups: IRGroup[] = db.getGroups().map((g: { id: string; title?: string; in?: string; icon?: string }) => ({
    id: g.id,
    label: cleanLabel(g.title) || g.id,
    parent: g.in,
    hint: g.icon,
  }));

  const nodes: IRNode[] = [];
  for (const s of db.getServices()) {
    const label = cleanLabel(s.title) || s.id;
    nodes.push({
      id: s.id,
      label,
      shape: 'rect',
      type: classify({ label, id: s.id, icon: s.icon ?? s.iconText }),
      parent: s.in,
      classes: [],
      hint: s.icon,
    });
  }
  for (const j of db.getJunctions()) {
    nodes.push({ id: j.id, label: '', shape: 'junction', type: 'external', parent: j.in, classes: [] });
  }

  const parentOf = new Map(nodes.map((n) => [n.id, n.parent]));
  const edges: IREdge[] = db.getEdges().map(
    (
      e: {
        lhsId: string;
        rhsId: string;
        lhsDir: Side;
        rhsDir: Side;
        lhsInto?: boolean;
        rhsInto?: boolean;
        lhsGroup?: boolean;
        rhsGroup?: boolean;
        title?: string;
      },
      i: number,
    ) => ({
      id: `e${i}`,
      from: (e.lhsGroup && parentOf.get(e.lhsId)) || e.lhsId,
      to: (e.rhsGroup && parentOf.get(e.rhsId)) || e.rhsId,
      label: cleanLabel(e.title) || undefined,
      stroke: 'solid',
      arrowEnd: !!e.rhsInto,
      arrowStart: !!e.lhsInto,
      fromSide: e.lhsDir,
      toSide: e.rhsDir,
    }),
  );

  return {
    kind: 'architecture',
    title: db.getDiagramTitle?.() || undefined,
    direction: 'LR',
    nodes,
    edges,
    groups,
  };
}
