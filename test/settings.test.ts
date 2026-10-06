import { describe, expect, test } from 'vitest';
import { parseMermaid } from '../src/parse';
import { normalize, readLayoutSettings, writeLayoutSettings } from '../src/layout/settings';

const BODY = 'flowchart LR\n  A --> B\n';

describe('readLayoutSettings', () => {
  test('no front-matter means no settings', () => {
    expect(readLayoutSettings(BODY)).toEqual({});
  });

  test('reads config.archify, ignoring other keys and comments', () => {
    const src = `---\ntitle: Shop\nconfig:\n  theme: dark\n  archify:\n    # tweak\n    direction: tb\n    routing: "splines"\n    nodeSpacing: 60 # roomy\n    bogus: 1\n  flowchart:\n    curve: basis\n---\n${BODY}`;
    expect(readLayoutSettings(src)).toEqual({ direction: 'TB', routing: 'splines', nodeSpacing: 60 });
  });

  test('clamps numbers, drops invalid values and defaults', () => {
    expect(normalize({ nodeSpacing: 9999, rankSpacing: 'x', routing: 'curvy', placement: 'network-simplex', direction: 'up' })).toEqual({
      nodeSpacing: 160,
    });
    expect(normalize({ nodeSpacing: 1, rankSpacing: 72 })).toEqual({ nodeSpacing: 12 });
  });

  test('palette: known values kept, auto (the default) and junk dropped', () => {
    expect(normalize({ palette: 'Depth' })).toEqual({ palette: 'depth' });
    expect(normalize({ palette: 'auto' })).toEqual({});
    expect(normalize({ palette: 'rainbow' })).toEqual({});
    const written = writeLayoutSettings(BODY, { palette: 'mono' })!;
    expect(written).toContain('palette: mono');
    expect(readLayoutSettings(written)).toEqual({ palette: 'mono' });
    const regions = writeLayoutSettings(BODY, { palette: 'regions' })!;
    expect(regions).toContain('palette: regions');
    expect(readLayoutSettings(regions)).toEqual({ palette: 'regions' });
    expect(readLayoutSettings(writeLayoutSettings(regions, {})!)).toEqual({});
  });

  test('flow-style config is not read', () => {
    expect(readLayoutSettings(`---\nconfig: { archify: { routing: splines } }\n---\n${BODY}`)).toEqual({});
  });
});

