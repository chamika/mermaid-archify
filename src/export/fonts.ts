import fontFace from 'virtual:font-face';

/**
 * The export's text as a browser draws it anywhere, including through `<img>`, where an
 * SVG can load nothing: JetBrains Mono inline, about 85 KB. Tools that ignore CSS ignore
 * this too, so it does not apply to an SVG with baked styles.
 */
export function embedFonts(svgText: string): string {
  return svgText.replace('<style>', `<style>${fontFace}`);
}
