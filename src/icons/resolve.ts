import type { IconDef, IconSet } from './fa';

/*
 * Icon resolution, used by the parser only. It lazily loads the full Font
 * Awesome table; the viewer never imports this (scenes carry resolved paths),
 * which keeps the exported-HTML runtime small.
 */

type Table = Record<'solid' | 'regular' | 'brands', Record<string, IconDef>> & { shims: Record<string, [string, string]> };

const SEARCH: Record<string, ('solid' | 'regular' | 'brands')[]> = {
  fa: ['solid', 'regular', 'brands'],
  fas: ['solid'],
  far: ['regular', 'solid'],
  fal: ['solid', 'regular'], // Pro-only styles fall back to Free equivalents
  fab: ['brands'],
};
const SHIM_STYLE: Record<string, 'solid' | 'regular' | 'brands'> = { fas: 'solid', far: 'regular', fab: 'brands' };

let table: Promise<Table> | undefined;
const loadTable = () => (table ??= import('virtual:fa-icons').then((m) => m.default as unknown as Table));

/** Own keys only: label text such as `fa:fa-constructor` must not find Object.prototype members. */
const own = <V>(o: Record<string, V> | undefined, key: string): V | undefined => (o && Object.hasOwn(o, key) ? o[key] : undefined);

function lookup(t: Table, style: string, name: string): IconDef | undefined {
  for (const s of own(SEARCH, style) ?? []) if (own(t[s], name)) return t[s][name];
  const shim = own(t.shims, name);
  if (shim) {
    const styles = shim[0] ? [SHIM_STYLE[shim[0]]] : (own(SEARCH, style) ?? []);
    for (const s of styles) if (own(t[s], shim[1])) return t[s][shim[1]];
  }
  return undefined;
}

/** Resolve `style:name` keys; unknown icons (or `fak:` custom kits) are left out. */
export async function resolveIcons(keys: string[]): Promise<IconSet> {
  if (!keys.length) return {};
  const t = await loadTable();
  const out: IconSet = {};
  for (const key of new Set(keys)) {
    const [style, name] = key.split(':');
    const def = lookup(t, style, name);
    if (def) out[key] = def;
  }
  return out;
}
