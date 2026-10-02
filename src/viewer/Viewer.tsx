import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { plainText } from '../icons/fa';
import { safeLink } from '../ir/style';
import type { SemanticType } from '../ir/types';
import type { Scene, SceneNode } from '../scene/types';
import { Diagram, type Highlight, pathD } from './Diagram';
import { type Lit, adjacency, neighbourhood, relationPhrase, route, search } from './graph';
import { Icon, STATE_TONE_LABEL, TYPE_ICON, TYPE_LABEL, UI_ICON } from './icons';
import { usePanZoom } from './usePanZoom';
import diagramCss from './diagram.css?inline';
import tokensCss from './tokens.css?inline';
import viewerCss from './viewer.css?inline';

export interface ExportAction {
  id: string;
  label: string;
  run: (ctx: { svg: SVGSVGElement; scene: Scene }) => void | Promise<void>;
}

export interface ViewerProps {
  scene: Scene;
  /** Node to focus on first render (deep link). */
  initialFocus?: string;
  onFocusChange?: (id: string | undefined) => void;
  /** Called when an edge is clicked to pin it (not when it is unpinned). */
  onEdgePin?: (id: string) => void;
  /** Elements to highlight from outside (the editor's cursor line); panned into view when off-screen. */
  linked?: Lit;
  /** Builds the shareable link for a focused node. */
  linkFor?: (id: string) => string;
  exports?: ExportAction[];
  /** Extra toolbar content (app-specific buttons). */
  toolbarExtra?: ComponentChildren;
  /**
   * Hand placement (the app only; exported files have no source to save to).
   * `onPin` reports an offset from the automatic position, or undefined to
   * unpin; `final` is false for live previews while dragging.
   */
  arrange?: {
    pins: Record<string, [number, number]>;
    onPin: (id: string, offset: [number, number] | undefined, final: boolean) => void;
  };
  showTitle?: boolean;
  /**
   * Embedded use (the `<mermaid-archify>` element): styles are not added to
   * the document, keyboard shortcuts only work while this viewer has focus,
   * and the wheel scrolls the page until the viewer is focused.
   */
  embedded?: boolean;
  /** Controlled theme; when set, the document's theme is neither read nor written. */
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
  /** Toolbar, legend and minimap. Default true. */
  controls?: boolean;
}

type Theme = 'light' | 'dark';

