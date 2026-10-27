import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const ID = 'virtual:font-face';
const WEIGHTS = [400, 600, 700];

/**
 * `virtual:font-face`: `@font-face` rules for the JetBrains Mono faces diagrams
 * use (Latin), with the fonts inline as base64, so an exported HTML file draws
 * its text the same offline as in the app. SIL Open Font License.
 */
export function fontFace(): Plugin {
  let code: string | undefined;
  return {
    name: 'font-face',
    resolveId: (id) => (id === ID ? '\0' + ID : undefined),
    load(id) {
      if (id !== '\0' + ID) return;
      if (!code) {
        const require = createRequire(import.meta.url);
        const css = WEIGHTS.map((w) => {
          const data = readFileSync(require.resolve(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`)).toString('base64');
          return `@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
        }).join('');
        code = `/* JetBrains Mono, SIL Open Font License 1.1 */\nexport default ${JSON.stringify(css)};`;
      }
      return code;
    },
  };
}
