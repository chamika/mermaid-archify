/**
 * DiagramIR — the syntax-neutral Intermediate Representation every Mermaid
 * parser produces. It carries meaning only (no coordinates); layout turns it
 * into a positioned Scene.
 */

export type DiagramKind = 'flowchart' | 'sequence' | 'state' | 'architecture';

/** Archify's semantic component palette. */
export type SemanticType =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'cloud'
  | 'security'
  | 'messagebus'
  | 'external';

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
  | 'text';

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
}

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
}
