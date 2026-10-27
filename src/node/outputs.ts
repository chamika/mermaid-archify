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
      if (await isDirectory(resolve(cwd, arg))) throw new UsageError(`${arg} is a directory; pass a quoted glob such as "${join(arg, '**/*.mmd')}"`);
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

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
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

/** Output format: from `-o`'s extension, else `--format`, else html. The two must not disagree. */
export function formatFor(opts: OutputOptions): Format {
  const ext = opts.out && opts.out !== '-' ? extname(opts.out).slice(1).toLowerCase() : '';
  const flag = opts.format?.toLowerCase();
  if (flag && !FORMATS.includes(flag as Format)) throw new UsageError(`Unknown format "${opts.format}"; use html, svg or png`);
  if (FORMATS.includes(ext as Format)) {
    if (flag && flag !== ext) throw new UsageError(`-o ${opts.out} is ${ext}, but --format says ${flag}`);
    return ext as Format;
  }
  if (flag) return flag as Format;
  if (ext) throw new UsageError(`Can't tell the format from ${opts.out}; use .html, .svg or .png, or --format`);
  return 'html';
}

/**
 * Every input's output path, decided before anything is written: two inputs
 * writing one file (`a/x.mmd b/x.mmd --out-dir out`), or an output replacing
 * its own input (`x.svg -f svg`), is a usage error rather than lost work.
 */
export function planOutputs(inputs: Input[], format: Format, opts: OutputOptions, cwd = process.cwd()): string[] {
  const targets = inputs.map((input) => outputPath(input, format, opts));
  const owner = new Map<string, string>();
  targets.forEach((target, i) => {
    if (target === '-') return;
    const key = resolve(cwd, target);
    const input = inputs[i].path;
    if (input !== '-' && resolve(cwd, input) === key) throw new UsageError(`Writing ${target} would replace its own input; use -o or --out-dir`);
    const other = owner.get(key);
    if (other !== undefined) throw new UsageError(`${other} and ${input} would both be written to ${target}; use -o or --out-dir`);
    owner.set(key, input);
  });
  return targets;
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
