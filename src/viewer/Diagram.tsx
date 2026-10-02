import { type JSX, createContext } from 'preact';
import { memo } from 'preact/compat';
import { useContext } from 'preact/hooks';
import { ICON_CELLS, type IconSet, hasIcons, plainText, runs } from '../icons/fa';
import { type IRStyle, isSafeColor } from '../ir/style';
import type { EndMark } from '../ir/types';
import { CAPTION_H, FONT, ROW, cells, charWidth, compartmentMetrics, edgeLabelSize, fitCell, textWidth } from '../layout/measure';
import type { Pt, Scene, SceneEdge, SceneGroup, SceneNode } from '../scene/types';
import { TYPE_ICON, TYPE_LABEL } from './icons';

export interface Highlight {
  /** Nodes/edges drawn at full strength while others dim. */
  lit?: { nodes: Set<string>; edges: Set<string> };
  mode?: 'dimmed' | 'previewing';
  focused?: string;
  routeEnds?: string[];
  routeEdges?: Set<string>;
  pinnedEdge?: string;
  traceStep?: number;
  /** Animation mode: continuous flow on every edge, no steps. */
  animating?: boolean;
  /** Hand-placed nodes, outlined while arranging. */
  pinnedNodes?: Set<string>;
}

export interface DiagramHandlers {
  onNodeClick?: (id: string, e: MouseEvent) => void;
  onNodeEnter?: (id: string) => void;
  onNodeLeave?: (id: string) => void;
  onNodePointerDown?: (id: string, e: PointerEvent) => void;
  onNodeDoubleClick?: (id: string) => void;
  onEdgeClick?: (id: string, e: MouseEvent) => void;
  onEdgeEnter?: (id: string) => void;
  onEdgeLeave?: (id: string) => void;
}

const stroke = (t: string) => `var(--${t}-stroke)`;
const fill = (t: string) => `var(--${t}-fill)`;

/**
 * Author styles as custom properties on the node/edge group. diagram.css reads
 * them with the theme palette as fallback, so highlight states (more specific
 * class rules) still win over author colours.
 */
function userVars(s: IRStyle | undefined): Record<string, string> | undefined {
  if (!s) return undefined;
  const v: Record<string, string> = {};
  if (s.fill) v['--u-fill'] = s.fill;
  if (s.stroke) v['--u-stroke'] = s.stroke;
  if (s.strokeWidth !== undefined) v['--u-sw'] = `${s.strokeWidth}px`;
  if (s.dash) v['--u-dash'] = s.dash;
  if (s.color) v['--u-ink'] = s.color;
  if (s.fontWeight) v['--u-fw'] = s.fontWeight;
  if (s.fontStyle) v['--u-fs'] = s.fontStyle;
  return v;
}

