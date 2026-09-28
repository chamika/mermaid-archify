import { classify } from '../ir/classify';
import type { DiagramIR, IREdge, IRNode, SemanticType, SeqArrow, SeqBlockType, SeqEvent } from '../ir/types';
import { cleanLabel } from './text';

const PARTICIPANT_TYPES: Record<string, SemanticType> = {
  database: 'database',
  queue: 'messagebus',
  collections: 'database',
  boundary: 'security',
  actor: 'frontend',
};

const BLOCK_START: Record<string, SeqBlockType> = {
  LOOP_START: 'loop',
  ALT_START: 'alt',
  OPT_START: 'opt',
  PAR_START: 'par',
  PAR_OVER_START: 'par',
  CRITICAL_START: 'critical',
  BREAK_START: 'break',
  RECT_START: 'rect',
};
const BLOCK_SECTION = new Set(['ALT_ELSE', 'PAR_AND', 'CRITICAL_OPTION']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sequenceToIR(db: any): DiagramIR {
  const lineType: Record<number, string> = {};
  for (const [name, value] of Object.entries(db.LINETYPE as Record<string, number>)) lineType[value] = name;
  const placement: Record<number, 'left' | 'right' | 'over'> = { 0: 'left', 1: 'right', 2: 'over' };

  const nodes: IRNode[] = [];
  for (const a of db.getActors().values()) {
    const label = cleanLabel(a.description) || a.name;
    const pType: string = a.type ?? 'participant';
    nodes.push({
      id: a.name,
      label,
      shape: pType === 'actor' ? 'actor' : 'participant',
      type: PARTICIPANT_TYPES[pType] ?? classify({ label, id: a.name }),
      classes: [],
      hint: pType,
    });
  }

  const events: SeqEvent[] = [];
  const edges: IREdge[] = [];
  let block = 0;
  const open: string[] = [];
  db.getMessages().forEach((m: { from?: string; to?: string; message?: string; type: number; placement?: number }, i: number) => {
    const name = lineType[m.type] ?? '';
    const text = cleanLabel(m.message);
    if (name === 'NOTE') {
      const over = m.from === m.to || !m.to ? [m.from!] : [m.from!, m.to!];
      events.push({ kind: 'note', id: `n${i}`, over, placement: placement[m.placement ?? 2], text });
    } else if (BLOCK_START[name]) {
      const id = `b${block++}`;
      open.push(id);
      events.push({ kind: 'blockStart', id, type: BLOCK_START[name], label: text });
    } else if (BLOCK_SECTION.has(name)) {
      events.push({ kind: 'blockSection', id: open.at(-1) ?? '', label: text });
    } else if (name.endsWith('_END') && name !== 'ACTIVE_END') {
      events.push({ kind: 'blockEnd', id: open.pop() ?? '' });
    } else if (name === 'ACTIVE_START') {
      events.push({ kind: 'activate', actor: m.from! });
    } else if (name === 'ACTIVE_END') {
      events.push({ kind: 'deactivate', actor: m.from! });
    } else if (m.from && m.to && name !== 'AUTONUMBER') {
      const arrow: SeqArrow = name.includes('CROSS')
        ? 'cross'
        : name.includes('POINT')
          ? 'async'
          : name.includes('OPEN')
            ? 'open'
            : 'arrow';
      const id = `m${edges.length}`;
      const stroke = name.includes('DOTTED') ? 'dotted' : 'solid';
      const bidirectional = name.startsWith('BIDIRECTIONAL');
      events.push({ kind: 'message', id, from: m.from, to: m.to, label: text, stroke, arrow, bidirectional });
      edges.push({
        id,
        from: m.from,
        to: m.to,
        label: text || undefined,
        stroke,
        arrowEnd: arrow !== 'open',
        arrowStart: bidirectional,
      });
    }
  });

  return {
    kind: 'sequence',
    title: db.getDiagramTitle?.() || undefined,
    direction: 'LR',
    nodes,
    edges,
    groups: [],
    events,
  };
}
