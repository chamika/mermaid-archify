import { compressToEncodedURIComponent } from 'lz-string';
import { expect, test } from 'vitest';
import { readHash } from '../src/app/share';

const link = (source: string, focus?: string) =>
  `#${new URLSearchParams({ src: compressToEncodedURIComponent(source), ...(focus && { focus }) })}`;

test('reads the source and focus of a share link', () => {
  expect(readHash(link('flowchart LR\n  a --> b', 'a'))).toEqual({ src: 'flowchart LR\n  a --> b', focus: 'a' });
});

test('missing, truncated, blank and oversized links read as no source', () => {
  expect(readHash('')).toEqual({ src: undefined, focus: undefined });
  expect(readHash('#src=').src).toBeUndefined();
  expect(readHash('#src=abc').src).toBeUndefined(); // decompresses to ""
  expect(readHash(link('   \n')).src).toBeUndefined();
  // A few KB of hash that would expand to a million characters.
  const bomb = link('a'.repeat(1_000_000));
  expect(bomb.length).toBeLessThan(10_000);
  expect(readHash(bomb).src).toBeUndefined();
  expect(readHash(`#src=${'A'.repeat(40_000)}`).src).toBeUndefined();
});
