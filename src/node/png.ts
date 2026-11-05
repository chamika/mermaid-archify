import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { bakeStyles as bake } from '../export/bake';
import { withDomSync } from './dom';

/**
 * PNG without a browser: resvg rasterizes the SVG export. resvg reads presentation
 * attributes and only simple CSS, so the export's stylesheet and `var()` palette are
 * first resolved (by happy-dom's cascade) into plain attributes on every element.
 */

/**
 * The SVG export with its stylesheet and palette resolved into presentation
 * attributes: no CSS variables or `context-stroke`, for tools that lack them.
 */
export function bakeStyles(svgText: string): string {
  return withDomSync(() =>
    bake(svgText, (svg) => {
      document.body.appendChild(svg);
      return () => svg.remove();
    }),
  );
}

/** WOFF 1.0 → TrueType/OpenType: the same tables, zlib-inflated, behind an sfnt header. */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('Not a WOFF 1.0 font');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = Array.from({ length: numTables }, (_, i) => {
    const at = 44 + i * 20;
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const raw = woff.subarray(offset, offset + compLength);
    return {
      tag: woff.subarray(at, at + 4),
      checksum: woff.readUInt32BE(at + 16),
      data: compLength < origLength ? inflateSync(raw) : raw,
    };
  });
  const pad4 = (n: number) => (n + 3) & ~3;
  const headerSize = 12 + 16 * numTables;
  const out = Buffer.alloc(headerSize + tables.reduce((s, t) => s + pad4(t.data.length), 0));
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    t.tag.copy(out, at);
    out.writeUInt32BE(t.checksum, at + 4);
    out.writeUInt32BE(offset, at + 8);
    out.writeUInt32BE(t.data.length, at + 12);
    t.data.copy(out, offset);
    offset += pad4(t.data.length);
  });
  return out;
}

export const FONT_FACES = ['400-normal', '400-italic', '600-normal', '600-italic', '700-normal', '700-italic'];

let fontFiles: Promise<string[]> | undefined;

/**
 * JetBrains Mono as TrueType files resvg can load. The package ships them in
 * dist-node/fonts (scripts/lib-fonts.mjs); from source they are converted once
 * from @fontsource's WOFF files into a temp directory.
 */
function jetBrainsMono(): Promise<string[]> {
  return (fontFiles ??= (async () => {
    const name = (face: string) => `jetbrains-mono-latin-${face}.ttf`;
    for (const rel of ['./fonts/', '../fonts/']) {
      const dir = fileURLToPath(new URL(rel, import.meta.url));
      if (FONT_FACES.every((f) => existsSync(join(dir, name(f))))) return FONT_FACES.map((f) => join(dir, name(f)));
    }
    const require = createRequire(import.meta.url);
    const dir = join(tmpdir(), 'mermaid-archify-fonts');
    await mkdir(dir, { recursive: true });
    return Promise.all(
      FONT_FACES.map(async (face) => {
        const ttf = join(dir, name(face));
        if (!existsSync(ttf)) {
          const woff = require.resolve(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${face}.woff`);
          await writeFile(ttf, woffToSfnt(await readFile(woff)));
        }
        return ttf;
      }),
    );
  })());
}

/** Characters outside the bundled JetBrains Mono latin subset (CJK, emoji, Cyrillic, ...). */
const BEYOND_LATIN = /[^\u0000-\u024F\u2000-\u206F\u20AC\u2122]/u;

/** The text content of serialized SVG, entities decoded well enough to classify scripts. */
function textOf(svg: string): string {
  return [...svg.matchAll(/>([^<]+)</g)].map((m) => m[1].replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))).join('');
}

/**
 * Rasterize an SVG export (from `render`) at `scale`× without a browser, like the
 * app's PNG export. Loads the native resvg module on first use.
 */
export async function svgToPng(svgText: string, scale = 2): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js');
  const svg = bakeStyles(svgText);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    // Scanning system fonts costs as much as the render; only text the bundled faces lack needs them.
    font: { fontFiles: await jetBrainsMono(), loadSystemFonts: BEYOND_LATIN.test(textOf(svg)), defaultFontFamily: 'JetBrains Mono' },
  });
  return resvg.render().asPng();
}
