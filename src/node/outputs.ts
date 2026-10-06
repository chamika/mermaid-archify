import { glob, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

export type Format = 'html' | 'svg' | 'png';
export const FORMATS: readonly Format[] = ['html', 'svg', 'png'];

export class UsageError extends Error {
  override name = 'UsageError';
}

export interface Input {
  /** Path as the user will recognise it (relative to cwd when given that way); `-` is stdin. */
  path: string;
  /** Directory that output paths under `--out-dir` are relative to. */
  base: string;
}

const GLOB_CHARS = /[*?[\]{}]/;

/** Literal leading directories of a glob: `docs/**\/*.mmd` → `docs`. */
export function globBase(pattern: string): string {
  const parts = pattern.split(/[\\/]/);
  const i = parts.findIndex((p) => GLOB_CHARS.test(p));
  return parts.slice(0, i < 0 ? parts.length - 1 : i).join('/') || '.';
}

/** Files, quoted glob patterns (expanded here, sorted) and `-` for stdin. */
export async function expandInputs(args: string[], cwd = process.cwd()): Promise<Input[]> {
  const out: Input[] = [];
  const seen = new Set<string>();
  const add = (path: string, base: string) => {
    const key = path === '-' ? '-' : resolve(cwd, path);
    if (!seen.has(key)) (seen.add(key), out.push({ path, base }));
  };
  for (const arg of args) {
    if (arg === '-') {
      add('-', '.');
    } else if (GLOB_CHARS.test(arg) && !(await isFile(resolve(cwd, arg)))) {
      const matches: string[] = [];
      for await (const m of glob(arg, { cwd })) if (await isFile(resolve(cwd, m))) matches.push(m);
      if (!matches.length) throw new UsageError(`No files match ${arg}`);
      for (const m of matches.sort()) add(m, globBase(arg));
    } else {
      if (!(await isFile(resolve(cwd, arg)))) throw new UsageError(`No such file: ${arg}`);
      add(arg, dirname(arg));
    }
  }
  return out;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export interface OutputOptions {
  /** `-o`: explicit output file, or `-` for stdout (single input only). */
  out?: string;
  /** `--out-dir`: mirror inputs (relative to their glob base) into this directory. */
  outDir?: string;
  /** `-f`: format when `-o` does not name one by its extension. */
  format?: string;
}

/** Output format: from `-o`'s extension, else `--format`, else html. */
export function formatFor(opts: OutputOptions): Format {
  const ext = opts.out && opts.out !== '-' ? extname(opts.out).slice(1).toLowerCase() : '';
  const f = (ext || opts.format || 'html').toLowerCase();
  if (!FORMATS.includes(f as Format)) {
    throw new UsageError(ext ? `Can't tell the format from ${opts.out}; use .html, .svg or .png` : `Unknown format "${f}"; use html, svg or png`);
  }
  return f as Format;
}

/** Where `input` is written; `-` means stdout. */
export function outputPath(input: Input, format: Format, opts: OutputOptions): string {
  if (opts.out) return opts.out;
  if (input.path === '-') {
    if (!opts.outDir) return '-';
    return join(opts.outDir, `diagram.${format}`);
  }
  const name = `${basename(input.path, extname(input.path))}.${format}`;
  if (!opts.outDir) return join(dirname(input.path), name);
  return join(opts.outDir, dirname(relative(input.base, input.path)), name);
}