/** Rounded orthogonal polyline. */
export function pathD(points: Pt[], radius = 8): string {
  if (points.length < 2) return '';
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const r = Math.min(radius, dist(p, c) / 2, dist(c, n) / 2);
    const a = toward(c, p, r);
    const b = toward(c, n, r);
    d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const last = points.at(-1)!;
  return `${d} L${last.x},${last.y}`;
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const toward = (from: Pt, to: Pt, r: number): Pt => {
  const d = dist(from, to) || 1;
  return { x: round(from.x + ((to.x - from.x) * r) / d), y: round(from.y + ((to.y - from.y) * r) / d) };
};
const round = (v: number) => Math.round(v * 100) / 100;

function Markers() {
  return (
    <defs>
      <marker id="ma-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path class="ma-marker" d="M0,0.5 L10,5 L0,9.5 z" />
      </marker>
      <marker id="ma-async" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path class="ma-marker open" d="M1,1 L9,5 L1,9" />
      </marker>
      <marker id="ma-cross" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse">
        <path class="ma-marker open" d="M1,1 L9,9 M9,1 L1,9" />
      </marker>
      <marker id="ma-circle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <circle class="ma-marker" cx="5" cy="5" r="3.5" />
      </marker>
      {/* ER crow's feet and UML relation ends: 20×20, tip at x=20 where the line meets the node. */}
      {Object.entries(END_MARKS).map(([id, body]) => (
        <marker key={id} id={`ma-${id}`} viewBox="0 0 20 20" refX="20" refY="10" markerWidth="20" markerHeight="20" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          {body}
        </marker>
      ))}
    </defs>
  );
}

const bar = (x: number) => `M${x},3 V17`;
const FOOT = 'M9,10 L20,3 M9,10 L20,17 M9,10 H20';

/** Marker bodies. `open` strokes only; `hollow` strokes over the canvas colour so the line stops at the shape. */
const END_MARKS: Record<EndMark, JSX.Element> = {
  one: <path class="ma-marker open" d={`${bar(10)} ${bar(15)}`} />,
  zeroOrOne: (
    <>
      <path class="ma-marker open" d={bar(15)} />
      <circle class="ma-marker hollow" cx="6" cy="10" r="4" />
    </>
  ),
  oneOrMore: <path class="ma-marker open" d={`${FOOT} ${bar(6)}`} />,
  zeroOrMore: (
    <>
      <path class="ma-marker open" d={FOOT} />
      <circle class="ma-marker hollow" cx="4.5" cy="10" r="4" />
    </>
  ),
  inherit: <path class="ma-marker hollow" d="M19.5,10 L5,3 L5,17 z" />,
  compose: <path class="ma-marker" d="M19.5,10 L11,5 L2.5,10 L11,15 z" />,
  aggregate: <path class="ma-marker hollow" d="M19.5,10 L11,5 L2.5,10 L11,15 z" />,
  open: <path class="ma-marker open" d="M9,4 L19.5,10 L9,16" />,
  lollipop: <circle class="ma-marker hollow" cx="13" cy="10" r="6" />,
};

const markerUrl = (m: EndMark | undefined) => (m ? `url(#ma-${m})` : undefined);

const IconContext = createContext<IconSet>({});

/**
 * Label lines that may contain inline Font Awesome icons. Lines without icons
 * render as plain tspans; lines with icons are laid out run by run from the
 * same monospace cell widths the layout used, with icons as filled paths.
 */
function RichText({
  lines,
  x,
  y0,
  lh,
  size,
  cls,
  align = 'middle',
  track = 0,
}: {
  lines: string[];
  x: number;
  /** Baseline of the first line. */
  y0: number;
  lh: number;
  size: number;
  cls?: string;
  align?: 'middle' | 'start';
  /** Extra advance per character (CSS letter-spacing), in px. */
  track?: number;
}) {
  const icons = useContext(IconContext);
  const cw = charWidth(size) + track;
  const texts: JSX.Element[] = [];
  const glyphs: JSX.Element[] = [];
  lines.forEach((line, i) => {
    const y = y0 + lh * i;
    if (!hasIcons(line)) {
      texts.push(
        <tspan key={i} x={x} y={y}>
          {line}
        </tspan>,
      );
      return;
    }
    let cursor = align === 'middle' ? x - (cells(line) * cw) / 2 : x;
    runs(line).forEach((r, j) => {
      if ('icon' in r) {
        const def = icons[r.icon];
        const slot = ICON_CELLS * cw;
        if (def) {
          const [vw, vh, d] = def;
          const s = Math.min((size * 0.95) / vh, (slot * 0.92) / vw);
          const ix = cursor + (slot - vw * s) / 2;
          const iy = y - size * 0.36 - (vh * s) / 2;
          glyphs.push(<path key={`${i}-${j}`} class="ma-icon" d={d} transform={`translate(${round(ix)},${round(iy)}) scale(${s.toFixed(5)})`} />);
        }
        cursor += slot;
      } else {
        const lead = r.text.length - r.text.trimStart().length;
        const body = r.text.trim();
        if (body)
          texts.push(
            <tspan key={`${i}-${j}`} x={round(cursor + lead * cw)} y={y} text-anchor="start">
              {body}
            </tspan>,
          );
        cursor += cells(r.text) * cw;
      }
    });
  });
  return (
    <>
      <text class={cls} text-anchor={align}>
        {texts}
      </text>
      {glyphs.length > 0 && <g class="ma-icons">{glyphs}</g>}
    </>
  );
}

function GroupView({ g }: { g: SceneGroup }) {
  return (
    <g class="ma-group" data-id={g.id}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} />
      {g.label && <RichText lines={[g.label]} x={g.x + 14} y0={g.y + 22} lh={0} size={11} align="start" track={11 * 0.08} />}
    </g>
  );
}

