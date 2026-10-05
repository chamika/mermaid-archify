# mermaid-archify

Archify-style interactive diagrams from Mermaid source: a Vite + Preact app
(live at https://mermaid-archify.pages.dev), a Node CLI/library
(`dist-node/`), and a `<mermaid-archify>` web component with remark and
markdown-it plugins. README.md covers the user-facing surface; this file
covers how to work on it.

## Relationship to the archify skill

The visual language comes from Archify (MIT, tt-a1i/archify); a copy of that
skill is installed at `~/.claude/skills/archify`. Only the palette was ported
(`src/viewer/tokens.css`, the "classic" preset). The parser, layout, scene and
viewer are this repo's own code and import nothing from the skill. Open the
skill only to compare against a specific Archify behaviour or token, not to
learn this codebase.

## Pipeline

Source flows one way: `src/parse/` (one file per diagram type, on top of
Mermaid's parser) → `src/ir/` (classify components, styles) → `src/layout/`
(ELK, plus `sequence.ts` for sequence diagrams; `settings.ts` reads
`config.archify` front-matter; `pins.ts` holds dragged positions) →
`src/scene/types.ts` (the serialisable scene) → `src/viewer/` (renders a
scene, shared by the app, standalone HTML export and the web component).
`src/export/` does HTML/SVG/PNG; `src/node/` is the CLI/library entry.

## Commands

```bash
npm test            # vitest: unit + corpus (test/corpus/ fixtures, invariants in test/helpers/)
npm run typecheck
npm run build       # tsc + app build + build:lib; this is what CI runs first
npm run e2e         # Playwright against a production build on :4174, uses installed Chrome
npm run corpus:sheets   # contact-sheet PNGs of the corpus for visual review
```

- `npm run dev` serves on 5173; e2e uses its own preview server on 4174
  (`strictPort`), so the two do not collide.
- Pixel baselines in `e2e/visual.spec.ts-snapshots/` are macOS-only. CI runs
  with `ignoreSnapshots`. If a change is meant to alter visuals, update them
  locally with `npx playwright test e2e/visual.spec.ts --update-snapshots`
  and say so in the PR.
- When the user wants to review rendering changes, produce PNGs they can
  look at (contact sheets or Playwright screenshots) rather than describing
  them.

## Workflow

- Work is tracked as GitHub issues on chamika/mermaid-archify. "Do #N" or
  "plan #N" means: read the issue with `gh issue view N`, and do the work in
  a fresh worktree per the project memory (`../mermaid-archify-<slug>`,
  branch `feat/<slug>` off `origin/main`, upstream unset before pushing).
- Land changes with the `ship` skill. CI (`.github/workflows/ci.yml`) runs
  build → `npm test` → Playwright, then deploys: `main` to
  mermaid-archify.pages.dev and PR #n to `https://pr-n.mermaid-archify.pages.dev`
  (link posted as a PR comment). `pages-cleanup.yml` deletes a PR's
  deployments when it closes, plus a daily sweep. Deleting them is
  required, not optional.
- When a feature is done, end with a short list of concrete Mermaid snippets
  the user can paste into the app to exercise it, including the edge cases.
  They ask for this every time.
