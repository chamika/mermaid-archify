import type { Scene, SceneEdge } from '../scene/types';

export interface Adjacency {
  incoming: Map<string, SceneEdge[]>;
  outgoing: Map<string, SceneEdge[]>;
}

export function adjacency(scene: Scene): Adjacency {
  const incoming = new Map<string, SceneEdge[]>();
  const outgoing = new Map<string, SceneEdge[]>();
  for (const e of scene.edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    outgoing.get(e.from)!.push(e);
    incoming.get(e.to)!.push(e);
    // Bidirectional edges are walkable both ways.
    if (e.arrowStart && e.arrowEnd) {
      if (!outgoing.has(e.to)) outgoing.set(e.to, []);
      if (!incoming.has(e.from)) incoming.set(e.from, []);
      outgoing.get(e.to)!.push(e);
      incoming.get(e.from)!.push(e);
    }
  }
  return { incoming, outgoing };
}

export interface Lit {
  nodes: Set<string>;
  edges: Set<string>;
}

/** The node, its direct neighbours, and the edges between them. */
export function neighbourhood(adj: Adjacency, id: string): Lit {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  for (const e of adj.incoming.get(id) ?? []) {
    edges.add(e.id);
    nodes.add(e.from === id ? e.to : e.from);
  }
  for (const e of adj.outgoing.get(id) ?? []) {
    edges.add(e.id);
    nodes.add(e.to === id ? e.from : e.to);
  }
  return { nodes, edges };
}

/**
 * Shortest directed route over authored edges (BFS). Returns undefined when no
 * directed route exists — the probe never infers one from geometry.
 */
export function route(adj: Adjacency, from: string, to: string): Lit | undefined {
  if (from === to) return { nodes: new Set([from]), edges: new Set() };
  const prev = new Map<string, SceneEdge>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of adj.outgoing.get(cur) ?? []) {
      const next = e.from === cur ? e.to : e.from;
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, e);
      if (next === to) {
        const lit: Lit = { nodes: new Set([to]), edges: new Set() };
        let at = to;
        while (at !== from) {
          const edge = prev.get(at)!;
          lit.edges.add(edge.id);
          at = edge.to === at ? edge.from : edge.to;
          lit.nodes.add(at);
        }
        return lit;
      }
      queue.push(next);
    }
  }
  return undefined;
}

/** Rank finder matches: exact > prefix > word-prefix > substring, label before id. */
export function search(scene: Scene, query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { id: string; label: string; score: number }[] = [];
  for (const n of scene.nodes) {
    if (!n.label && n.shape !== 'junction') continue;
    const label = n.label.toLowerCase().replace(/\n/g, ' ');
    const id = n.id.toLowerCase();
    let score = 0;
    if (label === q || id === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (label.split(/[\s·/_-]+/).some((w) => w.startsWith(q))) score = 60;
    else if (id.startsWith(q)) score = 50;
    else if (label.includes(q)) score = 40;
    else if (id.includes(q)) score = 30;
    if (score) scored.push({ id: n.id, label: n.label || n.id, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
}
