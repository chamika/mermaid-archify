/**
 * Author styles from Mermaid source (`style`, `classDef`, `linkStyle`) and
 * `click` links, reduced to a small, validated vocabulary. Nothing here is
 * ever a raw CSS string: the renderer maps each field onto a custom property,
 * so diagram source cannot inject arbitrary CSS into the app or its exports.
 */

export interface IRStyle {
  fill?: string;
  stroke?: string;
  /** px, clamped to a range that keeps shapes and hit targets intact. */
  strokeWidth?: number;
  /** Numbers only, space separated. */
  dash?: string;
  /** Label ink; only kept on nodes with an opaque fill (see `settleInk`). */
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
}

/** CSS named colours → #rrggbb. */
const NAMED: Record<string, string> = Object.fromEntries(
  (
    'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 ' +
    'blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
    'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b ' +
    'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b ' +
    'darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f ' +
    'darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 ' +
    'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 ' +
    'fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f ' +
    'grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
    'lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
    'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a ' +
    'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de ' +
    'lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa ' +
    'mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
    'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa ' +
    'mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 ' +
    'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee ' +
    'palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 ' +
    'purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 ' +
    'sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd ' +
    'slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 ' +
    'tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'
  )
    .split(' ')
    .map((pair) => pair.split(':')),
);

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A colour we can emit verbatim: hex, a CSS named colour, or `transparent`. */
function authorColor(v: string): string | undefined {
  const c = v.trim().toLowerCase();
  if (HEX.test(c) || NAMED[c] || c === 'transparent') return c;
  return undefined;
}

/**
 * Colour check for sequence `rect <colour>` bands, which Mermaid passes
 * through verbatim and which do allow `rgb()`/`hsl()`.
 */
export function isSafeColor(c: string): boolean {
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i.test(c.trim());
}

/**
 * Parse `prop:value` declarations (later ones win) into an IRStyle, keeping
 * only the properties we render and values that validate.
 */
export function parseStyle(decls: readonly string[] | undefined): IRStyle | undefined {
  const s: IRStyle = {};
  for (const decl of decls ?? []) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl
      .slice(i + 1)
      .replace(/\s*!important\s*$/i, '')
      .trim();
    switch (prop) {
      case 'fill': {
        const c = value.toLowerCase() === 'none' ? 'none' : authorColor(value);
        if (c) s.fill = c;
        break;
      }
      case 'stroke': {
        const c = value.toLowerCase() === 'none' ? 'transparent' : authorColor(value);
        if (c) s.stroke = c;
        break;
      }
      case 'color': {
        const c = authorColor(value);
        if (c) s.color = c;
        break;
      }
      case 'stroke-width': {
        const m = /^(\d+(?:\.\d+)?|\.\d+)(px)?$/i.exec(value);
        if (m) s.strokeWidth = Math.min(6, Math.max(0.5, Number(m[1])));
        break;
      }
      case 'stroke-dasharray': {
        const nums = value.split(/[\s,]+/).filter(Boolean);
        if (nums.length && nums.length <= 8 && nums.every((n) => /^\d+(\.\d+)?(px)?$/i.test(n)))
          s.dash = nums.map((n) => String(Math.min(100, parseFloat(n)))).join(' ');
        break;
      }
      case 'font-weight':
        if (/^(normal|bold|[1-9]00)$/i.test(value)) s.fontWeight = value.toLowerCase();
        break;
      case 'font-style':
        if (/^(normal|italic)$/i.test(value)) s.fontStyle = value.toLowerCase();
        break;
    }
  }
  return Object.keys(s).length ? s : undefined;
}

/** Merge style layers; later layers override field by field. */
export function mergeStyles(...layers: (IRStyle | undefined)[]): IRStyle | undefined {
  const out = Object.assign({}, ...layers.filter(Boolean)) as IRStyle;
  return Object.keys(out).length ? out : undefined;
}

/** [r, g, b, a] with channels 0–255 and alpha 0–1. */
function rgba(c: string): [number, number, number, number] | undefined {
  const v = c.toLowerCase();
  const hex = NAMED[v] ? `#${NAMED[v]}` : v;
  if (!HEX.test(hex)) return undefined;
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((x) => x + x).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

const DARK_INK = '#0f172a';
const LIGHT_INK = '#ffffff';

/**
 * Label ink that reads on `fill` regardless of theme: dark or light by WCAG
 * contrast. Undefined when the fill is translucent or unknown, where the
 * theme's own text colour is the right choice.
 */
export function labelInk(fill: string | undefined): string | undefined {
  const c = fill && rgba(fill);
  if (!c || c[3] < 0.5) return undefined;
  const lin = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  // Contrast against white vs. against the dark ink (L ≈ 0.0103).
  return (1.05 / (L + 0.05) >= (L + 0.05) / 0.0603 ? LIGHT_INK : DARK_INK);
}

/**
 * Final node style: `color` survives only on an opaque fill (a fixed ink on
 * a theme background is unreadable in one of the two themes); an opaque fill
 * without `color` gets a contrast-picked ink.
 */
export function settleInk(style: IRStyle | undefined): IRStyle | undefined {
  if (!style) return undefined;
  const ink = labelInk(style.fill);
  const { color, ...rest } = style;
  if (!ink) return Object.keys(rest).length ? rest : undefined;
  return { ...rest, color: color ?? ink };
}

/**
 * A `click` target we are willing to open: http(s) URLs and relative links.
 * Everything else (javascript:, data:, vbscript:, mailto:, Mermaid's
 * `about:blank` replacement) is rejected.
 */
export function safeLink(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const link = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!link || link.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(link)) return undefined;
  let url: URL;
  try {
    url = new URL(link, 'https://relative.invalid/');
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  return url.hostname === 'relative.invalid' ? link : url.href;
}
