import { describe, expect, test } from 'vitest';
import { isSafeColor, labelInk, mergeStyles, parseStyle, safeLink, settleInk } from '../src/ir/style';

describe('parseStyle', () => {
  test('keeps the supported properties', () => {
    expect(
      parseStyle(['fill:#f96', 'stroke: #333', 'stroke-width:4px', 'color:white', 'stroke-dasharray: 5 5', 'font-weight:bold', 'font-style:italic']),
    ).toEqual({ fill: '#f96', stroke: '#333', strokeWidth: 4, color: 'white', dash: '5 5', fontWeight: 'bold', fontStyle: 'italic' });
  });

  test('later declarations win; !important is ignored', () => {
    expect(parseStyle(['fill:red', 'fill:#00ff00 !important'])).toEqual({ fill: '#00ff00' });
  });

  test('drops unsupported properties', () => {
    expect(parseStyle(['background:red', 'font-size:40px', 'filter:blur', 'behavior:x', 'position:fixed'])).toBeUndefined();
  });

  test('rejects values that are not plain colours', () => {
    for (const bad of ['url(#x)', 'var(--text)', 'expression(alert(1))', '#12', '#gggggg', 'notacolour', 'red;fill:blue', 'rgb(1,2,3)'])
      expect(parseStyle([`fill:${bad}`]), bad).toBeUndefined();
  });

  test('clamps stroke width and restricts dasharray to numbers', () => {
    expect(parseStyle(['stroke-width:40px'])).toEqual({ strokeWidth: 6 });
    expect(parseStyle(['stroke-width:0'])).toEqual({ strokeWidth: 0.5 });
    expect(parseStyle(['stroke-width:thick'])).toBeUndefined();
    expect(parseStyle(['stroke-dasharray:4,2'])).toEqual({ dash: '4 2' });
    expect(parseStyle(['stroke-dasharray:4 calc(1)'])).toBeUndefined();
  });

  test('fill:none and stroke:none', () => {
    expect(parseStyle(['fill:none', 'stroke:none'])).toEqual({ fill: 'none', stroke: 'transparent' });
  });
});

test('mergeStyles layers field by field', () => {
  expect(mergeStyles({ fill: 'red', stroke: 'blue' }, undefined, { fill: 'green' })).toEqual({ fill: 'green', stroke: 'blue' });
  expect(mergeStyles(undefined, undefined)).toBeUndefined();
});

describe('label ink', () => {
  test('picks dark ink on light fills and light ink on dark fills', () => {
    expect(labelInk('#ffffff')).toBe('#0f172a');
    expect(labelInk('lightyellow')).toBe('#0f172a');
    expect(labelInk('#f96')).toBe('#0f172a');
    expect(labelInk('#1e3a8a')).toBe('#ffffff');
    expect(labelInk('black')).toBe('#ffffff');
  });

  test('keeps the theme text on translucent or unknown fills', () => {
    expect(labelInk('#0000ff33')).toBeUndefined();
    expect(labelInk('transparent')).toBeUndefined();
    expect(labelInk('none')).toBeUndefined();
    expect(labelInk(undefined)).toBeUndefined();
  });

  test('settleInk: explicit colour only over an opaque fill', () => {
    expect(settleInk({ color: '#fff' })).toBeUndefined();
    expect(settleInk({ stroke: 'red', color: '#fff' })).toEqual({ stroke: 'red' });
    expect(settleInk({ fill: '#1e3a8a', color: '#ff0' })).toEqual({ fill: '#1e3a8a', color: '#ff0' });
    expect(settleInk({ fill: '#1e3a8a' })).toEqual({ fill: '#1e3a8a', color: '#ffffff' });
  });
});

describe('safeLink', () => {
  test('accepts http(s) and relative links', () => {
    expect(safeLink('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLink('http://example.com')).toBe('http://example.com/');
    for (const rel of ['/docs/runbook', './a', '../b', '#x', 'page.html']) expect(safeLink(rel)).toBe(rel);
  });

  test('rejects every other scheme', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'about:blank',
      'mailto:a@b.c',
      'file:///etc/passwd',
      '',
      undefined,
    ])
      expect(safeLink(bad), String(bad)).toBeUndefined();
  });
});

test('isSafeColor still accepts sequence rect colours', () => {
  expect(isSafeColor('rgba(0, 0, 255, 0.1)')).toBe(true);
  expect(isSafeColor('#abc')).toBe(true);
  expect(isSafeColor('url(javascript:x)')).toBe(false);
});
