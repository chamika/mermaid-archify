// Emitted .d.ts files keep the sources' extensionless imports ('../layout'),
// which `moduleResolution: node16/nodenext` consumers can't resolve. Rewrite
// them to explicit '.js' / '/index.js' specifiers.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../dist-node/types');

for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
  if (!file.endsWith('.d.ts')) continue;
  const path = join(root, file);
  const text = readFileSync(path, 'utf8').replace(/(from\s+|import\()(['"])(\.\.?\/[^'"]+)\2/g, (m, lead, q, spec) => {
    if (/\.(js|css)$/.test(spec)) return m;
    const target = resolve(dirname(path), spec);
    const fixed = existsSync(`${target}.d.ts`) ? `${spec}.js` : existsSync(join(target, 'index.d.ts')) ? `${spec}/index.js` : spec;
    return `${lead}${q}${fixed}${q}`;
  });
  writeFileSync(path, text);
}
