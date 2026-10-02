# mermaid-archify

Archify-style interactive diagrams from Mermaid source. Write Mermaid on the
left; get an explorable diagram on the right, with typed components, focus and
upstream/downstream details, a finder, a route probe, trace playback, a
minimap, dark/light themes, and exports (standalone interactive HTML, SVG, PNG).

Live: **https://mermaid-archify.pages.dev**

Supported input: `flowchart`/`graph`, `sequenceDiagram`, `stateDiagram-v2`,
`erDiagram`, `classDiagram`, `architecture-beta`.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + corpus tests
npm run e2e        # every browser test against a production build (uses installed Chrome)
npm run build
```

## CLI and library

The same pipeline runs headlessly in Node (22+), for docs builds, CI jobs and
pre-commit hooks. Output is identical to the app's **Interactive HTML** and
**SVG** exports.

```bash
npx mermaid-archify diagram.mmd -o diagram.html               # standalone interactive HTML
npx mermaid-archify diagram.mmd -o diagram.svg --theme light  # SVG, light palette baked in
npx mermaid-archify "docs/**/*.mmd" --out-dir build/diagrams  # batch: build/diagrams/<path below docs/>.html
npx mermaid-archify "docs/**/*.mmd" -f svg                    # batch: an .svg next to each input
cat diagram.mmd | npx mermaid-archify - -f svg -o - > out.svg # stdin → stdout
```

| Option | |
|---|---|
| `-o, --out <file\|->` | Output file for a single input; its extension picks the format. `-` is stdout. |
| `-d, --out-dir <dir>` | Write every output here, mirroring each input's path below its glob. |
| `-f, --format html\|svg` | Format when `-o` doesn't name one (default `html`). |
| `-t, --theme dark\|light` | Palette (default `dark`). |
| `--direction LR\|RL\|TB\|BT` | Override the diagram direction. |
| `-q, --quiet` | Don't list written files. |

Without `-o` or `--out-dir`, each output goes next to its input. Quote globs so
every shell passes them through unchanged. Layout settings in the source's
front-matter (`config.archify`) apply, as in the app. Exit codes: `0` ok, `1`
a diagram failed (reported as `file:line: message`, and the rest of the batch
still renders), `2` usage error. PNG is not produced headlessly: export SVG, or
use the app's PNG export.

```ts
import { render, MermaidParseError } from 'mermaid-archify';

const { html, svg, scene } = await render(source, { theme: 'dark' });
// Optional layout overrides, on top of the front-matter:
await render(source, { layout: { direction: 'TB', routing: 'splines' } });
// Invalid input rejects with MermaidParseError (err.line is 1-based).
```

The library needs a DOM for Mermaid's parser and installs a
[happy-dom](https://github.com/capricorn86/happy-dom) window on `globalThis`
when none exists (an existing DOM, such as jsdom, is used as is). ELK runs
in-process. Build it with `npm run build:lib` (output in `dist-node/`).

## Embedding in docs sites

`<mermaid-archify>` puts an interactive diagram in any page, and remark and
markdown-it plugins turn ```` ```mermaid ```` blocks into it at build time, so
pages ship only the ≈90 KB viewer, not Mermaid or ELK. Recipes for
Docusaurus, VitePress and MkDocs: [docs/embedding.md](docs/embedding.md).

```html
<script type="module" src="mermaid-archify.js"></script>  <!-- dist-element/, or import 'mermaid-archify/element' -->
<mermaid-archify src="diagram.mmd" height="420"></mermaid-archify>
<mermaid-archify scene="diagram.json" theme="light" controls="false"></mermaid-archify>
```

```js
import remarkMermaidArchify from 'mermaid-archify/remark';           // Docusaurus, Astro, unified
import markdownItMermaidArchify from 'mermaid-archify/markdown-it';  // VitePress, Eleventy
```

Each diagram is isolated in shadow DOM, follows the page's theme
(`<html data-theme>`, `<html class="dark">` or the OS), takes keyboard
shortcuts only while focused, and renders only when scrolled near. `npm run
build:lib` builds the element into `dist-element/`; `embed.html` shows several
on one page.

## Testing

The suite is built around a **corpus of 358 real Mermaid diagrams** taken
verbatim from Mermaid's own documentation and demo pages (`test/corpus/`, MIT,
see `SOURCE.md` there). It covers every example of the six supported types,
including the large, CJK, KaTeX and expanded-shape stress cases.

