import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const ID = 'virtual:fa-icons';
const STYLES = ['solid', 'regular', 'brands'] as const;

/** [width, height, path d] per icon name, per style. */
export type FaTable = Record<(typeof STYLES)[number], Record<string, [number, number, string]>> & {
  /** FA4 names renamed later: old name → [style or '', new name]. */
  shims: Record<string, [string, string]>;
  version: string;
};

/** Read Font Awesome Free's SVGs into a compact table (build time only). */
export function buildFaTable(): FaTable {
  const root = dirname(createRequire(import.meta.url).resolve('@fortawesome/fontawesome-free/package.json'));
  const table = { shims: {}, version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version } as FaTable;
  for (const style of STYLES) {
    table[style] = {};
    for (const file of readdirSync(join(root, 'svgs', style))) {
      const svg = readFileSync(join(root, 'svgs', style, file), 'utf8');
      const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
      const paths = [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map((m) => m[1]);
      if (box && paths.length) table[style][file.replace(/\.svg$/, '')] = [Number(box[1]), Number(box[2]), paths.join(' ')];
    }
  }
  // shims.yml: "old-name:\n  prefix: far\n  name: new-name"
  const shims = readFileSync(join(root, 'metadata', 'shims.yml'), 'utf8');
  for (const block of shims.split(/\n(?=[^\s])/)) {
    const old = /^([\w-]+):/.exec(block)?.[1];
    const name = /\n\s+name: ([\w-]+)/.exec(block)?.[1];
    const prefix = /\n\s+prefix: (\w+)/.exec(block)?.[1] ?? '';
    if (old && name) table.shims[old] = [prefix, name];
  }
  return table;
}

/**
 * `virtual:fa-icons`: the Font Awesome Free icon table as a lazily imported
 * module. Icons are CC BY 4.0 (https://fontawesome.com/license/free).
 */
export function faIcons(): Plugin {
  let code: string | undefined;
  return {
    name: 'fa-icons',
    resolveId: (id) => (id === ID ? '\0' + ID : undefined),
    load(id) {
      if (id !== '\0' + ID) return;
      code ??= `/* Font Awesome Free — icons CC BY 4.0, https://fontawesome.com/license/free */\nexport default ${JSON.stringify(buildFaTable())};`;
      return code;
    },
  };
}
