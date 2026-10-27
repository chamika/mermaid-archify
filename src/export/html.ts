import type { Scene } from '../scene/types';

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">';

export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** JavaScript safe inside <script>: no `</script`, no `<!--`. Not for JSON or plain text, which it would alter. */
export const escapeScript = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/** JSON safe inside <script>: every `<` is written `<`, which JSON.parse reads back unchanged. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Text for a <script> element that readers take verbatim: as is under `type`
 * when it cannot close the element, else as a JSON string under `application/json`.
 */
export function scriptText(text: string, type: string): { type: string; text: string } {
  return /<\/script|<!--/i.test(text) ? { type: 'application/json', text: scriptJson(text) } : { type, text };
}

function sourceScript(source: string): string {
  const { type, text } = scriptText(source, 'text/plain');
  return `<script type="${type}" id="ma-source">${text}</script>`;
}

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
<meta name="generator" content="mermaid-archify">${scene.icons ? '\n<!-- Icons: Font Awesome Free by Fonticons, Inc., CC BY 4.0, https://fontawesome.com/license/free -->' : ''}
<title>${title}</title>
${FONT_LINK}
<style>html,body{margin:0;height:100%;background:var(--bg,#020617)}#app{position:fixed;inset:0}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="ma-scene">${scriptJson(scene)}</script>
${sourceScript(source)}
<script>${escapeScript(viewerJs)}</script>
</body>
</html>
`;
}