describe('writeLayoutSettings', () => {
  const roundTrip = (src: string) => {
    const out = writeLayoutSettings(src, { routing: 'polyline', rankSpacing: 100 })!;
    expect(readLayoutSettings(out)).toEqual({ routing: 'polyline', rankSpacing: 100 });
    return out;
  };

  test('adds front-matter when there is none', () => {
    expect(roundTrip(BODY)).toBe(`---\nconfig:\n  archify:\n    rankSpacing: 100\n    routing: polyline\n---\n${BODY}`);
  });

  test('adds config to title-only front-matter', () => {
    expect(roundTrip(`---\ntitle: Shop\n---\n${BODY}`)).toBe(
      `---\ntitle: Shop\nconfig:\n  archify:\n    rankSpacing: 100\n    routing: polyline\n---\n${BODY}`,
    );
  });

  test('adds archify beside existing config keys, matching their indent', () => {
    const src = `---\nconfig:\n    theme: dark # keep me\n---\n${BODY}`;
    expect(roundTrip(src)).toBe(`---\nconfig:\n    theme: dark # keep me\n    archify:\n      rankSpacing: 100\n      routing: polyline\n---\n${BODY}`);
  });

  test('replaces only the archify block', () => {
    const src = `---\ntitle: Shop\nconfig:\n  archify:\n    direction: TB\n    routing: splines\n  theme: dark\n---\n${BODY}`;
    expect(roundTrip(src)).toBe(`---\ntitle: Shop\nconfig:\n  archify:\n    rankSpacing: 100\n    routing: polyline\n  theme: dark\n---\n${BODY}`);
  });

  test('empty settings remove the block, then empty config, then empty front-matter', () => {
    expect(writeLayoutSettings(`---\nconfig:\n  archify:\n    routing: splines\n  theme: dark\n---\n${BODY}`, {})).toBe(
      `---\nconfig:\n  theme: dark\n---\n${BODY}`,
    );
    expect(writeLayoutSettings(`---\ntitle: Shop\nconfig:\n  archify:\n    routing: splines\n---\n${BODY}`, {})).toBe(
      `---\ntitle: Shop\n---\n${BODY}`,
    );
    expect(writeLayoutSettings(`---\nconfig:\n  archify:\n    routing: splines\n---\n${BODY}`, {})).toBe(BODY);
    // Defaults count as empty.
    expect(writeLayoutSettings(BODY, { routing: 'orthogonal', nodeSpacing: 44 })).toBe(BODY);
  });

  test('refuses flow-style config', () => {
    expect(writeLayoutSettings(`---\nconfig: { theme: dark }\n---\n${BODY}`, { routing: 'splines' })).toBeUndefined();
  });

  test('keeps CRLF line endings', () => {
    const out = writeLayoutSettings('---\r\ntitle: Shop\r\n---\r\nflowchart LR\r\n  A --> B\r\n', { routing: 'splines' })!;
    expect(out).toBe('---\r\ntitle: Shop\r\nconfig:\r\n  archify:\r\n    routing: splines\r\n---\r\nflowchart LR\r\n  A --> B\r\n');
  });

  test('the written source still parses, with its title', async () => {
    const out = writeLayoutSettings(`---\ntitle: Shop\n---\n${BODY}`, { direction: 'RL', placement: 'brandes-koepf' })!;
    const ir = await parseMermaid(out);
    expect(ir.title).toBe('Shop');
    expect(ir.nodes).toHaveLength(2);
  });
});

describe('pins', () => {
  test('round-trip beside scalar settings, sorted, with awkward ids quoted', () => {
    const pins = { zeta: [10, -20], 'Order events': [0, 64], 'a:b "c"': [-3.4, 7.6], api: [40, -24] } as Record<string, [number, number]>;
    const out = writeLayoutSettings(BODY, { routing: 'splines', pins })!;
    expect(out).toBe(
      `---\nconfig:\n  archify:\n    routing: splines\n    pins:\n      "Order events": [0, 64]\n      "a:b \\"c\\"": [-3, 8]\n      api: [40, -24]\n      zeta: [10, -20]\n---\n${BODY}`,
    );
    expect(readLayoutSettings(out)).toEqual({
      routing: 'splines',
      pins: { 'Order events': [0, 64], 'a:b "c"': [-3, 8], api: [40, -24], zeta: [10, -20] },
    });
    // Writing what was read changes nothing.
    expect(writeLayoutSettings(out, readLayoutSettings(out))).toBe(out);
  });

  test('zero, non-numeric and malformed pins are dropped', () => {
    const src = `---\nconfig:\n  archify:\n    pins:\n      a: [0, 0]\n      b: [x, 2]\n      c: 5\n      d: [1, 2, 3]\n      'e': [9999999, -2] # far\n---\n${BODY}`;
    expect(readLayoutSettings(src)).toEqual({ pins: { e: [5000, -2] } });
    expect(writeLayoutSettings(BODY, { pins: { a: [0, 0] } })).toBe(BODY);
  });

  test('clearing pins keeps the other settings', () => {
    const src = writeLayoutSettings(BODY, { direction: 'TB', pins: { a: [1, 2] } })!;
    expect(writeLayoutSettings(src, { ...readLayoutSettings(src), pins: undefined })).toBe(
      `---\nconfig:\n  archify:\n    direction: TB\n---\n${BODY}`,
    );
  });

  test('pins nested one level deeper are not mistaken for settings', () => {
    const src = `---\nconfig:\n  archify:\n    pins:\n      routing: [4, 4]\n---\n${BODY}`;
    expect(readLayoutSettings(src)).toEqual({ pins: { routing: [4, 4] } });
  });
});
