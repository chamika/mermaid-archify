import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { imageExports } from '../export/actions';
import { download, slug } from '../export/download';
import { buildStandaloneHtml } from '../export/html';
import { layout } from '../layout';
import { browserElk } from '../layout/elk';
import { type LayoutSettings, readLayoutSettings, writeLayoutSettings } from '../layout/settings';
import { MermaidParseError, parseMermaid } from '../parse';
import { SAMPLES } from '../samples';
import type { Scene } from '../scene/types';
import { type ExportAction, Viewer } from '../viewer/Viewer';
import { Editor } from './Editor';
import { LayoutControls } from './LayoutControls';
import { loadLinking, loadSaved, readHash, save, saveLinking, shareUrl } from './share';
import { buildSourceMap } from './sourceMap';

interface Problem {
  message: string;
  line?: number;
}

const initial = readHash();

export function App() {
  const [source, setSource] = useState(() => initial.src ?? loadSaved() ?? SAMPLES[0].source);
  const [scene, setScene] = useState<Scene>();
  /** The source `scene` was built from; lags `source` while an edit is being laid out. */
  const [sceneSource, setSceneSource] = useState<string>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [split, setSplit] = useState(36);
  const [editorOpen, setEditorOpen] = useState(true);
  const [notice, setNotice] = useState<string>();
  const [linking, setLinking] = useState(loadLinking);
  const [cursorLine, setCursorLine] = useState<number>();
  const [reveal, setReveal] = useState<{ line: number }>();
  const focusRef = useRef<string | undefined>(initial.focus);
  const run = useRef(0);

  // parse → layout, debounced; stale results are dropped.
  useEffect(() => {
    const ticket = ++run.current;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const ir = await parseMermaid(source);
        const next = await layout(ir, browserElk(), readLayoutSettings(source));
        if (ticket !== run.current) return;
        setScene(next);
        setSceneSource(source);
        setProblem(undefined);
      } catch (err) {
        if (ticket !== run.current) return;
        setProblem(
          err instanceof MermaidParseError
            ? { message: err.message, line: err.line }
            : { message: `Layout failed: ${(err as Error).message ?? String(err)}` },
        );
      } finally {
        if (ticket === run.current) setBusy(false);
      }
    }, 300);
    save(source);
    return () => window.clearTimeout(timer);
  }, [source]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((m) => (m === msg ? undefined : m)), 2400);
  };

  const copyShare = async () => {
    const url = shareUrl(source, focusRef.current);
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      flash('Share link copied');
    } catch {
      flash('Share link is in the address bar');
    }
  };

  const exportsList = useMemo<ExportAction[]>(
    () => [
      {
        id: 'html',
        label: 'Interactive HTML',
        run: async ({ scene: s }) => {
          const { default: viewerJs } = await import('virtual:viewer-bundle');
          const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
          download(buildStandaloneHtml(s, source, viewerJs, theme), `${slug(s.title, s.kind)}.html`, 'text/html');
        },
      },
      ...imageExports,
      {
        id: 'mmd',
        label: 'Mermaid source (.mmd)',
        run: ({ scene: s }) => download(source, `${slug(s.title, s.kind)}.mmd`),
      },
    ],
    [source],
  );

  const layoutSettings = useMemo(() => readLayoutSettings(source), [source]);
  const changeLayout = (next: LayoutSettings) => {
    const written = writeLayoutSettings(source, next);
    if (written === undefined) flash('Front-matter uses {…} style; edit config.archify by hand');
    else setSource(written);
  };

  // Two-way linking, only while the map matches the text in the editor.
  const linkActive = linking && editorOpen;
  const sourceMap = useMemo(
    () => (linkActive && scene && sceneSource === source ? buildSourceMap(source, scene) : undefined),
    [linkActive, scene, sceneSource, source],
  );
  const linked = cursorLine === undefined ? undefined : sourceMap?.atLine.get(cursorLine);

  const revealDefinition = useCallback(
    (id: string) => {
      const line = sourceMap?.lineOf.get(id);
      if (!line) return;
      setCursorLine(undefined);
      setReveal({ line });
    },
    [sourceMap],
  );

  const onFocusChange = useCallback(
    (id: string | undefined) => {
      focusRef.current = id;
      if (id) revealDefinition(id);
    },
    [revealDefinition],
  );

  const toggleLinking = () => {
    const next = !linking;
    setLinking(next);
    saveLinking(next);
    if (!next) {
      setCursorLine(undefined);
      setReveal(undefined);
    }
  };

  // Split-pane drag.
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      setSplit(Math.min(70, Math.max(18, (e.clientX / window.innerWidth) * 100)));
    };
    const up = () => {
      dragging.current = false;
      document.body.classList.remove('resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const sampleId = SAMPLES.find((s) => s.source === source)?.id ?? '';

  return (
    <div class="app" style={{ '--split': `${split}%` }}>
      <header class="topbar">
        <div class="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="7" height="6" rx="1.5" />
            <rect x="14" y="14" width="7" height="6" rx="1.5" />
            <path d="M10 7h3a2 2 0 0 1 2 2v5" />
          </svg>
          mermaid<span>·archify</span>
        </div>
        <button class="tb-btn" aria-pressed={editorOpen} onClick={() => setEditorOpen((v) => !v)} title="Show or hide the editor">
          {editorOpen ? 'Hide code' : 'Show code'}
        </button>
        <button
          class="tb-btn toggle"
          aria-pressed={linkActive}
          disabled={!editorOpen}
          onClick={toggleLinking}
          title={
            editorOpen
              ? 'Link code and diagram: clicking an element reveals its line; the cursor line highlights its elements'
              : 'Show the code to link it with the diagram'
          }
        >
          Link code
        </button>
        <label class="sample">
          <span>Sample</span>
          <select
            value={sampleId}
            onChange={(e) => {
              const s = SAMPLES.find((x) => x.id === (e.target as HTMLSelectElement).value);
              if (s) {
                setSource(s.source);
                setCursorLine(undefined);
                setReveal(undefined);
              }
            }}
          >
            <option value="" disabled>
              Custom
            </option>
            {SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div class="spacer" />
        {busy && <span class="busy" aria-live="polite">Laying out…</span>}
        {notice && <span class="notice" role="status">{notice}</span>}
        <button class="tb-btn primary" onClick={copyShare}>
          Copy share link
        </button>
      </header>

      <main class={editorOpen ? 'panes' : 'panes code-hidden'}>
        {editorOpen && (
          <section class="editor-pane" aria-label="Mermaid editor">
            <Editor
              value={source}
              onChange={setSource}
              errorLine={problem?.line}
              errorMessage={problem?.message}
              onCursorLine={setCursorLine}
              reveal={linkActive ? reveal : undefined}
            />
            {problem && (
              <div class="problem" role="alert">
                <strong>{problem.line ? `Line ${problem.line}` : 'Error'}</strong>
                <span>{firstLine(problem.message)}</span>
                {scene && <em>Showing the last valid diagram.</em>}
              </div>
            )}
          </section>
        )}
        {editorOpen && (
          <div
            class="gutter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor"
            onPointerDown={() => {
              dragging.current = true;
              document.body.classList.add('resizing');
            }}
          />
        )}
        <section class="canvas-pane" aria-label="Diagram">
          {scene ? (
            <Viewer
              scene={scene}
              initialFocus={initial.focus}
              onFocusChange={onFocusChange}
              onEdgePin={revealDefinition}
              linked={linkActive ? linked : undefined}
              linkFor={(id) => shareUrl(source, id)}
              exports={exportsList}
              toolbarExtra={<LayoutControls settings={layoutSettings} onChange={changeLayout} disabled={scene.kind === 'sequence'} />}
            />
          ) : (
            <div class="empty">{problem ? 'Fix the error to render the diagram.' : 'Rendering…'}</div>
          )}
        </section>
      </main>
    </div>
  );
}

function firstLine(msg: string) {
  const lines = msg.split('\n').filter(Boolean);
  return lines.at(-1) ?? msg;
}
