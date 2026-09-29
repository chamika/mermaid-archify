import type { SemanticType } from '../ir/types';

/** 16×16 line glyphs, one per semantic type. */
export const TYPE_ICON: Record<SemanticType, string> = {
  plain: 'M3.5 3.5h9v9h-9z',
  frontend: 'M2.5 3.5h11v7h-11zM6 13.5h4M8 10.5v3',
  backend: 'M2.5 2.5h11v4.5h-11zM2.5 9h11v4.5h-11zM5 4.75h.01M5 11.25h.01',
  database: 'M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2',
  cloud: 'M4.5 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7-1 2.9 2.9 0 0 1 .7 5.7 3 3 0 0 1-.9.3z',
  security: 'M8 1.8 13 3.8v3.9c0 3.2-2.1 5.4-5 6.6-2.9-1.2-5-3.4-5-6.6V3.8zM5.8 8l1.6 1.6 3-3.2',
  messagebus: 'M2 4.5h9M2 8h12M2 11.5h9M11 2.5l2 2-2 2M12 9.5l2 2-2 2',
  external: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8h12M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14M8 2C6.3 3.8 5.5 5.8 5.5 8s.8 4.2 2.5 6',
};

export const TYPE_LABEL: Record<SemanticType, string> = {
  plain: 'node',
  frontend: 'frontend',
  backend: 'service',
  database: 'data store',
  cloud: 'cloud / infra',
  security: 'security',
  messagebus: 'message bus',
  external: 'external',
};

/** State diagrams reuse the palette for outcome, so the legend speaks lifecycle. */
export const STATE_TONE_LABEL: Record<SemanticType, string> = {
  plain: 'state',
  frontend: 'in progress',
  backend: 'settled / success',
  database: 'stored',
  cloud: 'infra',
  security: 'failure',
  messagebus: 'handoff',
  external: 'waiting',
};

/** Toolbar glyphs (24×24). */
export const UI_ICON = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  trace: 'M3 12h4l3-8 4 16 3-8h4',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  close: 'M6 6l12 12M18 6 6 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
};

export function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
