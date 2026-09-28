import ELK from 'elkjs/lib/elk.bundled.js';
import { expect, test } from 'vitest';
import { layout } from '../src/layout';
import { parseMermaid } from '../src/parse';
import { adjacency, neighbourhood, route, search } from '../src/viewer/graph';

const scene = async (src: string) => layout(await parseMermaid(src), new ELK());

test('neighbourhood covers direct up/downstream only', async () => {
  const s = await scene('flowchart LR\n  A --> B --> C --> D\n  X --> B');
  const lit = neighbourhood(adjacency(s), 'B');
  expect([...lit.nodes].sort()).toEqual(['A', 'B', 'C', 'X']);
  expect(lit.edges.size).toBe(3);
});

test('route follows direction and finds the shortest path', async () => {
  const s = await scene('flowchart LR\n  A --> B --> C --> D\n  A --> D\n  E --> A');
  const adj = adjacency(s);
  expect([...route(adj, 'A', 'D')!.nodes].sort()).toEqual(['A', 'D']);
  expect([...route(adj, 'E', 'C')!.nodes].sort()).toEqual(['A', 'B', 'C', 'E']);
  expect(route(adj, 'D', 'A')).toBeUndefined();
});

test('bidirectional edges route both ways', async () => {
  const s = await scene('flowchart LR\n  A <--> B');
  expect(route(adjacency(s), 'B', 'A')).toBeDefined();
});

test('search ranks prefix matches first', async () => {
  const s = await scene('flowchart LR\n  api[Checkout API] --> db[(Postgres)]\n  pay[API Gateway]');
  expect(search(s, 'api').map((r) => r.id)).toEqual(['api', 'pay']);
  expect(search(s, 'gate').map((r) => r.id)).toEqual(['pay']);
  expect(search(s, 'post')[0].id).toBe('db');
  expect(search(s, '')).toEqual([]);
});
