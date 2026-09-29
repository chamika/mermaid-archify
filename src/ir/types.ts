import type { IconSet } from '../icons/fa';
import type { IRStyle } from './style';

export type { IRStyle };

/**
 * DiagramIR — the syntax-neutral Intermediate Representation every Mermaid
 * parser produces. It carries meaning only (no coordinates); layout turns it
 * into a positioned Scene.
 */

export type DiagramKind = 'flowchart' | 'sequence' | 'state' | 'architecture' | 'er' | 'class';

/**
 * Archify's semantic component palette, plus `plain` for nodes the source
 * gives no evidence about (process steps, generic states): neutral styling,
 * no type caption.
 */
export type SemanticType =
  | 'plain'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'cloud'
  | 'security'
  | 'messagebus'
  | 'external';

/** Types a user can name explicitly (`A:::database`). `plain` is the absence of one. */
export const SEMANTIC_TYPES: readonly SemanticType[] = [
  'frontend',
  'backend',
  'database',
  'cloud',
  'security',
  'messagebus',
  'external',
];

export type NodeShape =
  | 'rect'
  | 'rounded'
  | 'cylinder'
  | 'diamond'
  | 'circle'
  | 'hexagon'
  | 'subroutine'
  | 'start'
  | 'end'
  | 'junction'
  | 'fork'
  | 'actor'
  | 'participant'
  | 'document'
  | 'parallelogram'
  | 'trapezoid'
  | 'note'
  | 'text'
  | 'compartment';

/**
 * One section of a compartment box (ER attributes, class members or methods):
 * rows of cells, aligned into columns. `cols` names each column's role, which
 * the renderer uses for styling.
 */
export interface Compartment {
  /** What the rows are, for the details panel. */
  title: 'attributes' | 'members' | 'methods';
  cols: CompartmentCol[];
  rows: CompartmentRow[];
}

export type CompartmentCol = 'type' | 'name' | 'keys' | 'comment' | 'member';

export interface CompartmentRow {
  cells: string[];
  /** UML classifiers: `*` abstract (italic), `$` static (underlined). */
  style?: 'italic' | 'underline';
}

/**
 * Relationship end markers: ER cardinalities (crow's foot) and UML class
 * relations. Drawn at the end of the edge they belong to.
 */
export type EndMark =
  | 'one'
  | 'zeroOrOne'
  | 'oneOrMore'
  | 'zeroOrMore'
  | 'inherit'
  | 'compose'
  | 'aggregate'
  | 'open'
  | 'lollipop';

export interface EdgeEnds {
  start?: EndMark;
  end?: EndMark;
  /** Text beside each end (class multiplicities such as `1`, `*`). */
  startLabel?: string;
  endLabel?: string;
}

export type Direction = 'LR' | 'RL' | 'TB' | 'BT';

export interface IRNode {
  id: string;
  label: string;
  type: SemanticType;
  shape: NodeShape;
  /** Enclosing group id, if any. */
  parent?: string;
  classes: string[];
  /** Raw hint used for classification (flowchart shape, architecture icon). */
  hint?: string;
  /** How `type` was decided; `guess` types survive only in architecture-like diagrams. */
  certainty?: Certainty;
  /** Author styling (`style`, `classDef`), already sanitized. */
  style?: IRStyle;
  /** `click` target, http(s) or relative only. */
  link?: string;
  /** `click` tooltip, plain text. */
  tooltip?: string;
  /** Compartment shape: sections under the title (ER attributes, class members/methods). */
  compartments?: Compartment[];
  /** Compartment shape: stereotype shown above the title (`interface` → «interface»). */
  annotation?: string;
}

export type Certainty = 'explicit' | 'guess' | 'none';

export type EdgeStroke = 'solid' | 'dotted' | 'thick';
export type Side = 'L' | 'R' | 'T' | 'B';

export interface IREdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  stroke: EdgeStroke;
  arrowEnd: boolean;
  arrowStart: boolean;
  /** End marker style (flowchart `--o`, `--x`); default arrow. */
  marker?: 'arrow' | 'circle' | 'cross';
  /** Layout-only link (`~~~`): steers placement, never drawn. */
  invisible?: boolean;
  /** Architecture-beta side hints. */
  fromSide?: Side;
  toSide?: Side;
  /** Author styling (`linkStyle`, edge classes), already sanitized. */
  style?: IRStyle;
  /** ER/class relationship markers; replace the arrow flags when drawing. */
  ends?: EdgeEnds;
  /**
   * Written the other way round (`Animal <|-- Duck` runs Duck → Animal). Layout
   * follows the written order, as Mermaid's does, so parents sit above children.
   */
  authoredReversed?: boolean;
}

export interface IRGroup {
  id: string;
  label: string;
  parent?: string;
  hint?: string;
}

/* ---------- sequence-specific ---------- */

export type SeqArrow = 'arrow' | 'open' | 'cross' | 'async';

export interface SeqMessage {
  kind: 'message';
  /** Matches the IREdge id for the same message. */
  id: string;
  from: string;
  to: string;
  label: string;
  stroke: 'solid' | 'dotted';
  arrow: SeqArrow;
  bidirectional: boolean;
}

export interface SeqNote {
  kind: 'note';
  id: string;
  over: string[];
  placement: 'left' | 'right' | 'over';
  text: string;
}

export type SeqBlockType = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect';

export interface SeqBlockStart {
  kind: 'blockStart';
  id: string;
  type: SeqBlockType;
  label: string;
}
export interface SeqBlockSection {
  kind: 'blockSection';
  id: string;
  label: string;
}
export interface SeqBlockEnd {
  kind: 'blockEnd';
  id: string;
}
export interface SeqActivation {
  kind: 'activate' | 'deactivate';
  actor: string;
}

export type SeqEvent =
  | SeqMessage
  | SeqNote
  | SeqBlockStart
  | SeqBlockSection
  | SeqBlockEnd
  | SeqActivation;

export interface DiagramIR {
  kind: DiagramKind;
  title?: string;
  direction: Direction;
  nodes: IRNode[];
  edges: IREdge[];
  groups: IRGroup[];
  /** Ordered sequence events (sequence diagrams only). */
  events?: SeqEvent[];
  /** Path data for the Font Awesome icons its labels use, keyed `style:name`. */
  icons?: IconSet;
}
