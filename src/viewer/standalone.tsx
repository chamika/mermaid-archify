import { render } from 'preact';
import { imageExports } from '../export/actions';
import { normalizeScene } from '../scene/normalize';
import type { Scene } from '../scene/types';
import { Viewer } from './Viewer';

/** Entry for exported HTML files: reads the embedded Scene and mounts the viewer. */
const app = document.getElementById('app')!;
let scene: Scene | undefined;
try {
  scene = normalizeScene(JSON.parse(document.getElementById('ma-scene')!.textContent!));
} catch (err) {
  // A damaged file or a newer format: say so instead of showing a blank page.
  app.textContent = `This diagram could not be opened: ${(err as Error).message}`;
  app.style.cssText = 'display:grid;place-items:center;padding:24px;font:14px/1.5 ui-monospace,monospace;color:#94a3b8';
}
const params = new URLSearchParams(location.hash.slice(1));

try {
  const saved = localStorage.getItem('mermaid-archify:theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {
  /* storage unavailable */
}

if (scene)
  render(
    <Viewer
      scene={scene}
      initialFocus={params.get('focus') ?? undefined}
      onFocusChange={(id) => history.replaceState(null, '', id ? `#focus=${encodeURIComponent(id)}` : location.pathname + location.search)}
      linkFor={(id) => `${location.href.split('#')[0]}#focus=${encodeURIComponent(id)}`}
      exports={imageExports}
    />,
    app,
  );
