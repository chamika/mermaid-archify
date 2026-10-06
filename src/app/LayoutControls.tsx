import { useEffect, useRef, useState } from 'preact/hooks';
import type { Direction } from '../ir/types';
import {
  DEFAULTS,
  DIRECTIONS,
  type LayoutSettings,
  PALETTES,
  type Palette,
  PLACEMENTS,
  type Placement,
  RANGES,
  ROUTINGS,
  type Routing,
} from '../layout/settings';
import { Icon, UI_ICON } from '../viewer/icons';

interface Props {
  settings: LayoutSettings;
  onChange: (next: LayoutSettings) => void;
  /** Sequence diagrams have their own layout; the control is shown but disabled. */
  disabled?: boolean;
  /** Pins skipped because the node would collide at its offset. */
  ignoredPins?: string[];
}

const PLACEMENT_LABEL: Record<Placement, string> = {
  'network-simplex': 'Network simplex (balanced)',
  'brandes-koepf': 'Brandes–Köpf (straight edges)',
  'linear-segments': 'Linear segments (straight chains)',
  simple: 'Simple (compact)',
};

const PALETTE_TITLE: Record<Palette, string> = {
  auto: 'When no node has a component type: colour by subgraph, or by loops, decisions and failure paths if there are none',
  groups: 'Each top-level subgraph gets its own hue',
  depth: 'Shade subgraphs by nesting level',
  regions: 'Tint loops, decisions and failure paths (flowcharts)',
  mono: 'Neutral dashed subgraphs, no tints',
};

/** Toolbar popover that edits the `config.archify` layout settings. */
export function LayoutControls({ settings, onChange, disabled, ignoredPins = [] }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const set = (patch: LayoutSettings) => onChange({ ...settings, ...patch });
  const custom = Object.keys(settings).length > 0;

  return (
    <span class="ma-layout" ref={wrap}>
      <button
        class="ma-btn"
        title={disabled ? 'Sequence diagrams have a fixed layout' : 'Layout settings'}
        aria-label="Layout settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={custom}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon d={UI_ICON.layout} />
      </button>
      {open && (
        <div class="ma-menu ma-layout-panel" role="dialog" aria-label="Layout settings">
          <fieldset>
            <legend>Direction</legend>
            <div class="ma-seg">
              {([undefined, ...DIRECTIONS] as (Direction | undefined)[]).map((d) => (
                <button key={d ?? 'auto'} class="ma-btn" aria-pressed={settings.direction === d} onClick={() => set({ direction: d })}>
                  {d ?? 'Auto'}
                </button>
              ))}
            </div>
          </fieldset>

          <Slider label="Node spacing" name="nodeSpacing" value={settings.nodeSpacing} onCommit={(v) => set({ nodeSpacing: v })} />
          <Slider label="Rank spacing" name="rankSpacing" value={settings.rankSpacing} onCommit={(v) => set({ rankSpacing: v })} />

          <fieldset>
            <legend>Edge routing</legend>
            <div class="ma-seg">
              {ROUTINGS.map((r: Routing) => (
                <button key={r} class="ma-btn" aria-pressed={(settings.routing ?? DEFAULTS.routing) === r} onClick={() => set({ routing: r })}>
                  {r[0].toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>

          <label class="ma-field">
            <span>Node placement</span>
            <select
              value={settings.placement ?? DEFAULTS.placement}
              onChange={(e) => set({ placement: (e.target as HTMLSelectElement).value as Placement })}
            >
              {PLACEMENTS.map((p) => (
                <option key={p} value={p}>
                  {PLACEMENT_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>Colours</legend>
            <div class="ma-seg">
              {PALETTES.map((p) => (
                <button
                  key={p}
                  class="ma-btn"
                  title={PALETTE_TITLE[p]}
                  aria-pressed={(settings.palette ?? DEFAULTS.palette) === p}
                  onClick={() => set({ palette: p })}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>

          {settings.pins && (
            <div class="ma-field ma-pins">
              <span>
                {plural(Object.keys(settings.pins).length, 'node')} placed by hand
                {ignoredPins.length > 0 && <em title={ignoredPins.join(', ')}> · {ignoredPins.length} ignored (no room)</em>}
              </span>
              <button class="ma-btn" onClick={() => onChange({ ...settings, pins: undefined })}>
                Clear pins
              </button>
            </div>
          )}

          <div class="ma-layout-foot">
            <small>Saved in the front-matter</small>
            <button class="ma-btn" disabled={!custom} onClick={() => onChange({})}>
              Reset
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

function Slider({
  label,
  name,
  value,
  onCommit,
}: {
  label: string;
  name: keyof typeof RANGES;
  value: number | undefined;
  onCommit: (v: number) => void;
}) {
  const current = value ?? DEFAULTS[name];
  // Show the value while dragging; write the source once, on release.
  const [live, setLive] = useState(current);
  useEffect(() => setLive(current), [current]);
  const [min, max] = RANGES[name];
  return (
    <label class="ma-field">
      <span>
        {label} <output>{live}px</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={4}
        value={live}
        aria-label={label}
        onInput={(e) => setLive(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      />
    </label>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
