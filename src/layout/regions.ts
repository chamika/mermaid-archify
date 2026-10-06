import { FAILURE_WORDS, STRUCTURAL } from '../ir/classify';
import type { Scene } from '../scene/types';

/**
 * Structural regions of a flowchart, for colouring process flows that have no
 * subgraphs to colour: loop bodies, and the paths only a failure reaches.
 */
export interface Regions {
  /** Nodes on a loop, by loop: strongly connected components, minus any that swallow most of the diagram. */
  loop: Map<string, number>;
  /** Nodes reached only through a failure edge. */
  failure: Set<string>;
  /** Edges whose label reads as a failure (`exception`, `on error`, `rejected`). */
  failureEdges: Set<string>;
}

/** A loop holding more than this share of the content nodes is not a region: one hue on nearly everything says nothing. */
const MAX_LOOP_SHARE = 3 / 4;

const FAILURE_LABEL = new RegExp(`${FAILURE_WORDS.source}|exception|throw`, 'gi');
/** "no errors", "without failure": the word is there but the branch is the happy one. */
const NEGATED = /\b(?:no|not|non|without)[\s-]*$/i;

/** True when an edge label names a failure. Substring match, so `ConstraintViolationException` counts. */
export function isFailureLabel(label: string | undefined): boolean {
  if (!label) return false;
  for (const m of label.matchAll(FAILURE_LABEL)) if (!NEGATED.test(label.slice(0, m.index))) return true;
  return false;
}

export function findRegions(scene: Scene): Regions {
  const ids = [...new Set([...scene.nodes.map((n) => n.id), ...scene.edges.flatMap((e) => [e.from, e.to])])];
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of scene.edges) out.get(e.from)!.push(e.to);

  const content = new Set(scene.nodes.filter((n) => !STRUCTURAL.has(n.shape)).map((n) => n.id));
  const selfLoop = new Set(scene.edges.filter((e) => e.from === e.to).map((e) => e.from));
  const loop = new Map<string, number>();
  const comps = stronglyConnected(ids, out).filter(
    (comp) => (comp.length > 1 || selfLoop.has(comp[0])) && comp.filter((id) => content.has(id)).length <= content.size * MAX_LOOP_SHARE,
  );
  comps.forEach((comp, i) => comp.forEach((id) => loop.set(id, i)));

  const failureEdges = new Set(scene.edges.filter((e) => isFailureLabel(e.label)).map((e) => e.id));
  const failure = new Set<string>();
  if (failureEdges.size) {
    // The happy path starts at nodes nothing points at, and at the first node written (a diagram
    // that is one big cycle has no other start; a failure that retries from the top leads back to it).
    const indeg = new Set(scene.edges.filter((e) => e.from !== e.to).map((e) => e.to));
    const failTargets = new Set(scene.edges.filter((e) => failureEdges.has(e.id)).map((e) => e.to));
    const roots = ids.filter((id) => !indeg.has(id));
    if (scene.nodes.length) roots.push(scene.nodes[0].id);

    const happyOut = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const e of scene.edges) if (!failureEdges.has(e.id)) happyOut.get(e.from)!.push(e.to);
    const happy = reach(roots, happyOut);
    for (const id of reach([...failTargets], out)) if (!happy.has(id)) failure.add(id);
  }
  return { loop, failure, failureEdges };
}

/** Everything reachable from `from` (inclusive). */
function reach(from: string[], out: Map<string, string[]>): Set<string> {
  const seen = new Set(from);
  const queue = [...from];
  while (queue.length) {
    for (const next of out.get(queue.shift()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Tarjan's strongly connected components, iterative so deep chains cannot overflow the stack. */
function stronglyConnected(ids: string[], out: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const comps: string[][] = [];
  let counter = 0;
  const visit = (id: string) => {
    index.set(id, counter);
    low.set(id, counter++);
    stack.push(id);
    onStack.add(id);
  };
  for (const root of ids) {
    if (index.has(root)) continue;
    visit(root);
    const work: { id: string; i: number }[] = [{ id: root, i: 0 }];
    while (work.length) {
      const top = work.at(-1)!;
      const next = out.get(top.id)?.[top.i++];
      if (next !== undefined) {
        if (!index.has(next)) {
          visit(next);
          work.push({ id: next, i: 0 });
        } else if (onStack.has(next)) low.set(top.id, Math.min(low.get(top.id)!, index.get(next)!));
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(top.id)!));
      if (low.get(top.id) !== index.get(top.id)) continue;
      const comp: string[] = [];
      let id: string;
      do {
        id = stack.pop()!;
        onStack.delete(id);
        comp.push(id);
      } while (id !== top.id);
      comps.push(comp);
    }
  }
  return comps;
}
