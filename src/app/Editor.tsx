import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { type Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
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
  '.cm-tooltip': { backgroundColor: 'var(--toolbar-menu-bg)', border: '1px solid var(--toolbar-border)', color: 'var(--text)' },
});

export interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 1-based line of the current parse error, if any. */
  errorLine?: number;
  errorMessage?: string;
}

export function Editor({ value, onChange, errorLine, errorMessage }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
          mermaidLanguage,
          mermaidHighlight,
          theme,
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': 'Mermaid source' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
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

  return <div ref={host} class="editor-host" />;
}
