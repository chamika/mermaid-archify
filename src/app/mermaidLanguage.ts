import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const HEADERS = /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|stateDiagram|erDiagram|classDiagram-v2|classDiagram|architecture-beta)\b/;
const KEYWORDS =
  /^(subgraph|end|direction|class|classDef|style|linkStyle|click|participant|actor|loop|alt|else|opt|par|and|critical|option|break|rect|note|over|left of|right of|activate|deactivate|autonumber|title|state|as|group|service|junction|in|box|namespace|for|PK|FK|UK)\b/i;
const ARROW = /^(<?[-=.]+(>>|>|x|o|\)|-)?|<-->|--[ox>]|-\)|--\)|-x|--x|->>|-->>|->|-->)/;

/** Small stream tokenizer: enough to colour Mermaid source, not to validate it. */
export const mermaidLanguage = StreamLanguage.define<{ fm: boolean }>({
  startState: () => ({ fm: false }),
  token(stream, state) {
    if (stream.sol() && stream.match(/^\s*---\s*$/)) {
      state.fm = !state.fm;
      return 'meta';
    }
    if (state.fm) {
      stream.skipToEnd();
      return 'meta';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(HEADERS)) return 'heading';
    // ER cardinalities (`||--o{`, `}|..|{`) and class relations (`<|--`, `*--`, `o--`, `..>`).
    if (stream.match(/^[|}][|o][-.]{2}[o|][|{]/)) return 'operator';
    if (stream.match(/^(<\||\*|o)?(--|\.\.)(\|>|\*|o|>)?(?=\s|$|")/)) return 'operator';
    if (stream.match(/^"[^"]*"?/)) return 'string';
    if (stream.match(/^\|[^|]*\|?/)) return 'string';
    if (stream.match(/^:::\w+/)) return 'typeName';
    if (stream.match(/^<<[^>]*>>/)) return 'typeName';
    if (stream.match(/^\[\*\]/)) return 'atom';
    if (stream.match(/^:[LRTB]\b/) || stream.match(/^[LRTB]:/)) return 'atom';
    if (stream.match(/^:.*$/)) return 'string';
    if (stream.match(KEYWORDS)) return 'keyword';
    if (stream.match(/^\b(LR|RL|TB|TD|BT)\b/)) return 'atom';
    if (stream.match(ARROW)) return 'operator';
    if (stream.match(/^[[\](){}<>]+/)) return 'bracket';
    if (stream.match(/^[\w.$-]+/)) return 'variableName';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '%%' } },
});

export const mermaidHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, color: 'var(--frontend-stroke)', fontWeight: '700' },
    { tag: t.keyword, color: 'var(--database-stroke)' },
    { tag: t.string, color: 'var(--backend-stroke)' },
    { tag: t.operator, color: 'var(--messagebus-stroke)' },
    { tag: t.comment, color: 'var(--text-dim)', fontStyle: 'italic' },
    { tag: t.meta, color: 'var(--text-muted)' },
    { tag: t.atom, color: 'var(--cloud-stroke)' },
    { tag: t.typeName, color: 'var(--security-stroke)' },
    { tag: t.bracket, color: 'var(--text-muted)' },
  ]),
);