/** Caption tint: the type colour, or the label ink over an author fill. */
const typeInk = (n: SceneNode) => (n.style?.color ? 'var(--u-ink)' : stroke(n.type));

function Label({ n, withCaption }: { n: SceneNode; withCaption: boolean }) {
  const lh = FONT.label * FONT.lineHeight;
  const caption = withCaption ? CAPTION_H : 0;
  const cx = n.x + n.w / 2;
  const top = n.y + n.h / 2 - (n.lines.length * lh + caption) / 2 + (n.shape === 'cylinder' ? 5 : 0);
  return (
    <>
      <RichText lines={n.lines} x={cx} y0={top + lh - 4} lh={lh} size={FONT.label} cls="label" />
      {withCaption && (
        <g>
          <g transform={`translate(${cx - (TYPE_LABEL[n.type].length * 6) / 2 - 9},${top + n.lines.length * lh + 1.5}) scale(0.68)`}>
            <path class="icon" d={TYPE_ICON[n.type]} style={{ stroke: typeInk(n) }} />
          </g>
          <text class="caption" x={cx + 6} y={top + n.lines.length * lh + 10} text-anchor="middle" style={{ fill: typeInk(n) }}>
            {TYPE_LABEL[n.type]}
          </text>
        </g>
      )}
    </>
  );
}

/** Title, «annotation» and aligned rows of a compartment box; same metrics the layout used. */
function CompartmentText({ n }: { n: SceneNode }) {
  const m = compartmentMetrics(n.label, n.annotation, n.compartments);
  const lh = FONT.label * FONT.lineHeight;
  const cx = n.x + n.w / 2;
  const top = n.y + ROW.headPad + (n.annotation ? ROW.annotationH : 0);
  const sections = (n.compartments ?? []).filter((c) => c.rows.length);
  return (
    <>
      {n.annotation && (
        <text class="caption annotation" x={cx} y={n.y + ROW.headPad + 10} text-anchor="middle">
          «{n.annotation}»
        </text>
      )}
      <RichText lines={m.lines} x={cx} y0={top + lh - 4} lh={lh} size={FONT.label} cls="label" />
      {sections.map((c, i) =>
        c.rows.map((row, j) => (
          <text
            key={`${i}-${j}`}
            class={['row', row.style].filter(Boolean).join(' ')}
            y={n.y + m.sections[i].y + ROW.sectionPad + j * ROW.h + ROW.h * 0.7}
          >
            {row.cells.map((cell, k) =>
              cell ? (
                <tspan key={k} class={`c-${c.cols[k]}`} x={n.x + m.sections[i].colX[k]}>
                  {fitCell(cell)}
                </tspan>
              ) : null,
            )}
          </text>
        )),
      )}
    </>
  );
}

