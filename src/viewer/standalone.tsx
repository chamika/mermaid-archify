import { render } from 'preact';
import { imageExports } from '../export/actions';
import type { Scene } from '../scene/types';
import { Viewer } from './Viewer';

/** Entry for exported HTML files: reads the embedded Scene and mounts the viewer. */
const scene: Scene = JSON.parse(document.getElementById('ma-scene')!.textContent!);
const params = new URLSearchParams(location.hash.slice(1));

try {
  const saved = localStorage.getItem('mermaid-archify:theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {
  /* storage unavailable */
}

render(
  <Viewer
    scene={scene}
    initialFocus={params.get('focus') ?? undefined}
    onFocusChange={(id) => history.replaceState(null, '', id ? `#focus=${encodeURIComponent(id)}` : location.pathname + location.search)}
    linkFor={(id) => `${location.href.split('#')[0]}#focus=${encodeURIComponent(id)}`}
    exports={imageExports}
  />,
  document.getElementById('app')!,
);
