/**
 * Largest canvas every browser draws: Safari caps the area near 16.7 Mpx and
 * every browser caps a side; beyond that `toBlob` gives nothing.
 */
const MAX_SIDE = 16_384;
const MAX_AREA = 16_000_000;

/** The scale `svgToPng` uses for an image `w`×`h`: `scale`, or less to stay within canvas limits. */
export function pngScale(w: number, h: number, scale = 2): number {
  return Math.min(scale, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
}

/** Rasterize a serialized SVG at `scale`× (less for very large diagrams) into a PNG blob. */
export async function svgToPng(svgText: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([await withPageFonts(svgText)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const k = pngScale(img.width, img.height, scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.width * k);
    canvas.height = Math.ceil(img.height * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw an image this large; export SVG instead');
    ctx.scale(k, k);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed; export SVG instead'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * An SVG drawn as an image cannot load fonts, so it would fall back to a system
 * monospace face whose widths differ from those the layout measured. Inline the
 * page's own JetBrains Mono faces, as data URLs, into the SVG's stylesheet.
 */
async function withPageFonts(svgText: string): Promise<string> {
  const rules: string[] = [];
  const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];
  for (const sheet of sheets) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet
    }
    for (const rule of list) {
      if (!(rule instanceof CSSFontFaceRule) || !/JetBrains Mono/i.test(rule.style.getPropertyValue('font-family'))) continue;
      const src = rule.style.getPropertyValue('src');
      const inlined = await inlineUrls(src, sheet.href ?? location.href);
      if (inlined) rules.push(rule.cssText.replace(src, inlined));
    }
  }
  if (!rules.length) return svgText;
  return svgText.replace(/<style>/, `<style>${rules.join('')}`);
}

async function inlineUrls(src: string, base: string): Promise<string | undefined> {
  let out = src;
  for (const m of src.matchAll(/url\((["']?)([^"')]+)\1\)/g)) {
    if (m[2].startsWith('data:')) continue;
    try {
      const res = await fetch(new URL(m[2], base));
      if (!res.ok) return undefined;
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out = out.replace(m[0], `url(data:${res.headers.get('content-type') || 'font/woff2'};base64,${btoa(bin)})`);
    } catch {
      return undefined;
    }
  }
  return out;
}
