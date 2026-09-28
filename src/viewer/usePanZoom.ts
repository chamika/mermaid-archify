import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Box } from '../scene/types';

export interface Transform {
  x: number;
  y: number;
  k: number;
}

const MIN_K = 0.1;
const MAX_K = 4;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

export interface PanZoom {
  t: Transform;
  animating: boolean;
  size: { w: number; h: number };
  /** True right after a drag, so the trailing click can be ignored. */
  didPan: () => boolean;
  zoomBy: (factor: number, at?: { x: number; y: number }) => void;
  fit: (content: { w: number; h: number }, animate?: boolean) => void;
  centerOn: (box: Box, opts?: { minK?: number; animate?: boolean; offsetX?: number }) => void;
  panTo: (sceneX: number, sceneY: number) => void;
}

/** Pan/zoom over a CSS-transformed stage. Wheel pans, ctrl/⌘+wheel or pinch zooms. */
export function usePanZoom(viewport: { current: HTMLElement | null }): PanZoom {
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [animating, setAnimating] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const panned = useRef(false);
  const animTimer = useRef<number>();

  const apply = useCallback((next: Transform, animate = false) => {
    window.clearTimeout(animTimer.current);
    setAnimating(animate);
    if (animate) animTimer.current = window.setTimeout(() => setAnimating(false), 320);
    setT(next);
  }, []);

  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      const el = viewport.current;
      if (!el) return;
      const cur = tRef.current;
      const p = at ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      const k = clampK(cur.k * factor);
      const r = k / cur.k;
      apply({ k, x: p.x - (p.x - cur.x) * r, y: p.y - (p.y - cur.y) * r }, !at);
    },
    [apply, viewport],
  );

  const fit = useCallback(
    (content: { w: number; h: number }, animate = false) => {
      const el = viewport.current;
      if (!el || !content.w || !content.h) return;
      const pad = 56;
      const k = clampK(Math.min((el.clientWidth - pad * 2) / content.w, (el.clientHeight - pad * 2) / content.h, 1.25));
      apply({ k, x: (el.clientWidth - content.w * k) / 2, y: (el.clientHeight - content.h * k) / 2 + 12 }, animate);
    },
    [apply, viewport],
  );

  const centerOn = useCallback(
    (box: Box, opts: { minK?: number; animate?: boolean; offsetX?: number } = {}) => {
      const el = viewport.current;
      if (!el) return;
      const k = Math.max(tRef.current.k, opts.minK ?? 0);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const vw = el.clientWidth - (opts.offsetX ?? 0);
      apply({ k, x: vw / 2 - cx * k, y: el.clientHeight / 2 - cy * k }, opts.animate ?? true);
    },
    [apply, viewport],
  );

  const panTo = useCallback(
    (sx: number, sy: number) => {
      const el = viewport.current;
      if (!el) return;
      const { k } = tRef.current;
      apply({ k, x: el.clientWidth / 2 - sx * k, y: el.clientHeight / 2 - sy * k });
    },
    [apply, viewport],
  );

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const scale = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        zoomBy(Math.exp((-e.deltaY * scale) / 300), at);
      } else {
        const cur = tRef.current;
        apply({ ...cur, x: cur.x - e.deltaX * scale, y: cur.y - e.deltaY * scale });
      }
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; t: Transform } | undefined;
    let pinch: { d: number; k: number } | undefined;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('.ma-chrome')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      panned.current = false;
      start = { x: e.clientX, y: e.clientY, t: tRef.current };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: tRef.current.k };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !start) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const rect = el.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
        const target = pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
        zoomBy(target / tRef.current.k, mid);
        panned.current = true;
        return;
      }
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!panned.current && Math.hypot(dx, dy) < 4) return;
      if (!panned.current) {
        panned.current = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add('is-panning');
      }
      apply({ ...start.t, x: start.t.x + dx, y: start.t.y + dy });
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = undefined;
      if (!pointers.size) start = undefined;
      el.classList.remove('is-panning');
      // Leave `panned` set until after the click event fires.
      window.setTimeout(() => (panned.current = false), 0);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [apply, viewport, zoomBy]);

  return { t, animating, size, didPan: () => panned.current, zoomBy, fit, centerOn, panTo };
}
