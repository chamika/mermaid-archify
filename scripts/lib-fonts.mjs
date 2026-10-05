// resvg (PNG output) loads TrueType/OpenType files only; @fontsource ships WOFF.
// Convert the JetBrains Mono faces the diagrams use into dist-node/fonts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { FONT_FACES, woffToSfnt } from '../dist-node/png.js';

const require = createRequire(import.meta.url);
const dir = resolve(import.meta.dirname, '../dist-node/fonts');
mkdirSync(dir, { recursive: true });
for (const face of FONT_FACES) {
  const woff = readFileSync(require.resolve(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${face}.woff`));
  writeFileSync(resolve(dir, `jetbrains-mono-latin-${face}.ttf`), woffToSfnt(woff));
}
// SIL Open Font License: the font's licence travels with it.
writeFileSync(resolve(dir, 'LICENSE'), readFileSync(require.resolve('@fontsource/jetbrains-mono/LICENSE')));
