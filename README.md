# mermaid-archify

Archify-style interactive diagrams from Mermaid source. Write Mermaid on the
left; get an explorable diagram on the right, with typed components, focus and
upstream/downstream details, a finder, a route probe, trace playback, a
minimap, dark/light themes, and exports (standalone interactive HTML, SVG, PNG).

Supported input: `flowchart`/`graph`, `sequenceDiagram`, `stateDiagram-v2`,
`architecture-beta`.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (parsers, layout invariants, graph logic)
npm run e2e        # Playwright against a production build (uses installed Chrome)
npm run build
```

## How it works

```
Mermaid text ─parse─▶ DiagramIR ─layout─▶ Scene ─render─▶ Viewer
```

- **Parse** (`src/parse/`): Mermaid's own parser (pinned `mermaid@12.0.0`);
  each adapter reads the diagram's `db` into a syntax-neutral IR
  (Intermediate Representation).
- **Classify** (`src/ir/classify.ts`): nodes get an Archify type:
  `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus` or `external`.
  Rules apply in this order: explicit class (`A:::database`, `class A queue`),
  then architecture icon, then flowchart shape (`[( )]` is a database), then
  label keywords. State diagrams colour states by outcome (failure, success,
  waiting, in progress).
- **Layout** (`src/layout/`): ELK layered layout in a Web Worker for graphs;
  a deterministic column/row layout for sequence diagrams. Text is measured
  arithmetically (monospace font), so layout is identical in tests and browsers.
- **Viewer** (`src/viewer/`): consumes only the positioned Scene, so exported
  HTML embeds the Scene plus a ~70 KB runtime, with no Mermaid or ELK.

### Viewer controls

| Action | How |
|---|---|
| Pan / zoom | drag or scroll · ⌘/Ctrl+scroll or pinch · `+` `-` `0` (fit) |
| Focus a node | click (details panel lists upstream/downstream) |
| Find | `/` or ⌘K |
| Route probe | shift-click two nodes (directed shortest path) |
| Pin an edge | click it |
| Trace | `T` or the trace button |
| Clear | `Esc` |

Share links (`#src=…&focus=…`) carry the source compressed in the URL.

Palette and interaction model are adapted from
[Archify](https://github.com/tt-a1i/archify) (MIT).
