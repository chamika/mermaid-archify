import type { IconSet } from '../icons/fa';
import type { Compartment, DiagramKind, EdgeEnds, EdgeStroke, IRStyle, NodeShape, SemanticType, SeqBlockType } from '../ir/types';

/** Scene — the IR plus absolute geometry. The viewer consumes only this. */

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneNode extends Box {
  id: string;
  label: string;
  /** Label wrapped into display lines. */
  lines: string[];
  type: SemanticType;
  shape: NodeShape;
  parent?: string;
  /** Author styling; `color` is set only over an opaque fill. */
  style?: IRStyle;
  /** `click` target (http(s) or relative). */
  link?: string;
  tooltip?: string;
  compartments?: Compartment[];
  annotation?: string;
  /** Palette tint: a token prefix in tokens.css (`tone-3`, `depth-2`), read as `--<accent>-stroke` etc. */
  accent?: string;
}

export interface SceneGroup extends Box {
  id: string;
  label: string;
  parent?: string;
  depth: number;
  /** Palette tint: a token prefix in tokens.css (`tone-3`, `depth-2`), read as `--<accent>-stroke` etc. */
  accent?: string;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  points: Pt[];
  labelBox?: Box;
  stroke: EdgeStroke;
  arrowEnd: boolean;
  arrowStart: boolean;
  arrowStyle?: 'arrow' | 'open' | 'cross' | 'async' | 'circle';
  /** Order for trace playback (sequence message index, else topological-ish). */
  order: number;
  /** Author styling (stroke only; label colours stay themed). */
  style?: IRStyle;
  /** ER/class relationship markers and end labels. */
  ends?: EdgeEnds;
  /** Placed end labels (class multiplicities), centre points. */
  endLabels?: { text: string; x: number; y: number }[];
  /** Palette tint: a token prefix in tokens.css (`tone-3`, `depth-2`), read as `--<accent>-stroke` etc. */
  accent?: string;
}

export interface SceneLifeline {
  actor: string;
  x: number;
  y1: number;
  y2: number;
}

export interface SceneActivation extends Box {
  actor: string;
}

export interface SceneNote extends Box {
  id: string;
  text: string;
  lines: string[];
}

export interface SceneBlock extends Box {
  id: string;
  type: SeqBlockType;
  label: string;
  /** Section dividers (y) with their labels, e.g. `else`. */
  sections: { y: number; label: string }[];
}

export interface SceneSequence {
  lifelines: SceneLifeline[];
  activations: SceneActivation[];
  notes: SceneNote[];
  blocks: SceneBlock[];
  /** Participant boxes duplicated at the bottom. */
  footers: SceneNode[];
}

export interface SceneLegendEntry {
  /** Token prefix in tokens.css, as on `accent`. */
  accent: string;
  label: string;
}

export interface Scene {
  version: 1;
  kind: DiagramKind;
  title?: string;
  width: number;
  height: number;
  nodes: SceneNode[];
  groups: SceneGroup[];
  edges: SceneEdge[];
  seq?: SceneSequence;
  /** What palette tints mean (`regions`: loop, decision…), for the legend. Type colours are read off the nodes. */
  legend?: SceneLegendEntry[];
  /** Icon path data, embedded so exported diagrams are self-contained. */
  icons?: IconSet;
}