/** Everything the viewer needs to look right; the element puts it in its shadow root. */
export const VIEWER_CSS = tokensCss + diagramCss + viewerCss;

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('ma-viewer-css')) return;
  const style = document.createElement('style');
  style.id = 'ma-viewer-css';
  style.textContent = VIEWER_CSS;
  document.head.appendChild(style);
}

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Focus is inside `el`, looking through shadow roots (`document.activeElement` stops at the host). */
function hasFocusWithin(el: HTMLElement | null): boolean {
  if (!el) return false;
  const active = (el.getRootNode() as Document | ShadowRoot).activeElement;
  return !!active && el.contains(active);
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.cm-editor'));

export function Viewer({
  scene,
  initialFocus,
  onFocusChange,
  onEdgePin,
  linked,
  linkFor,
  exports = [],
  toolbarExtra,
  arrange,
  showTitle = true,
  embedded = false,
  theme: themeProp,
  onThemeChange,
  controls = true,
}: ViewerProps) {
  if (!embedded) injectCss();
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pz = usePanZoom(viewportRef, embedded ? { wheelPans: () => hasFocusWithin(viewportRef.current) } : undefined);
  const adj = useMemo(() => adjacency(scene), [scene]);
  const nodeById = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene]);

  const [focus, setFocusState] = useState<string | undefined>(initialFocus);
  const [hoverNode, setHoverNode] = useState<string>();
  const [hoverEdge, setHoverEdge] = useState<string>();
  const [pinnedEdge, setPinnedEdge] = useState<string>();
  const [routeEnds, setRouteEnds] = useState<string[]>([]);
  const [finderOpen, setFinderOpen] = useState(false);
  const [traceStep, setTraceStep] = useState<number>();
  const [animating, setAnimating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [ownTheme, setTheme] = useState<Theme>(() => themeProp ?? currentTheme());
  const theme = themeProp ?? ownTheme;
  const [toast, setToast] = useState<string>();
  const [linkedLit, setLinkedLit] = useState<Lit>();
  const [arranging, setArranging] = useState(false);
  const [dragging, setDragging] = useState<string>();
  const canArrange = !!arrange && !scene.seq;
  const arrangeOn = arranging && canArrange;

  const setFocus = useCallback(
    (id: string | undefined) => {
      setFocusState(id);
      onFocusChange?.(id);
    },
    [onFocusChange],
  );

  // --- fit on first scene, on a kind change, or when the diagram is mostly new ---
  const fitted = useRef<{ kind: string; ids: Set<string> }>();
  useEffect(() => {
    if (!pz.size.w) return;
    const ids = new Set(scene.nodes.map((n) => n.id));
    const prev = fitted.current;
    const shared = prev ? [...ids].filter((id) => prev.ids.has(id)).length : 0;
    const isNew = !prev || prev.kind !== scene.kind || shared < Math.max(ids.size, prev.ids.size) / 2;
    fitted.current = { kind: scene.kind, ids };
    if (isNew) {
      pz.fit({ w: scene.width, h: scene.height });
      if (initialFocus && nodeById.has(initialFocus)) {
        const n = nodeById.get(initialFocus)!;
        window.setTimeout(() => pz.centerOn(n, { minK: 1, offsetX: 320 }), 50);
      }
    }
  }, [scene, pz.size.w]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop interaction state that no longer matches the (live-edited) scene.
  useEffect(() => {
    if (focus && !nodeById.has(focus)) setFocus(undefined);
    if (pinnedEdge && !scene.edges.some((e) => e.id === pinnedEdge)) setPinnedEdge(undefined);
    if (routeEnds.some((id) => !nodeById.has(id))) setRouteEnds([]);
    setTraceStep(undefined);
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- linked highlight: replaces any selection, pans only when it is off-screen ---
  useEffect(() => {
    if (!linked || (!linked.nodes.size && !linked.edges.size)) {
      setLinkedLit(undefined);
      return;
    }
    setLinkedLit(linked);
    if (focus) setFocus(undefined);
    setPinnedEdge(undefined);
    setRouteEnds([]);
    setTraceStep(undefined);
    const box = litBounds(scene, linked);
    const { t, size } = pz;
    if (!box || !size.w) return;
    const [x0, y0, x1, y1] = [box.x * t.k + t.x, box.y * t.k + t.y, (box.x + box.w) * t.k + t.x, (box.y + box.h) * t.k + t.y];
    if (x0 < 0 || y0 < 0 || x1 > size.w || y1 > size.h) pz.centerOn(box);
  }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- route probe ---
  const routeLit = useMemo<Lit | undefined | null>(() => {
    if (routeEnds.length < 2) return null;
    return route(adj, routeEnds[0], routeEnds[1]);
  }, [adj, routeEnds]);

  // --- highlight model ---
  const highlight = useMemo<Highlight>(() => {
    const h: Highlight = { traceStep, animating, pinnedEdge, routeEnds, ...(arrangeOn && { pinnedNodes: new Set(Object.keys(arrange!.pins)) }) };
    if (routeEnds.length === 2) {
      if (routeLit) return { ...h, lit: routeLit, mode: 'dimmed', routeEdges: routeLit.edges };
      return { ...h, lit: { nodes: new Set(routeEnds), edges: new Set() }, mode: 'dimmed' };
    }
    if (focus) return { ...h, lit: neighbourhood(adj, focus), mode: 'dimmed', focused: focus };
    if (pinnedEdge) {
      const e = scene.edges.find((x) => x.id === pinnedEdge)!;
      return { ...h, lit: { nodes: new Set([e.from, e.to]), edges: new Set([e.id]) }, mode: 'dimmed' };
    }
    if (linkedLit) return { ...h, lit: linkedLit, mode: 'dimmed' };
    if (traceStep !== undefined) return h;
    if (hoverNode) return { ...h, lit: neighbourhood(adj, hoverNode), mode: 'previewing' };
    if (hoverEdge) {
      const e = scene.edges.find((x) => x.id === hoverEdge);
      if (e) return { ...h, lit: { nodes: new Set([e.from, e.to]), edges: new Set([e.id]) }, mode: 'previewing' };
    }
    return h;
  }, [adj, focus, hoverNode, hoverEdge, pinnedEdge, linkedLit, routeEnds, routeLit, traceStep, animating, scene, arrangeOn, arrange]);

  // --- trace playback: one bounded pass over edge order ---
  const maxOrder = useMemo(() => Math.max(-1, ...scene.edges.map((e) => e.order)), [scene]);
  useEffect(() => {
    if (traceStep === undefined) return;
    if (traceStep > maxOrder) {
      const done = window.setTimeout(() => setTraceStep(undefined), 1200);
      return () => window.clearTimeout(done);
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => setTraceStep((s) => (s === undefined ? s : s + 1)), reduced ? 1200 : 850);
    return () => window.clearTimeout(id);
  }, [traceStep, maxOrder]);

  const clearAll = useCallback(() => {
    setLinkedLit(undefined);
    setFocus(undefined);
    setPinnedEdge(undefined);
    setRouteEnds([]);
    setFinderOpen(false);
    setMenuOpen(false);
  }, [setFocus]);

  const focusNode = useCallback(
    (id: string, center = false) => {
      setRouteEnds([]);
      setPinnedEdge(undefined);
      setLinkedLit(undefined);
      setFocus(id);
      const n = nodeById.get(id);
      if (center && n) pz.centerOn(n, { minK: 0.9, offsetX: pz.size.w > 700 ? 320 : 0 });
    },
    [nodeById, pz, setFocus],
  );

  // --- arranging: drag nodes to pin them ---
  const dragged = useRef(false);
  const pinOf = (id: string): [number, number] => arrange?.pins[id] ?? [0, 0];
  const onNodePointerDown = useCallback(
    (id: string, e: PointerEvent) => {
      if (!arrangeOn || e.button !== 0) return;
      e.stopPropagation(); // not a pan
      const start = { x: e.clientX, y: e.clientY };
      const [bx, by] = pinOf(id);
      const k = pz.t.k;
      let moved = false;
      let last: [number, number] = [bx, by];
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) setDragging(id);
        moved = true;
        last = [Math.round(bx + dx / k), Math.round(by + dy / k)];
        arrange!.onPin(id, last, false);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!moved) return;
        setDragging(undefined);
        arrange!.onPin(id, last[0] || last[1] ? last : undefined, true);
        // Swallow the click that ends the drag.
        dragged.current = true;
        window.setTimeout(() => (dragged.current = false), 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arrangeOn, arrange, pz.t.k],
  );
  const onNodeDoubleClick = useCallback(
    (id: string) => {
      if (arrangeOn && arrange!.pins[id]) arrange!.onPin(id, undefined, true);
    },
    [arrangeOn, arrange],
  );

  // A drag past the top-left grows the canvas there and shifts every node;
  // pan by the same amount so the diagram stays put under the pointer.
  const prevScene = useRef({ scene, pins: arrange?.pins });
  useEffect(() => {
    const prev = prevScene.current;
    prevScene.current = { scene, pins: arrange?.pins };
    if (!arrangeOn || prev.scene === scene) return;
    // Only nodes pinned neither before nor after can reveal a canvas shift.
    const before = new Map(prev.scene.nodes.map((n) => [n.id, n]));
    const moved = (id: string) => !!(arrange!.pins[id] || prev.pins?.[id]);
    const shifts = scene.nodes
      .filter((n) => before.has(n.id) && !moved(n.id))
      .map((n) => `${n.x - before.get(n.id)!.x},${n.y - before.get(n.id)!.y}`);
    if (!shifts.length) return;
    // A shift moves every such node alike; anything less is not a shift.
    const count = new Map<string, number>();
    for (const k of shifts) count.set(k, (count.get(k) ?? 0) + 1);
    const [top, n] = [...count].sort((a, b) => b[1] - a[1])[0];
    const [sx, sy] = top.split(',').map(Number);
    if (n * 2 > shifts.length && (sx || sy)) pz.panBy(-sx * pz.t.k, -sy * pz.t.k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const onNodeClick = useCallback(
    (id: string, e: MouseEvent) => {
      if (dragged.current) return e.stopPropagation(); // keep focus through a drag
      if (pz.didPan()) return;
      e.stopPropagation();
      setMenuOpen(false);
      setLinkedLit(undefined);
      // Re-checked here: an exported file's embedded Scene could be hand-edited.
      const link = safeLink(nodeById.get(id)?.link);
      if (link && (e.metaKey || e.ctrlKey)) {
        window.open(link, '_blank', 'noopener,noreferrer');
        return;
      }
      if (e.shiftKey || routeEnds.length === 1) {
        const start = routeEnds.length === 1 ? routeEnds[0] : focus;
        if (start && start !== id) {
          setFocus(undefined);
          setRouteEnds([start, id]);
        } else {
          setFocus(undefined);
          setRouteEnds([id]);
        }
        return;
      }
      setRouteEnds([]);
      setPinnedEdge(undefined);
      setFocus(focus === id ? undefined : id);
    },
    [focus, nodeById, pz, routeEnds, setFocus],
  );

  const onEdgeClick = useCallback(
    (id: string, e: MouseEvent) => {
      if (pz.didPan()) return;
      e.stopPropagation();
      setFocus(undefined);
      setRouteEnds([]);
      setLinkedLit(undefined);
      if (pinnedEdge !== id) onEdgePin?.(id);
      setPinnedEdge(pinnedEdge === id ? undefined : id);
    },
    [pz, pinnedEdge, setFocus, onEdgePin],
  );

  const handlers = useMemo(
    () => ({
      onNodeClick,
      onEdgeClick,
      onNodeEnter: setHoverNode,
      onNodeLeave: () => setHoverNode(undefined),
      ...(arrangeOn && { onNodePointerDown, onNodeDoubleClick }),
      onEdgeEnter: setHoverEdge,
      onEdgeLeave: () => setHoverEdge(undefined),
    }),
    [onNodeClick, onEdgeClick, arrangeOn, onNodePointerDown, onNodeDoubleClick],
  );

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    if (themeProp) return onThemeChange?.(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('mermaid-archify:theme', next);
    } catch {
      /* storage unavailable */
    }
    setTheme(next);
  };

  const toggleTrace = () => {
    setFocus(undefined);
    setRouteEnds([]);
    setPinnedEdge(undefined);
    setAnimating(false);
    setTraceStep((s) => (s === undefined ? 0 : undefined));
  };

  const toggleAnimate = () => {
    setTraceStep(undefined);
    setAnimating((v) => !v);
  };

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? undefined : m)), 2200);
  };

  // --- keyboard ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearAll();
        setTraceStep(undefined);
        setAnimating(false);
        return;
      }
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !isTyping(e.target))) {
        e.preventDefault();
        setFinderOpen(true);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (nudge && arrangeOn && focus && nodeById.has(focus)) {
        e.preventDefault();
        const step = e.shiftKey ? 32 : 8;
        const [x, y] = pinOf(focus);
        const next: [number, number] = [x + nudge[0] * step, y + nudge[1] * step];
        arrange!.onPin(focus, next[0] || next[1] ? next : undefined, true);
        return;
      }
      if (e.key === '+' || e.key === '=') pz.zoomBy(1.25);
      else if (e.key === '-') pz.zoomBy(0.8);
      else if (e.key === '0') pz.fit({ w: scene.width, h: scene.height }, true);
      else if (e.key === 't') toggleTrace();
      else if (e.key === ' ') {
        e.preventDefault(); // no page scroll, and a focused button is not clicked as well
        toggleAnimate();
      }
    };
    // Embedded, several viewers share a page: each only hears keys while it has focus.
    const target: HTMLElement | Window | null = embedded ? viewportRef.current : window;
    target?.addEventListener('keydown', onKey as EventListener);
    return () => target?.removeEventListener('keydown', onKey as EventListener);
  });

  const types = useMemo(() => {
    const seen = new Set<SemanticType>();
    for (const n of scene.nodes) if (n.type !== 'plain' && !['start', 'end', 'junction', 'fork', 'note', 'text'].includes(n.shape)) seen.add(n.type);
    return [...seen];
  }, [scene]);

  const pulse =
    traceStep !== undefined
      ? scene.edges
          .filter((e) => e.order === traceStep)
          .map((e) => (
            <circle key={`${e.id}-${traceStep}`} class="ma-pulse" r={4.5}>
              <animateMotion dur="0.8s" fill="freeze" {...({ path: pathD(e.points) } as object)} />
            </circle>
          ))
      : null;

  const status = (() => {
    if (routeEnds.length === 1 && !routeEnds[0]) return <>Route probe: click the start node</>;
    if (routeEnds.length === 1) return <>Route probe: pick a target for <b>{label(nodeById.get(routeEnds[0]))}</b></>;
    if (routeEnds.length === 2) {
      const [a, b] = routeEnds.map((id) => label(nodeById.get(id)));
      return routeLit ? (
        <>
          Route <b>{a}</b> → <b>{b}</b> · {routeLit.edges.size} hop{routeLit.edges.size === 1 ? '' : 's'}
        </>
      ) : (
        <>No directed route from <b>{a}</b> to <b>{b}</b></>
      );
    }
    if (pinnedEdge) {
      const e = scene.edges.find((x) => x.id === pinnedEdge);
      if (e) return <>{label(nodeById.get(e.from)) || e.from} → {label(nodeById.get(e.to)) || e.to}{e.label ? ` · ${plainText(e.label).replace(/\n/g, ' ')}` : ''}</>;
    }
    if (traceStep !== undefined) return <>Tracing · step {Math.min(traceStep, maxOrder) + 1} of {maxOrder + 1}</>;
    return toast;
  })();

  return (
    <div
      ref={viewportRef}
      class={['ma-viewer', arrangeOn && 'arranging', dragging && 'dragging', !controls && 'no-controls'].filter(Boolean).join(' ')}
      tabIndex={embedded ? 0 : -1}
      aria-label={embedded ? `${scene.title ?? `${scene.kind} diagram`} (interactive diagram)` : undefined}
      onPointerDown={
        embedded
          ? (e) => {
              // Clicking the canvas focuses this diagram (and so its shortcuts); controls take focus themselves.
              if (!hasFocusWithin(viewportRef.current) && !(e.target as Element).closest('.ma-chrome')) viewportRef.current?.focus({ preventScroll: true });
            }
          : undefined
      }
      onClick={(e) => {
        if (pz.didPan() || (e.target as Element).closest('.ma-chrome')) return;
        clearAll();
      }}
    >
      <div
        class="ma-stage"
        style={{
          transform: `translate(${pz.t.x}px, ${pz.t.y}px) scale(${pz.t.k})`,
          transition: pz.animating ? 'transform 300ms cubic-bezier(.2,.8,.2,1)' : undefined,
        }}
      >
        <Diagram scene={scene} highlight={highlight} handlers={handlers} overlay={pulse && <g>{pulse}</g>} svgRef={(el) => (svgRef.current = el)} />
      </div>

      {showTitle && scene.title && (
        <div class="ma-chrome ma-title" title={scene.title}>
          {scene.title}
          <small>{scene.kind}</small>
        </div>
      )}

      <div class="ma-chrome ma-toolbar" role="toolbar" aria-label="Diagram controls">
        <button class="ma-btn" title="Find node (/ or ⌘K)" aria-label="Find node" onClick={() => setFinderOpen(true)}>
          <Icon d={UI_ICON.search} />
        </button>
        <button
          class="ma-btn"
          title={animating ? 'Stop animation (Space)' : 'Play animation (Space)'}
          aria-label="Animate flow"
          aria-pressed={animating}
          onClick={toggleAnimate}
        >
          <Icon d={animating ? UI_ICON.stop : UI_ICON.play} />
        </button>
        <button class="ma-btn" title="Trace flow (T)" aria-label="Trace flow" aria-pressed={traceStep !== undefined} onClick={toggleTrace}>
          <Icon d={UI_ICON.trace} />
        </button>
        <button
          class="ma-btn"
          title="Route probe: shift-click two nodes"
          aria-label="Route probe"
          aria-pressed={routeEnds.length > 0}
          onClick={() => {
            setPinnedEdge(undefined);
            setRouteEnds(focus ? [focus] : routeEnds.length ? [] : ['']);
            setFocus(undefined);
          }}
        >
          <Icon d={UI_ICON.route} />
        </button>
        <span class="ma-sep" />
        <button class="ma-btn" title="Zoom out (-)" aria-label="Zoom out" onClick={() => pz.zoomBy(0.8)}>
          <Icon d={UI_ICON.minus} />
        </button>
        <span class="ma-zoom">{Math.round(pz.t.k * 100)}%</span>
        <button class="ma-btn" title="Zoom in (+)" aria-label="Zoom in" onClick={() => pz.zoomBy(1.25)}>
          <Icon d={UI_ICON.plus} />
        </button>
        <button class="ma-btn" title="Fit to screen (0)" aria-label="Fit to screen" onClick={() => pz.fit({ w: scene.width, h: scene.height }, true)}>
          <Icon d={UI_ICON.fit} />
        </button>
        <span class="ma-sep" />
        <button class="ma-btn" title="Minimap" aria-label="Toggle minimap" aria-pressed={showMap} onClick={() => setShowMap((v) => !v)}>
          <Icon d={UI_ICON.map} />
        </button>
        <button class="ma-btn" title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
          <Icon d={theme === 'dark' ? UI_ICON.sun : UI_ICON.moon} />
        </button>
        {arrange && (
          <button
            class="ma-btn"
            title={canArrange ? 'Arrange: drag nodes to place them (double-click to unpin)' : 'Sequence diagrams have a fixed layout'}
            aria-label="Arrange nodes"
            aria-pressed={arrangeOn}
            disabled={!canArrange}
            onClick={() => setArranging((v) => !v)}
          >
            <Icon d={UI_ICON.move} />
          </button>
        )}
        {toolbarExtra}
        {exports.length > 0 && (
          <span style={{ position: 'relative' }}>
            <button class="ma-btn" title="Export" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <Icon d={UI_ICON.download} />
              Export
            </button>
            {menuOpen && (
              <div class="ma-menu" role="menu">
                {exports.map((x) => (
                  <button
                    key={x.id}
                    class="ma-btn"
                    role="menuitem"
                    onClick={async () => {
                      setMenuOpen(false);
                      if (!svgRef.current) return;
                      try {
                        await x.run({ svg: svgRef.current, scene });
                      } catch (err) {
                        flash(`Export failed: ${(err as Error).message}`);
                      }
                    }}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
      </div>

      {finderOpen && (
        <Finder
          scene={scene}
          onPick={(id) => {
            setFinderOpen(false);
            focusNode(id, true);
          }}
          onClose={() => setFinderOpen(false)}
        />
      )}

      {focus && nodeById.has(focus) && (
        <Passport
          scene={scene}
          node={nodeById.get(focus)!}
          adj={adj}
          nodeById={nodeById}
          onPick={(id) => focusNode(id, true)}
          onClose={() => setFocus(undefined)}
          onCopyLink={
            linkFor
              ? async () => {
                  try {
                    await navigator.clipboard.writeText(linkFor(focus));
                    flash('Link copied');
                  } catch {
                    flash('Could not access the clipboard');
                  }
                }
              : undefined
          }
          onRoute={() => {
            setRouteEnds([focus]);
            setFocus(undefined);
          }}
          onUnpin={arrange?.pins[focus] ? () => arrange.onPin(focus, undefined, true) : undefined}
        />
      )}

      {types.length > 0 && (
        <div class="ma-chrome ma-legend" aria-label="Legend">
          {types.map((t) => (
            <span key={t}>
              <i style={{ borderColor: `var(--${t}-stroke)`, background: `var(--${t}-fill)` }} />
              {scene.kind === 'state' ? STATE_TONE_LABEL[t] : TYPE_LABEL[t]}
            </span>
          ))}
        </div>
      )}

      {showMap && pz.size.w > 0 && <Minimap scene={scene} t={pz.t} size={pz.size} onPan={pz.panTo} />}

      {status && <div class="ma-chrome ma-status" role="status">{status}</div>}
    </div>
  );
}

/** Scene-space bounds of the lit nodes and edges. */
function litBounds(scene: Scene, lit: Lit) {
  const pts: { x: number; y: number }[] = [];
  for (const n of scene.nodes) if (lit.nodes.has(n.id)) pts.push(n, { x: n.x + n.w, y: n.y + n.h });
  for (const e of scene.edges) if (lit.edges.has(e.id)) pts.push(...e.points);
  if (!pts.length) return undefined;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const label = (n: SceneNode | undefined) => (n ? (plainText(n.label) || n.id).replace(/\n/g, ' ') : '');

function Finder({ scene, onPick, onClose }: { scene: Scene; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(scene, q), [scene, q]);
  const byId = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene]);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div class="ma-chrome ma-finder" role="dialog" aria-label="Find node" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={q}
        placeholder="Find a node by name or id…"
        aria-label="Search nodes"
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === 'Enter' && results[sel]) onPick(results[sel].id);
          else if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        onBlur={() => window.setTimeout(onClose, 150)}
      />
      {q && (
        <ul role="listbox">
          {results.length === 0 && <li class="empty">No matching node</li>}
          {results.map((r, i) => {
            const n = byId.get(r.id)!;
            return (
              <li key={r.id} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(r.id)}>
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path d={TYPE_ICON[n.type]} fill="none" stroke={`var(--${n.type}-stroke)`} stroke-width="1.5" />
                </svg>
                {r.label.replace(/\n/g, ' ')}
                <small>{r.id}</small>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Passport({
  scene,
  node,
  adj,
  nodeById,
  onPick,
  onClose,
  onCopyLink,
  onRoute,
  onUnpin,
}: {
  scene: Scene;
  node: SceneNode;
  adj: ReturnType<typeof adjacency>;
  nodeById: Map<string, SceneNode>;
  onPick: (id: string) => void;
  onClose: () => void;
  onCopyLink?: () => void;
  onUnpin?: () => void;
  onRoute: () => void;
}) {
  const incoming = adj.incoming.get(node.id) ?? [];
  const outgoing = adj.outgoing.get(node.id) ?? [];
  const groupPath: string[] = [];
  let p = node.parent;
  while (p) {
    const g = scene.groups.find((x) => x.id === p);
    if (!g) break;
    groupPath.unshift(plainText(g.label));
    p = g.parent;
  }
  const kindLabel =
    scene.kind === 'state'
      ? STATE_TONE_LABEL[node.type]
      : node.shape === 'note'
        ? 'note'
        : scene.kind === 'er' && node.type === 'database'
          ? 'entity'
          : scene.kind === 'class' && node.type === 'plain'
            ? (node.annotation ?? (node.shape === 'compartment' ? 'class' : 'interface'))
            : node.type === 'plain'
              ? scene.kind === 'sequence'
                ? 'participant'
                : node.shape === 'diamond'
                  ? 'decision'
                  : 'step'
              : TYPE_LABEL[node.type];
  // ER and class relationships read both ways, so they are listed once, each with its meaning.
  const relational = scene.kind === 'er' || scene.kind === 'class';
  const relations = relational ? [...new Map([...outgoing, ...incoming].map((e) => [e.id, e])).values()] : [];
  const link = safeLink(node.link);
  const Rel = ({ other, text, dir }: { other: string; text?: string; dir: '→' | '←' }) => (
    <li>
      <button onClick={() => nodeById.has(other) && onPick(other)}>
        <span>{dir}</span>
        <span>
          {label(nodeById.get(other)) || other}
          {text && <div class="via">{plainText(text).replace(/\n/g, ' ')}</div>}
        </span>
      </button>
    </li>
  );
  return (
    <aside class="ma-chrome ma-passport" aria-label="Node details" onClick={(e) => e.stopPropagation()}>
      <header>
        <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none', marginTop: '2px' }}>
          <path d={TYPE_ICON[node.type]} fill="none" stroke={`var(--${node.type}-stroke)`} stroke-width="1.4" />
        </svg>
        <div>
          <h2>{plainText(node.label) || node.id}</h2>
          <span class="kind" style={{ color: `var(--${node.type}-stroke)` }}>
            {node.shape === 'start' ? 'start' : node.shape === 'end' ? 'end' : kindLabel}
          </span>
        </div>
        <button class="ma-btn close" aria-label="Close details" onClick={onClose}>
          <Icon d={UI_ICON.close} />
        </button>
      </header>
      {node.tooltip && <p class="tooltip">{node.tooltip}</p>}
      <dl>
        <dt>id</dt>
        <dd>{node.id}</dd>
        {groupPath.length > 0 && (
          <>
            <dt>{scene.kind === 'state' ? 'within' : 'group'}</dt>
            <dd>{groupPath.join(' › ')}</dd>
          </>
        )}
        <dt>links</dt>
        <dd>
          {incoming.length} in · {outgoing.length} out
        </dd>
        {link && (
          <>
            <dt>opens</dt>
            <dd class="href">
              <a href={link} target="_blank" rel="noopener noreferrer" title={`${link} (⌘/Ctrl-click the node)`}>
                {link}
              </a>
            </dd>
          </>
        )}
      </dl>
      {node.compartments?.map((c) => (
        <div key={c.title}>
          <h3>{c.title}</h3>
          <ul class="rows">
            {c.rows.map((r, i) => (
              <li key={i} class={r.style}>
                {r.cells.map((cell, k) => (cell ? <span key={k} class={`c-${c.cols[k]}`}>{cell}</span> : null))}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {relational ? (
        <>
          <h3>Relationships</h3>
          <ul>
            {relations.length === 0 && <li class="none">none</li>}
            {relations.map((e) => {
              const out = e.from === node.id;
              return <Rel key={e.id} other={out ? e.to : e.from} text={relationPhrase(e, node.id, scene.kind)} dir={out ? '→' : '←'} />;
            })}
          </ul>
        </>
      ) : (
        <>
          <h3>{scene.kind === 'sequence' ? 'Receives' : 'Upstream'}</h3>
          <ul>
            {incoming.length === 0 && <li class="none">none</li>}
            {incoming.map((e) => (
              <Rel key={e.id} other={e.to === node.id ? e.from : e.to} text={e.label} dir="←" />
            ))}
          </ul>
          <h3>{scene.kind === 'sequence' ? 'Sends' : 'Downstream'}</h3>
          <ul>
            {outgoing.length === 0 && <li class="none">none</li>}
            {outgoing.map((e) => (
              <Rel key={e.id} other={e.from === node.id ? e.to : e.from} text={e.label} dir="→" />
            ))}
          </ul>
        </>
      )}
      <footer>
        {onCopyLink && (
          <button class="ma-btn" onClick={onCopyLink}>
            <Icon d={UI_ICON.link} /> Copy link
          </button>
        )}
        <button class="ma-btn" onClick={onRoute} title="Pick a target to trace a directed route">
          <Icon d={UI_ICON.route} /> Route from here
        </button>
        {onUnpin && (
          <button class="ma-btn" onClick={onUnpin} title="Put this node back where the automatic layout places it">
            <Icon d={UI_ICON.move} /> Unpin
          </button>
        )}
      </footer>
    </aside>
  );
}

/** Author colours when present (not `none`/`transparent`), else the type colour. */
function minimapTint(n: SceneNode): string {
  const own = [n.style?.fill, n.style?.stroke].find((c) => c && c !== 'none' && c !== 'transparent');
  return own ?? `var(--${n.type}-stroke)`;
}

function Minimap({
  scene,
  t,
  size,
  onPan,
}: {
  scene: Scene;
  t: { x: number; y: number; k: number };
  size: { w: number; h: number };
  onPan: (x: number, y: number) => void;
}) {
  const maxW = 180;
  const maxH = 120;
  const s = Math.min(maxW / scene.width, maxH / scene.height);
  const w = scene.width * s;
  const h = scene.height * s;
  const toScene = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    onPan((e.clientX - r.left) / s, (e.clientY - r.top) / s);
  };
  return (
    <div class="ma-chrome ma-minimap" aria-hidden="true" onClick={(e) => e.stopPropagation()}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        onPointerDown={(e) => {
          (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
          toScene(e as unknown as PointerEvent);
        }}
        onPointerMove={(e) => {
          if ((e as unknown as PointerEvent).buttons) toScene(e as unknown as PointerEvent);
        }}
      >
        {scene.groups.map((g) => (
          <rect key={g.id} x={g.x} y={g.y} width={g.w} height={g.h} rx={8} fill="var(--lane-fill)" stroke="var(--lane-stroke)" stroke-width={2 / s / 4} />
        ))}
        {scene.edges.map((e) => (
          <polyline key={e.id} points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--arrow)" stroke-width={1 / s} />
        ))}
        {[...scene.nodes, ...(scene.seq?.footers ?? [])].map((n, i) => (
          <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} rx={4} fill={minimapTint(n)} opacity={0.75} />
        ))}
        <rect class="vp" x={-t.x / t.k} y={-t.y / t.k} width={size.w / t.k} height={size.h / t.k} />
      </svg>
    </div>
  );
}
