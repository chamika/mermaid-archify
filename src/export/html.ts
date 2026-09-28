import type { Scene } from '../scene/types';

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">';

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Safe inside <script>: no `</script`, no `<!--`. */
const escapeScript = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/**
 * A single offline HTML file: the prebuilt viewer runtime + the laid-out Scene.
 * It needs neither Mermaid nor ELK to open, and keeps every interaction.
 */
export function buildStandaloneHtml(scene: Scene, source: string, viewerJs: string, theme: 'light' | 'dark'): string {
  const title = escapeHtml(scene.title ?? `${scene.kind} diagram`);
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="mermaid-archify">
<title>${title}</title>
${FONT_LINK}
<style>html,body{margin:0;height:100%;background:var(--bg,#020617)}#app{position:fixed;inset:0}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="ma-scene">${escapeScript(JSON.stringify(scene))}</script>
<script type="text/plain" id="ma-source">${escapeScript(source)}</script>
<script>${escapeScript(viewerJs)}</script>
</body>
</html>
`;
}