function Shape({ n }: { n: SceneNode }) {
  const { x, y, w, h } = n;
  const st = { stroke: `var(--u-stroke, ${stroke(n.type)})`, fill: `var(--u-fill, ${fill(n.type)})` };
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (n.shape) {
    case 'start':
      return <circle class="solid" cx={cx} cy={cy} r={w / 2 - 2} />;
    case 'end':
      return (
        <>
          <circle class="ring" cx={cx} cy={cy} r={w / 2 - 1} />
          <circle class="solid" cx={cx} cy={cy} r={w / 2 - 5} />
        </>
      );
    case 'junction':
      return <circle class="junction" cx={cx} cy={cy} r={w / 2} />;
    case 'fork':
      return <rect class="solid" x={x} y={y} width={w} height={h} rx={2} />;
    case 'diamond': {
      const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
      return (
        <>
          <polygon class="mask" points={pts} />
          <polygon class="body" points={pts} style={st} />
        </>
      );
    }
    case 'hexagon': {
      const k = Math.min(18, w / 5);
      const pts = `${x + k},${y} ${x + w - k},${y} ${x + w},${cy} ${x + w - k},${y + h} ${x + k},${y + h} ${x},${cy}`;
      return (
        <>
          <polygon class="mask" points={pts} />
          <polygon class="body" points={pts} style={st} />
        </>
      );
    }
    case 'parallelogram':
    case 'trapezoid': {
      const k = 14;
      const pts =
        n.shape === 'parallelogram'
          ? `${x + k},${y} ${x + w},${y} ${x + w - k},${y + h} ${x},${y + h}`
          : `${x + k},${y} ${x + w - k},${y} ${x + w},${y + h} ${x},${y + h}`;
      return (
        <>
          <polygon class="mask" points={pts} />
          <polygon class="body" points={pts} style={st} />
        </>
      );
    }
    case 'document': {
      const wave = 8;
      const d = `M${x},${y + 6} a6,6 0 0 1 6,-6 H${x + w - 6} a6,6 0 0 1 6,6 V${y + h - wave} C${x + w * 0.75},${y + h - wave * 2.2} ${x + w * 0.25},${y + h + wave * 0.6} ${x},${y + h - wave} Z`;
      return (
        <>
          <path class="mask" d={d} />
          <path class="body" d={d} style={st} />
        </>
      );
    }
    case 'note':
      return (
        <>
          <rect class="mask" x={x} y={y} width={w} height={h} rx={4} />
          <rect class="body note" x={x} y={y} width={w} height={h} rx={4} />
        </>
      );
    case 'compartment': {
      const m = compartmentMetrics(n.label, n.annotation, n.compartments);
      const r = 7;
      // Without rows the title band is the whole box, rounded all round.
      const head = m.sections.length
        ? `M${x},${y + m.headH} V${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + m.headH} Z`
        : `M${x},${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + h - r} a${r},${r} 0 0 1 -${r},${r} H${x + r} a${r},${r} 0 0 1 -${r},-${r} Z`;
      return (
        <>
          <rect class="mask" x={x} y={y} width={w} height={h} rx={r} />
          <rect class="body" x={x} y={y} width={w} height={h} rx={r} style={st} />
          <path class="head" d={head} style={{ fill: st.stroke }} />
          {m.sections.map((sec, i) => (
            <path key={i} class="body divider" d={`M${x},${y + sec.y} H${x + w}`} style={{ ...st, fill: 'none' }} />
          ))}
        </>
      );
    }
    case 'text':
      // Borderless text; an invisible body keeps hit-testing and focus rings working.
      return <rect class="body text-only" x={x} y={y} width={w} height={h} rx={4} />;
    case 'circle':
      return (
        <>
          <circle class="mask" cx={cx} cy={cy} r={w / 2} />
          <circle class="body" cx={cx} cy={cy} r={w / 2} style={st} />
        </>
      );
    case 'cylinder': {
      const ry = 7;
      const body = `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${w / 2},${ry} 0 0 1 ${x},${y + h - ry} Z`;
      return (
        <>
          <path class="mask" d={body} />
          <path class="body" d={body} style={st} />
          <path class="body" d={`M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`} style={{ ...st, fill: 'none' }} />
        </>
      );
    }
    default: {
      const rx = n.shape === 'rounded' ? Math.min(16, h / 2) : 7;
      return (
        <>
          <rect class="mask" x={x} y={y} width={w} height={h} rx={rx} />
          <rect class="body" x={x} y={y} width={w} height={h} rx={rx} style={st} />
          {n.shape === 'subroutine' && (
            <path class="body" d={`M${x + 8},${y} V${y + h} M${x + w - 8},${y} V${y + h}`} style={{ ...st, fill: 'none' }} />
          )}
          {n.shape === 'actor' && (
            <g transform={`translate(${x + 10},${cy - 8})`}>
              <path class="icon" d="M8 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 14c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" style={{ stroke: typeInk(n) }} />
            </g>
          )}
        </>
      );
    }
  }
}

function NodeView({ n, kind, cls, h }: { n: SceneNode; kind: Scene['kind']; cls: string; h: DiagramHandlers }) {
  // A caption names the component type, so only typed nodes get one.
  const withCaption =
    kind !== 'state' && n.type !== 'plain' && !['start', 'end', 'junction', 'fork', 'diamond', 'circle', 'text', 'note', 'compartment'].includes(n.shape);
  const interactive = n.shape !== 'fork';
  return (
    <g
      class={`ma-node ${cls}`}
      data-id={n.id}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `${plainText(n.label) || n.id}, ${TYPE_LABEL[n.type]}${n.link ? ', has link' : ''}` : undefined}
      style={userVars(n.style)}
      onClick={(e) => h.onNodeClick?.(n.id, e as unknown as MouseEvent)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          h.onNodeClick?.(n.id, e as unknown as MouseEvent);
        }
      }}
      onPointerEnter={() => h.onNodeEnter?.(n.id)}
      onPointerLeave={() => h.onNodeLeave?.(n.id)}
      onPointerDown={h.onNodePointerDown && ((e) => h.onNodePointerDown!(n.id, e as unknown as PointerEvent))}
      onDblClick={h.onNodeDoubleClick && (() => h.onNodeDoubleClick!(n.id))}
    >
      <Shape n={n} />
      {n.shape === 'compartment' ? <CompartmentText n={n} /> : n.lines.length > 0 && <Label n={n} withCaption={withCaption} />}
      {n.tooltip ? <title>{n.tooltip}</title> : n.shape === 'end' || n.shape === 'start' ? <title>{n.shape}</title> : null}
    </g>
  );
}

