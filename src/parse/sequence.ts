import { classify, typed } from '../ir/classify';
import { parseStyle } from '../ir/style';
import type { DiagramIR, IREdge, IRGroup, IRNode, SemanticType, SeqArrow, SeqBlockType, SeqEvent } from '../ir/types';
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

  // `box Aqua Front end … end`: a band around its participants.
  const groups: IRGroup[] = [];
  const boxOf = new Map<string, string>();
  (db.getBoxes?.() ?? []).forEach((b: { name?: string; fill?: string; actorKeys?: string[] }, i: number) => {
    const id = `box${i + 1}`;
    const style = b.fill && b.fill !== 'transparent' ? parseStyle([`fill:${b.fill}`]) : undefined;
    groups.push({ id, label: cleanLabel(b.name ?? ''), hint: 'box', ...(style && { style }) });
    for (const key of b.actorKeys ?? []) boxOf.set(key, id);
  });

  const nodes: IRNode[] = [];
  for (const a of db.getActors().values()) {
    const label = cleanLabel(a.description) || a.name;
    const pType: string = a.type ?? 'participant';
    nodes.push({
      id: a.name,
      label,
      shape: pType === 'actor' ? 'actor' : 'participant',
      ...(PARTICIPANT_TYPES[pType] ? { type: PARTICIPANT_TYPES[pType], certainty: 'explicit' as const } : typed(classify({ label, id: a.name }))),
      parent: boxOf.get(a.name),
      classes: [],
      hint: pType,
    });
  }
  // Mermaid keys `create`/`destroy` by the index of the message that follows them.
  const created = new Map<number, string>([...(db.getCreatedActors?.() ?? new Map())].map(([actor, i]) => [i, actor]));
  const destroyed = new Map<number, string>([...(db.getDestroyedActors?.() ?? new Map())].map(([actor, i]) => [i, actor]));
  /** `autonumber [start [step]]` / `autonumber off`, as Mermaid's renderer counts. */
  const numbering = { on: false, n: 1, step: 1 };

  const events: SeqEvent[] = [];
  const edges: IREdge[] = [];
  let block = 0;
  const open: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.getMessages().forEach((m: { from?: string; to?: string; message?: any; type: number; placement?: number }, i: number) => {
    const name = lineType[m.type] ?? '';
    if (name === 'AUTONUMBER') {
      numbering.n = m.message?.start || numbering.n;
      numbering.step = m.message?.step || numbering.step;
      numbering.on = !!m.message?.visible;
      return;
    }
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
    } else if (m.from && m.to) {
      // Half arrows (`-|\`, `/|-`, …): STICK heads are line heads; *_REVERSE ones point back at the sender.
      const arrow: SeqArrow = name.includes('CROSS')
        ? 'cross'
        : name.includes('POINT') || name.startsWith('STICK')
          ? 'async'
          : name.includes('OPEN')
            ? 'open'
            : 'arrow';
      const reverse = name.includes('_REVERSE') && !name.startsWith('CENTRAL');
      const [from, to] = reverse ? [m.to, m.from] : [m.from, m.to];
      const id = `m${edges.length}`;
      const stroke = name.includes('DOTTED') ? 'dotted' : 'solid';
      const bidirectional = name.startsWith('BIDIRECTIONAL') || name === 'CENTRAL_CONNECTION_DUAL';
      const label = numbering.on ? `${numbering.n}${text ? ` ${text}` : ''}` : text;
      numbering.n = Math.round((numbering.n + numbering.step) * 100) / 100;
      const creates = created.get(i);
      const destroys = destroyed.get(i);
      events.push({ kind: 'message', id, from, to, label, stroke, arrow, bidirectional, ...(creates && { creates }), ...(destroys && { destroys }) });
      edges.push({
        id,
        from,
        to,
        label: label || undefined,
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
    groups,
    events,
  };
}
