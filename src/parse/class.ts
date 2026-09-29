import { plainText } from '../icons/fa';
import { classify } from '../ir/classify';
import { type IRStyle, mergeStyles, parseStyle, safeLink } from '../ir/style';
import type { Compartment, CompartmentRow, DiagramIR, EdgeEnds, EndMark, IREdge, IRGroup, IRNode } from '../ir/types';
import { normalizeDirection } from './flowchart';
import { cleanLabel, decodeText } from './text';

/** Mermaid's `relationType` codes → end markers. */
const RELATION: Record<number, EndMark> = {
  0: 'aggregate',
  1: 'inherit',
  2: 'compose',
  3: 'open',
  4: 'lollipop',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function classToIR(db: Db): DiagramIR {
  const groups: IRGroup[] = [];
  const parentOf = new Map<string, string>();
  for (const [id, ns] of db.getNamespaces() as Map<string, Db>) {
    groups.push({ id, label: cleanLabel(ns.label) || id, parent: ns.parent });
    for (const c of ns.classes.keys()) parentOf.set(c, id);
    for (const n of ns.notes.keys()) parentOf.set(n, id);
  }

  const styleClasses: Map<string, { styles?: string[] }> = db.styleClasses ?? new Map();
  const classStyle = (c: string): IRStyle | undefined => parseStyle(styleClasses.get(c)?.styles);

  const nodes: IRNode[] = [];
  for (const c of (db.getClasses() as Map<string, Db>).values()) {
    // Mermaid tags every `click` target with `clickable`; it carries no meaning.
    const classes: string[] = String(c.cssClasses ?? '')
      .split(/\s+/)
      .filter((k) => k && k !== 'default' && k !== 'clickable');
    const explicit = classify({ label: '', id: '', classes });
    const annotation = c.annotations?.length ? decodeText(c.annotations[0]) : undefined;
    const members = rows(c.members ?? []);
    const methods = rows(c.methods ?? []);
    nodes.push({
      id: c.id,
      label: decodeText(c.text || c.label || c.id) || c.id,
      shape: 'compartment',
      // Class diagrams stay plain unless an explicit class names a component type.
      type: explicit.type,
      certainty: explicit.certainty,
      parent: parentOf.get(c.id) ?? (c.parent && groups.some((g) => g.id === c.parent) ? c.parent : undefined),
      classes,
      hint: 'class',
      ...(annotation && { annotation }),
      compartments: [
        ...(members.length ? [{ title: 'members', cols: ['member'], rows: members } satisfies Compartment] : []),
        ...(methods.length ? [{ title: 'methods', cols: ['member'], rows: methods } satisfies Compartment] : []),
      ],
      ...optional({
        style: mergeStyles(classStyle('default'), ...classes.map(classStyle), parseStyle(c.styles)),
        link: safeLink(c.link),
        tooltip: tooltipOf(c.tooltip),
      }),
    });
  }

  // Lollipop interfaces (`Class --() Iface`): a bare name at the end of the lollipop, as in Mermaid.
  for (const i of (db.interfaces ?? []) as { id: string; label: string }[]) {
    nodes.push({ id: i.id, label: decodeText(i.label) || i.id, shape: 'text', type: 'plain', certainty: 'none', classes: [], hint: 'interface' });
  }

  const edges: IREdge[] = [];
  let k = 0;
  for (const r of db.getRelations() as Db[]) {
    const m1 = RELATION[r.relation?.type1];
    const m2 = RELATION[r.relation?.type2];
    const t1 = cardinality(r.relationTitle1);
    const t2 = cardinality(r.relationTitle2);
    // Point every edge at its marked end (`Animal <|-- Duck` runs Duck → Animal),
    // so upstream/downstream, routes and trace follow the relation's meaning.
    const flip = !!m1 && !m2;
    const ends: EdgeEnds = flip
      ? { end: m1, ...(t2 && { startLabel: t2 }), ...(t1 && { endLabel: t1 }) }
      : { ...(m1 && { start: m1 }), ...(m2 && { end: m2 }), ...(t1 && { startLabel: t1 }), ...(t2 && { endLabel: t2 }) };
    edges.push({
      id: `r${k++}`,
      from: flip ? r.id2 : r.id1,
      to: flip ? r.id1 : r.id2,
      label: cleanLabel(r.title) || undefined,
      stroke: r.relation?.lineType === 1 ? 'dotted' : 'solid',
      arrowEnd: !!ends.end,
      arrowStart: !!ends.start,
      ends,
      ...(flip ? { authoredReversed: true } : {}),
    });
  }

  // `note for X "…"` becomes a note tied to X by a dotted connector; free notes float.
  for (const n of (db.getNotes() as Map<string, Db>).values()) {
    const id = n.class ? `${n.class}__${n.id}` : `__${n.id}`;
    nodes.push({
      id,
      label: cleanLabel(n.text) || ' ',
      shape: 'note',
      type: 'plain',
      certainty: 'none',
      parent: parentOf.get(n.id) ?? (n.class ? nodes.find((x) => x.id === n.class)?.parent : undefined),
      classes: [],
      hint: 'note',
    });
    if (n.class) edges.push({ id: `r${k++}`, from: id, to: n.class, stroke: 'dotted', arrowEnd: false, arrowStart: false });
  }

  return {
    kind: 'class',
    title: db.getDiagramTitle?.() || undefined,
    direction: normalizeDirection(db.getDirection?.()),
    nodes,
    edges,
    groups,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows(members: any[]): CompartmentRow[] {
  return members.flatMap((m): CompartmentRow[] => {
    const text = decodeText(m.getDisplayDetails?.().displayText ?? m.text);
    if (!text) return [];
    const style = m.classifier === '*' ? 'italic' : m.classifier === '$' ? 'underline' : undefined;
    return [{ cells: [text], ...(style && { style }) }];
  });
}

/** Multiplicity text; Mermaid stores `none` when there is none. */
function cardinality(t: unknown): string | undefined {
  const s = typeof t === 'string' && t !== 'none' ? decodeText(t) : '';
  return s || undefined;
}

function tooltipOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const tip = plainText(cleanLabel(raw)).replace(/\s+/g, ' ').trim();
  return tip ? (tip.length > 300 ? `${tip.slice(0, 299)}…` : tip) : undefined;
}

/** Drop undefined fields so IR and Scene JSON stay lean. */
function optional<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
