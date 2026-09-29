import type { DiagramIR } from '../ir/types';
import { hasIcons, iconKeys, removeIcon } from '../icons/fa';
import { resolveIcons } from '../icons/resolve';
import { settleTypes } from '../ir/classify';
import { architectureToIR } from './architecture';
import { flowchartToIR } from './flowchart';
import { sequenceToIR } from './sequence';
import { stateToIR } from './state';
import { prepareSource } from './text';

export class MermaidParseError extends Error {
  constructor(
    message: string,
    /** 1-based line in the source, when Mermaid reports one. */
    readonly line?: number,
  ) {
    super(message);
    this.name = 'MermaidParseError';
  }
}

type MermaidModule = typeof import('mermaid')['default'];
let mermaidPromise: Promise<MermaidModule> | undefined;

function loadMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= import('mermaid').then(({ default: m }) => {
    m.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return m;
  });
  return mermaidPromise;
}

const SUPPORTED = 'flowchart, graph, sequenceDiagram, stateDiagram-v2, architecture-beta';

export async function parseMermaid(text: string): Promise<DiagramIR> {
  if (!text.trim()) throw new MermaidParseError('The diagram is empty.');
  const mermaid = await loadMermaid();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let diagram: any;
  const prepared = prepareSource(text);
  try {
    diagram = await mermaid.mermaidAPI.getDiagramFromText(prepared);
  } catch (err) {
    const e = toParseError(err);
    // Mermaid trims leading blank lines (including our blanked frontmatter).
    if (e.line !== undefined) throw new MermaidParseError(e.message, e.line + leadingBlankLines(prepared));
    throw e;
  }
  const ir = toIR(diagram.type, diagram.db);
  if (ir.kind !== 'state') settleTypes(ir.nodes);
  await attachIcons(ir);
  ir.title ??= frontmatterTitle(text);
  return ir;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toIR(type: string, db: any): DiagramIR {
  switch (type) {
    case 'flowchart-v2':
    case 'flowchart':
    case 'flowchart-elk':
      return flowchartToIR(db);
    case 'sequence':
      return sequenceToIR(db);
    case 'stateDiagram':
    case 'state':
      return stateToIR(db);
    case 'architecture':
      return architectureToIR(db);
    default:
      throw new MermaidParseError(`"${type}" diagrams are not supported yet. Supported: ${SUPPORTED}.`, 1);
  }
}

/** Resolve every icon the labels use; icons Font Awesome Free lacks are removed from the text. */
async function attachIcons(ir: DiagramIR): Promise<void> {
  const labelled: { label?: string }[] = [...ir.nodes, ...ir.edges, ...ir.groups];
  const keys = labelled.flatMap((x) => (x.label && hasIcons(x.label) ? iconKeys(x.label) : []));
  if (!keys.length) return;
  const icons = await resolveIcons(keys);
  for (const x of labelled) {
    if (!x.label || !hasIcons(x.label)) continue;
    for (const key of iconKeys(x.label)) if (!icons[key]) x.label = removeIcon(x.label, key);
  }
  if (Object.keys(icons).length) ir.icons = icons;
}

function frontmatterTitle(text: string): string | undefined {
  const fm = /^\s*---\s*\n([\s\S]*?)\n\s*---/.exec(text);
  const title = fm && /^title:\s*(.+)$/m.exec(fm[1]);
  return title ? title[1].trim().replace(/^(["'])(.*)\1$/, '$2') : undefined;
}

function toParseError(err: unknown): MermaidParseError {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const message: string = e?.message ?? String(err);
  let line: number | undefined = e?.hash?.loc?.first_line ?? e?.hash?.line;
  if (line === undefined) {
    const m = /line (\d+)/i.exec(message);
    if (m) line = Number(m[1]);
  }
  if (/No diagram type detected/i.test(message)) {
    return new MermaidParseError(`Unrecognized diagram header. Supported: ${SUPPORTED}.`, 1);
  }
  return new MermaidParseError(summarize(message), line);
}

/** Turn a jison dump ("...^\nExpecting 'A', 'B', got 'EOF'") into one readable line. */
function summarize(message: string): string {
  const got = /Expecting (.+), got '([^']+)'/.exec(message);
  if (got) {
    const expected = [...got[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase().replace(/_/g, ' '));
    const found = got[2] === 'EOF' ? 'end of input' : got[2] === 'NEWLINE' ? 'end of line' : `"${got[2].toLowerCase()}"`;
    const hint = expected.length <= 4 ? ` (expected ${expected.join(', ')})` : '';
    return `Unexpected ${found}${hint}`;
  }
  return message.replace(/^Parse error on line \d+:\s*/i, '').trim();
}

function leadingBlankLines(text: string): number {
  const lead = /^(?:[ \t]*\r?\n)*/.exec(text)![0];
  return (lead.match(/\n/g) ?? []).length;
}
