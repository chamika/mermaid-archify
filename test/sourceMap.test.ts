import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildSourceMap } from '../src/app/sourceMap';
import { parseMermaid } from '../src/parse';

const sample = (name: string) => readFileSync(`${process.cwd()}/src/samples/${name}.mmd`, 'utf8');

async function mapOf(src: string) {
  const ir = await parseMermaid(src);
  const map = buildSourceMap(src, ir);
  const lines = src.split('\n');
  /** The trimmed source line that defines an element. */
  const lineText = (id: string) => lines[(map.lineOf.get(id) ?? 0) - 1]?.trim();
  const at = (line: number) => {
    const t = map.atLine.get(line);
    return t && { nodes: [...t.nodes].sort(), edges: [...t.edges].sort() };
  };
  return { ir, map, lineText, at };
}

describe('source map', () => {
  test('flowchart: declarations, chains, subgraphs', async () => {
    const { ir, lineText, at } = await mapOf(sample('architecture-flowchart'));
    expect(lineText('api')).toBe('api[[Checkout API]]');
    expect(lineText('edge')).toBe('subgraph edge[Edge]');
    const chain = ir.edges.filter((e) => ['user', 'cdn', 'waf'].includes(e.from)).map((e) => e.id);
    for (const id of chain) expect(lineText(id)).toBe('user -->|HTTPS| cdn --> waf --> web');
    expect(at(23)).toEqual({ nodes: ['cdn', 'user', 'waf', 'web'], edges: [...chain].sort() });
    // A subgraph line lights its members.
    expect(at(14)?.nodes).toEqual(['cache', 'db']);
  });

  test('flowchart: & fan-out and repeated pairs keep their own lines', async () => {
    const src = 'flowchart LR\n  A & B --> C & D\n  A --> C\n  style A fill:#f00';
    const { ir, map, at } = await mapOf(src);
    const line = (from: string, to: string) => ir.edges.filter((e) => e.from === from && e.to === to).map((e) => map.lineOf.get(e.id));
    expect(line('A', 'C')).toEqual([2, 3]);
    expect(line('B', 'D')).toEqual([2]);
    expect(at(4)).toEqual({ nodes: ['A'], edges: [] });
  });

  test('sequence: participants and every message', async () => {
    const { ir, lineText } = await mapOf(sample('sequence'));
    expect(lineText('A')).toBe('participant A as Checkout API');
    expect(ir.edges.map((e) => lineText(e.id))).toEqual([
      'U->>W: open cart',
      'W->>+A: GET /cart',
      'A->>C: GET cart:42',
      'C-->>A: miss',
      'A->>+D: SELECT cart',
      'D-->>-A: rows',
      'A-)C: SET cart:42 (ttl 60s)',
      'A->>A: create empty cart',
      'A-->>-W: 200 cart',
      'W-->>U: render',
    ]);
  });

  test('state: transitions, [*] pseudo-states, composites, notes', async () => {
    const { ir, map, lineText, at } = await mapOf(sample('state'));
    expect(ir.edges.every((e) => map.lineOf.has(e.id))).toBe(true);
    expect(lineText('Running')).toBe('state Running {');
    expect(lineText('Fetching')).toBe('[*] --> Fetching');
    const start = ir.nodes.find((n) => n.shape === 'start' && !n.parent)!;
    expect(lineText(start.id)).toBe('[*] --> Queued');
    expect(at(4)?.nodes).toEqual(expect.arrayContaining(['Fetching', 'Building', 'Testing']));

    const notes = await mapOf('stateDiagram-v2\n  A --> B\n  note right of A : check this\n  note left of B\n    multi\n  end note');
    const noteA = notes.ir.nodes.find((n) => n.shape === 'note' && n.id.startsWith('A__'))!;
    expect(notes.map.lineOf.get(noteA.id)).toBe(3);
    expect(notes.at(3)?.nodes).toEqual(expect.arrayContaining([noteA.id]));
  });

  test('ER: relationships and attribute rows', async () => {
    const { ir, lineText, at } = await mapOf(sample('er'));
    expect(lineText('ORDER')).toBe('ORDER {');
    expect(lineText(ir.edges[0].id)).toBe('CUSTOMER ||--o{ ORDER : places');
    expect(at(19)).toEqual({ nodes: ['ORDER'], edges: [] });
  });

  test('class: bodies, relations, member rows do not steal declarations', async () => {
    const { ir, lineText } = await mapOf(sample('class'));
    expect(lineText('Money')).toBe('class Money {');
    expect(lineText(ir.edges.find((e) => e.from === 'Card')!.id)).toBe('PaymentMethod <|.. Card');
    const notes = await mapOf('classDiagram\n  class A\n  note for A "hello"');
    const note = notes.ir.nodes.find((n) => n.shape === 'note')!;
    expect(notes.map.lineOf.get(note.id)).toBe(3);
  });

  test('architecture-beta: services, groups, side-annotated edges', async () => {
    const { ir, lineText, at } = await mapOf(sample('architecture-beta'));
    expect(lineText('db')).toBe('service db(database)[Postgres] in data');
    expect(lineText('data')).toBe('group data(database)[Data tier] in api');
    expect(ir.edges.map((e) => lineText(e.id))).toEqual([
      'cdn:R --> L:lb',
      'lb:R --> L:app',
      'app:R -- L:fanout',
      'fanout:T --> B:worker',
      'fanout:B --> T:db',
      'worker:R --> L:files',
    ]);
    expect(at(4)?.nodes).toEqual(['db', 'files']);
  });

  test('frontmatter and comments keep line numbers', async () => {
    const { lineText } = await mapOf('---\ntitle: T\n---\nflowchart LR\n  %% A --> B\n  A --> B');
    expect(lineText('A')).toBe('A --> B');
  });
});
