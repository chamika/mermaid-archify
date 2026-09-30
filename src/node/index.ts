import ELK from 'elkjs/lib/elk.bundled.js';
import { h, render as renderPreact } from 'preact';
import viewerJs from 'virtual:viewer-bundle';
import { buildStandaloneHtml } from '../export/html';
import { serializeSvg, themeTokens } from '../export/svg';
import { type ElkLike, layout } from '../layout';
import { type LayoutSettings, readLayoutSettings } from '../layout/settings';
import { MermaidParseError, parseMermaid } from '../parse';
import type { Scene } from '../scene/types';
import { Diagram } from '../viewer/Diagram';
import { ensureDom } from './dom';

export { MermaidParseError };
export type { LayoutSettings, Scene };

export type Theme = 'light' | 'dark';

export interface RenderOptions {
  /** Palette baked into the SVG and the HTML's initial theme. Default `'dark'`, as in the app. */
  theme?: Theme;
  /** Overrides the layout settings in the source's front-matter (`config.archify`). */
  layout?: LayoutSettings;
}

export interface RenderResult {
  /** The laid-out diagram. */
  scene: Scene;
  /** Standalone SVG, identical to the app's SVG export. */
  svg: string;
  /** Single-file interactive HTML, identical to the app's HTML export. */
  html: string;
}

let elk: ElkLike | undefined;

/** Render Mermaid source headlessly. Rejects with `MermaidParseError` (with `.line`) on invalid input. */
export async function render(source: string, options: RenderOptions = {}): Promise<RenderResult> {
  ensureDom();
  const theme = options.theme ?? 'dark';
  const ir = await parseMermaid(source);
  elk ??= new ELK();
  const scene = await layout(ir, elk, { ...readLayoutSettings(source), ...options.layout });
  return { scene, svg: sceneToSvg(scene, theme), html: buildStandaloneHtml(scene, source, viewerJs, theme) };
}

/** Draw the Scene with the viewer's own Diagram component, then serialize it like the app does. */
function sceneToSvg(scene: Scene, theme: Theme): string {
  const host = document.createElement('div');
  renderPreact(h(Diagram, { scene }), host);
  try {
    return serializeSvg(host.querySelector('svg')!, scene, themeTokens(theme));
  } finally {
    renderPreact(null, host);
  }
}
