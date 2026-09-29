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
