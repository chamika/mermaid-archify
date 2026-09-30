import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { type Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { Annotation, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'preact/hooks';
import { mermaidHighlight, mermaidLanguage } from './mermaidLanguage';

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent', fontSize: '13px' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--arrow-emphasis)', padding: '12px 0' },
  '.cm-cursor': { borderLeftColor: 'var(--arrow-emphasis)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-dim)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--grid) 45%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--frontend-stroke) 28%, transparent) !important',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--security-stroke)' },
  '.cm-linkedLine': { backgroundColor: 'color-mix(in srgb, var(--arrow-emphasis) 20%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--toolbar-menu-bg)', border: '1px solid var(--toolbar-border)', color: 'var(--text)' },
});

/** Marks selection changes made for the diagram, so they are not reported back as cursor moves. */
const fromDiagram = Annotation.define<boolean>();
const setLinked = StateEffect.define<number | null>();
const linkedMark = Decoration.line({ class: 'cm-linkedLine' });

/** The line a diagram click revealed; cleared by the next edit or cursor move. */
const linkedLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setLinked)) return e.value ? Decoration.set([linkedMark.range(tr.state.doc.line(e.value).from)]) : Decoration.none;
    }
    return tr.docChanged || (tr.selection && !tr.annotation(fromDiagram)) ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 1-based line of the current parse error, if any. */
  errorLine?: number;
  errorMessage?: string;
  /** Reports the 1-based cursor line whenever the user moves the cursor or edits. */
  onCursorLine?: (line: number) => void;
  /** Line to reveal and highlight (a new object each time, so the same line can be revealed again). */
  reveal?: { line: number };
}

export function Editor({ value, onChange, errorLine, errorMessage, onCursorLine, reveal }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorRef = useRef(onCursorLine);
  onCursorRef.current = onCursorLine;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          lintGutter(),
          linkedLine,
          mermaidLanguage,
          mermaidHighlight,
          theme,
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': 'Mermaid source' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.selectionSet && !u.transactions.some((tr) => tr.annotation(fromDiagram))) {
              onCursorRef.current?.(u.state.doc.lineAt(u.state.selection.main.head).number);
            }
          }),
        ],
      }),
    });
    return () => view.current?.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // External value changes (sample picker, share link).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const diagnostics: Diagnostic[] = [];
    if (errorMessage && errorLine && errorLine <= v.state.doc.lines) {
      const line = v.state.doc.line(errorLine);
      diagnostics.push({ from: line.from, to: Math.max(line.to, line.from + 1), severity: 'error', message: errorMessage });
    }
    v.dispatch(setDiagnostics(v.state, diagnostics));
  }, [errorLine, errorMessage]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (!reveal || reveal.line > v.state.doc.lines) {
      v.dispatch({ effects: setLinked.of(null) });
      return;
    }
    const line = v.state.doc.line(reveal.line);
    v.dispatch({
      selection: { anchor: line.from },
      effects: [setLinked.of(reveal.line), EditorView.scrollIntoView(line.from, { y: 'center' })],
      annotations: fromDiagram.of(true),
    });
  }, [reveal]);

  return <div ref={host} class="editor-host" />;
}