| Layer | What it proves |
|---|---|
| `test/corpus.test.ts` | Every fixture parses, lays out, and passes the scene invariants; a structural snapshot of what was extracted (nodes, edges, groups, types) makes any Mermaid upgrade a reviewable diff. |
| `test/helpers/invariants.ts` | Geometry and content rules: finite and in-bounds, no overlapping nodes or sibling groups, children inside groups, edges attached to their nodes, labels on their own edge and clear of nodes and other labels, text fits its box, no leaked markup. For sequences: ordered rows, messages on lifelines, blocks enclosing their content. |
| `test/invariants.test.ts` | Mutation tests: the invariant checker rejects each kind of defect it claims to catch. |
| `test/{parse,layout,graph}.test.ts` | Focused unit tests for parsers, layout rules and viewer graph logic. |
| `e2e/corpus.spec.ts` | Every fixture rendered by the real app in Chrome with real fonts: rendered text fits its shapes and label masks, no `NaN` geometry, no console errors, diagram fits the viewport. |
| `e2e/visual.spec.ts` | Pixel baselines for 22 curated diagrams in both themes (`e2e/visual.spec.ts-snapshots/`, macOS; skipped on CI). |
| `e2e/app.spec.ts` | App flows: editing and errors, focus, finder, theme, share links, HTML/SVG/PNG export, offline export. |
| `e2e/cli.spec.ts` | The CLI's HTML (byte-identical) and SVG match the app's exports for one diagram of each kind; batch globs, `file:line` errors, exit codes. |
| `test/node.test.ts` | `render()` in plain Node, and CLI input/output path handling. |
| `e2e/embed.spec.ts` | `embed.html`: several elements under hostile host CSS stay isolated (styles, keyboard, wheel), follow the host theme, render lazily; pages built with the remark and markdown-it plugins load only the viewer. |
| `test/plugins.test.ts` | The Markdown plugins' output: HTML, MDX and Vue-safe markup, escaping, per-block options, `file:line` errors. |

Fixtures Mermaid itself rejects are listed in `test/corpus/invalid.json` and
must fail cleanly with a line number.

Useful loops:

```bash
npm run corpus:fetch                        # refresh the corpus from Mermaid's repo
SHOTS=1 npm run e2e:corpus && npm run corpus:sheets   # screenshot every fixture → test-results/sheets/
npm run e2e:visual -- --update-snapshots    # re-record baselines after an intended visual change
npx vitest run -u                           # accept intended corpus snapshot changes (review the diff!)
```

## Deployment

The app is a static site on Cloudflare Pages (project `mermaid-archify`,
Direct Upload from GitHub Actions; no Workers). In `.github/workflows/ci.yml`
the `deploy` job runs only after the `test` job passes, and ships the `dist/`
those tests exercised:

- push to `main` → production, https://mermaid-archify.pages.dev
- same-repo PR #n → preview, https://pr-n.mermaid-archify.pages.dev, linked
  in a PR comment that updates on every push

`.github/workflows/pages-cleanup.yml` deletes every deployment of a PR's
`pr-<n>` branch when the PR closes, then checks that none are left. A daily sweep
(also runnable by hand) deletes previews of any PR that is no longer open.
Both use `scripts/pages-cleanup.mjs`. The repo secrets they need are
`CLOUDFLARE_API_TOKEN` (Account → Cloudflare Pages → Edit) and
`CLOUDFLARE_ACCOUNT_ID`.

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
  waiting, in progress). ER entities are data stores; class diagrams stay
  plain unless an explicit class (`class A:::queue`) names a type.
- **Layout** (`src/layout/`): ELK layered layout in a Web Worker for graphs;
  a deterministic column/row layout for sequence diagrams. Text is measured
  arithmetically (monospace font), so layout is identical in tests and browsers.
- **Viewer** (`src/viewer/`): consumes only the positioned Scene, so exported
  HTML embeds the Scene plus a ~75 KB runtime, with no Mermaid or ELK.

**Font Awesome icons** (`A[fa:fa-car Car]`, also `fab:`/`far:`/`fas:` and old
FA4 names like `fa-cogs`) render inline in flowchart node, edge and subgraph
labels, as in Mermaid. The icon table is built from Font Awesome Free at build
time and loaded only when a diagram uses icons; exported HTML embeds just the
icons it uses. Icons © Fonticons, Inc., CC BY 4.0 (https://fontawesome.com/license/free).
Like Mermaid, other diagram types ignore `fa:` tokens.

Known gaps: KaTeX (`$$…$$`) labels show their LaTeX source.
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

