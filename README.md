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
npm test           # unit + corpus tests
npm run e2e        # every browser test against a production build (uses installed Chrome)
npm run build
```

## Testing

The suite is built around a **corpus of 268 real Mermaid diagrams** taken
verbatim from Mermaid's own documentation and demo pages (`test/corpus/`, MIT,
see `SOURCE.md` there). It covers every example of the four supported types,
including the large, CJK, KaTeX and expanded-shape stress cases.

| Layer | What it proves |
|---|---|
| `test/corpus.test.ts` | Every fixture parses, lays out, and passes the scene invariants; a structural snapshot of what was extracted (nodes, edges, groups, types) makes any Mermaid upgrade a reviewable diff. |
| `test/helpers/invariants.ts` | Geometry and content rules: finite and in-bounds, no overlapping nodes or sibling groups, children inside groups, edges attached to their nodes, labels on their own edge and clear of nodes and other labels, text fits its box, no leaked markup. For sequences: ordered rows, messages on lifelines, blocks enclosing their content. |
| `test/invariants.test.ts` | Mutation tests: the invariant checker rejects each kind of defect it claims to catch. |
| `test/{parse,layout,graph}.test.ts` | Focused unit tests for parsers, layout rules and viewer graph logic. |
| `e2e/corpus.spec.ts` | Every fixture rendered by the real app in Chrome with real fonts: rendered text fits its shapes and label masks, no `NaN` geometry, no console errors, diagram fits the viewport. |
| `e2e/visual.spec.ts` | Pixel baselines for 16 curated diagrams in both themes (`e2e/visual.spec.ts-snapshots/`, macOS; skipped on CI). |
| `e2e/app.spec.ts` | App flows: editing and errors, focus, finder, theme, share links, HTML/SVG/PNG export, offline export. |

Fixtures Mermaid itself rejects are listed in `test/corpus/invalid.json` and
must fail cleanly with a line number.

Useful loops:

```bash
npm run corpus:fetch                        # refresh the corpus from Mermaid's repo
SHOTS=1 npm run e2e:corpus && npm run corpus:sheets   # screenshot every fixture → test-results/sheets/
npm run e2e:visual -- --update-snapshots    # re-record baselines after an intended visual change
npx vitest run -u                           # accept intended corpus snapshot changes (review the diff!)
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

Known gaps: KaTeX (`$$…$$`) labels show their LaTeX source, and Font Awesome
`fa:` icons are dropped (as Mermaid does when Font Awesome isn't loaded).
Mermaid's 40+ expanded node shapes are mapped onto shape families (storage,
document, in/out, manual, note, text) rather than drawn individually.

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
