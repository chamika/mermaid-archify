import { classify } from '../ir/classify';
import { type IRStyle, mergeStyles, parseStyle } from '../ir/style';
import type { Compartment, DiagramIR, EndMark, IREdge, IRGroup, IRNode } from '../ir/types';
import { normalizeDirection } from './flowchart';
import { cleanLabel, decodeText } from './text';

/** Mermaid's cardinality names → crow's-foot markers. */
const CARDINALITY: Record<string, EndMark> = {
  ONLY_ONE: 'one',
  ZERO_OR_ONE: 'zeroOrOne',
  ONE_OR_MORE: 'oneOrMore',
  ZERO_OR_MORE: 'zeroOrMore',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function erToIR(db: Db): DiagramIR {
  const entities: Map<string, Db> = db.getEntities();
  const subGraphs: { id: string; title: string; nodes: string[]; classes?: string[] }[] = db.getSubGraphs?.() ?? [];
  const groupIds = new Set(subGraphs.map((s) => s.id));

  // Mermaid registers inner subgraphs first, so the first claim is the innermost.
  const parentOf = new Map<string, string>();
  for (const sg of subGraphs) for (const m of sg.nodes) if (m !== sg.id && !parentOf.has(m)) parentOf.set(m, sg.id);
  const groups: IRGroup[] = subGraphs.map((sg) => ({ id: sg.id, label: cleanLabel(sg.title) || sg.id, parent: parentOf.get(sg.id) }));

  const classDefs: Map<string, { styles?: string[] }> = db.getClasses?.() ?? new Map();
  const classStyle = (c: string): IRStyle | undefined => parseStyle(classDefs.get(c)?.styles);

  // Relationships name entities by internal id (`entity-NAME-0`); the IR uses the name.
  const nameOf = new Map<string, string>();
  const nodes: IRNode[] = [];
  for (const [name, e] of entities) {
    nameOf.set(e.id, name);
    // A relationship to a subgraph's name creates a same-named entity; the edge belongs to the group.
    if (groupIds.has(name) && !e.attributes?.length) continue;
    const classes: string[] = String(e.cssClasses ?? '')
      .split(/\s+/)
      .filter((c) => c && c !== 'default');
    const explicit = classify({ label: '', id: '', classes });
    nodes.push({
      id: name,
      label: cleanLabel(e.alias || e.label || name) || name,
      shape: 'compartment',
      // An entity is a data store by definition; an explicit class may say otherwise.
      type: explicit.certainty === 'explicit' ? explicit.type : 'database',
      certainty: 'explicit',
      parent: parentOf.get(name),
      classes,
      hint: 'entity',
      compartments: attributes(e.attributes ?? []),
      ...optionalStyle(mergeStyles(classStyle('default'), ...classes.map(classStyle), parseStyle(e.cssStyles))),
    });
  }

  const edges: IREdge[] = db.getRelationships().map((r: Db, i: number): IREdge => {
    // `A ||--o{ B`: cardB is written beside A, cardA beside B.
    const start = CARDINALITY[r.relSpec?.cardB];
    const end = CARDINALITY[r.relSpec?.cardA];
    return {
      id: `r${i}`,
      from: nameOf.get(r.entityA) ?? r.entityA,
      to: nameOf.get(r.entityB) ?? r.entityB,
      label: cleanLabel(r.roleA) || undefined,
      stroke: r.relSpec?.relType === 'NON_IDENTIFYING' ? 'dotted' : 'solid',
      // Relationships read both ways: walkable in either direction, no arrowheads.
      arrowEnd: true,
      arrowStart: true,
      ends: { ...(start && { start }), ...(end && { end }) },
    };
  });

  return {
    kind: 'er',
    title: db.getDiagramTitle?.() || undefined,
    direction: normalizeDirection(db.getDirection?.()),
    nodes,
    edges,
    groups,
  };
}

/** Attributes as one table: type, name, keys, comment; columns no row uses are dropped. */
function attributes(attrs: { type: string; name: string; keys?: string[]; comment?: string }[]): Compartment[] {
  if (!attrs.length) return [];
  const all = attrs.map((a) => [decodeText(a.type), decodeText(a.name), (a.keys ?? []).join(', '), decodeText(a.comment ?? '')]);
  const cols = (['type', 'name', 'keys', 'comment'] as const).filter((_, i) => all.some((r) => r[i]));
  const keep = ['type', 'name', 'keys', 'comment'].map((c) => (cols as readonly string[]).includes(c));
  return [{ title: 'attributes', cols: [...cols], rows: all.map((r) => ({ cells: r.filter((_, i) => keep[i]) })) }];
}

function optionalStyle(style: IRStyle | undefined): { style?: IRStyle } {
  return style ? { style } : {};
}