function EdgeView({ e, cls, h }: { e: SceneEdge; cls: string; h: DiagramHandlers }) {
  const d = pathD(e.points);
  const styled: Record<string, string> = { cross: 'url(#ma-cross)', async: 'url(#ma-async)', circle: 'url(#ma-circle)' };
  const marker = (e.arrowStyle && styled[e.arrowStyle]) || 'url(#ma-arrow)';
  // ER/class relations name each end's marker; otherwise arrows follow the arrow flags.
  const endMarker = e.ends ? markerUrl(e.ends.end) : e.arrowEnd ? marker : undefined;
  // Sequence async/cross styles describe the receiving end only.
  const startMarker = e.ends
    ? markerUrl(e.ends.start)
    : e.arrowStart
      ? e.arrowStyle === 'circle' || e.arrowStyle === 'cross'
        ? marker
        : 'url(#ma-arrow)'
      : undefined;
  const lb = e.labelBox;
  // Same wrapping the layout used to size the label box.
  const lines = e.label ? edgeLabelSize(e.label).lines : [];
  return (
    <g
      class={`ma-edge ${e.stroke} ${cls}`}
      data-id={e.id}
      style={userVars(e.style)}
      onClick={(ev) => h.onEdgeClick?.(e.id, ev as unknown as MouseEvent)}
      onPointerEnter={() => h.onEdgeEnter?.(e.id)}
      onPointerLeave={() => h.onEdgeLeave?.(e.id)}
    >
      <path class="hit" d={d} />
      <path class="line" d={d} marker-end={endMarker} marker-start={startMarker} />
      {lb && (
        <g>
          <rect class="label-bg" x={lb.x - 1} y={lb.y} width={lb.w + 2} height={lb.h} rx={4} />
          <RichText
            lines={lines}
            x={lb.x + lb.w / 2}
            y0={lb.y + 1 + FONT.edge * FONT.lineHeight}
            lh={FONT.edge * FONT.lineHeight}
            size={FONT.edge}
            cls="label-text"
          />
        </g>
      )}
      {e.endLabels?.map((l, i) => (
        <text key={i} class="end-label" x={l.x} y={l.y + FONT.edge * 0.35} text-anchor="middle">
          {l.text}
        </text>
      ))}
    </g>
  );
}

/** Accept only plain CSS colour syntax from diagram source; anything else gets the neutral tint. */
const safeColor = (c: string): string => (isSafeColor(c) ? c.trim() : 'var(--lane-stroke)');

/** Block condition text on a mask so lifelines never cross it. */
function CondLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const w = textWidth(`[${text}]`, FONT.edge) + 8;
  return (
    <>
      <rect class="cond-bg" x={x - 4} y={y - 11} width={w} height={15} rx={3} />
      <text class="cond" x={x} y={y}>
        [{text}]
      </text>
    </>
  );
}

function SequenceBackdrop({ scene }: { scene: Scene }) {
  const seq = scene.seq!;
  return (
    <>
      {seq.lifelines.map((l) => (
        <line class="ma-lifeline" key={l.actor} data-actor={l.actor} x1={l.x} x2={l.x} y1={l.y1} y2={l.y2} />
      ))}
      {seq.activations.map((a, i) => (
        <rect class="ma-activation" key={i} x={a.x} y={a.y} width={a.w} height={Math.max(a.h, 8)} rx={2} />
      ))}
      {seq.blocks.map((b) => {
        if (b.type === 'rect') {
          // `rect <colour>` is a highlight band in Mermaid: tint it, no title.
          return (
            <g class="ma-block ma-highlight" key={b.id}>
              <rect class="band" x={b.x} y={b.y} width={b.w} height={b.h} rx={6} style={{ fill: safeColor(b.label) }} />
            </g>
          );
        }
        const kw = b.type;
        const tabW = kw.length * 6.6 + 16;
        return (
          <g class="ma-block" key={b.id}>
            <rect class="frame" x={b.x} y={b.y} width={b.w} height={b.h} rx={6} />
            {kw && <path class="tab" d={`M${b.x},${b.y + 6} a6,6 0 0 1 6,-6 H${b.x + tabW} v14 l-6,6 H${b.x} z`} />}
            {kw && (
              <text class="kw" x={b.x + 8} y={b.y + 14}>
                {kw}
              </text>
            )}
            {b.label && <CondLabel x={b.x + tabW + 6} y={b.y + 14} text={b.label} />}
            {b.sections.map((s, i) => (
              <g key={i}>
                <line x1={b.x} x2={b.x + b.w} y1={s.y} y2={s.y} />
                {s.label && <CondLabel x={b.x + 8} y={s.y + 16} text={s.label} />}
              </g>
            ))}
          </g>
        );
      })}
    </>
  );
}

function Notes({ scene }: { scene: Scene }) {
  return (
    <>
      {scene.seq!.notes.map((n) => (
        <g class="ma-note" key={n.id}>
          <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} />
          <text text-anchor="middle">
            {n.lines.map((l, i) => (
              <tspan key={i} x={n.x + n.w / 2} y={n.y + 8 + FONT.note * FONT.lineHeight * (i + 1) - 2}>
                {l}
              </tspan>
            ))}
          </text>
        </g>
      ))}
    </>
  );
}

export interface DiagramProps {
  scene: Scene;
  highlight?: Highlight;
  handlers?: DiagramHandlers;
  /** Extra SVG drawn on top (trace pulse). */
  overlay?: JSX.Element | null;
  svgRef?: (el: SVGSVGElement | null) => void;
}

function DiagramImpl({ scene, highlight = {}, handlers = {}, overlay, svgRef }: DiagramProps) {
  const { lit, mode, focused, routeEnds, routeEdges, pinnedEdge, traceStep, animating, pinnedNodes } = highlight;
  const nodeCls = (id: string) =>
    [lit?.nodes.has(id) && 'lit', focused === id && 'focused', routeEnds?.includes(id) && 'route-end', pinnedNodes?.has(id) && 'pinned']
      .filter(Boolean)
      .join(' ');
  const edgeCls = (e: SceneEdge) =>
    [
      lit?.edges.has(e.id) && 'lit',
      routeEdges?.has(e.id) && 'on-route',
      pinnedEdge === e.id && 'pinned',
      traceStep !== undefined && e.order === traceStep && 'trace-now',
      traceStep !== undefined && e.order < traceStep && 'trace-done',
    ]
      .filter(Boolean)
      .join(' ');
  const groups = [...scene.groups].sort((a, b) => a.depth - b.depth);
  const rootCls = ['ma-svg', mode, traceStep !== undefined && 'tracing', animating && 'flowing'].filter(Boolean).join(' ');
  return (
    <svg
      ref={svgRef}
      class={rootCls}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width}
      height={scene.height}
      role="img"
      aria-label={scene.title ?? `${scene.kind} diagram`}
    >
      <IconContext.Provider value={scene.icons ?? {}}>
      <Markers />
      {groups.map((g) => (
        <GroupView key={g.id} g={g} />
      ))}
      {scene.seq && <SequenceBackdrop scene={scene} />}
      <g class="ma-edges">
        {scene.edges.map((e) => (
          <EdgeView key={e.id} e={e} cls={edgeCls(e)} h={handlers} />
        ))}
      </g>
      {scene.seq && <Notes scene={scene} />}
      <g class="ma-nodes">
        {scene.nodes.map((n) => (
          <NodeView key={n.id} n={n} kind={scene.kind} cls={nodeCls(n.id)} h={handlers} />
        ))}
        {scene.seq?.footers.map((n) => (
          <NodeView key={`${n.id}__foot`} n={n} kind={scene.kind} cls={nodeCls(n.id)} h={handlers} />
        ))}
      </g>
      {overlay && <g class="ma-overlay">{overlay}</g>}
      </IconContext.Provider>
    </svg>
  );
}

export const Diagram = memo(DiagramImpl);
