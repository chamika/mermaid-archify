import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import type { Direction } from '../ir/types';
import { DIRECTIONS } from '../layout/settings';
import { MermaidParseError, type Theme, render } from './index';
import { type Input, UsageError, expandInputs, formatFor, outputPath } from './outputs';

declare const __VERSION__: string;

const HELP = `Usage: mermaid-archify <input|glob|->... [options]

Render Mermaid diagrams to Archify-style interactive HTML or SVG.

Options:
  -o, --out <file|->     Output file (single input). Its extension picks the format; - is stdout.
  -d, --out-dir <dir>    Write every output here, mirroring each input's path below its glob.
  -f, --format <fmt>     html (default) or svg, when -o doesn't name one.
  -t, --theme <theme>    dark (default) or light.
      --direction <dir>  Override the diagram direction: LR, RL, TB or BT.
  -q, --quiet            Don't list written files.
  -h, --help             Show this help.
  -v, --version          Show the version.

Without -o or --out-dir, each output is written next to its input.
Quote globs ("docs/**/*.mmd") so they expand the same way on every shell.

Exit codes: 0 ok, 1 a diagram failed to render (reported as file:line: message), 2 usage error.`;

export async function main(argv: string[]): Promise<number> {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        'out-dir': { type: 'string', short: 'd' },
        format: { type: 'string', short: 'f' },
        theme: { type: 'string', short: 't' },
        direction: { type: 'string' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (err) {
    return usage((err as Error).message);
  }
  if (values.help) return (process.stdout.write(HELP + '\n'), 0);
  if (values.version) return (process.stdout.write(__VERSION__ + '\n'), 0);

  let inputs: Input[];
  let format;
  const theme = (values.theme ?? 'dark').toLowerCase() as Theme;
  const direction = values.direction?.toUpperCase() as Direction | undefined;
  const opts = { out: values.out, outDir: values['out-dir'], format: values.format };
  try {
    if (!positionals.length) throw new UsageError('No input files');
    if (theme !== 'dark' && theme !== 'light') throw new UsageError(`Unknown theme "${values.theme}"; use dark or light`);
    if (direction && !DIRECTIONS.includes(direction)) throw new UsageError(`Unknown direction "${values.direction}"; use ${DIRECTIONS.join(', ')}`);
    if (opts.out && opts.outDir) throw new UsageError('Use either -o or --out-dir, not both');
    format = formatFor(opts);
    inputs = await expandInputs(positionals);
    if (opts.out && inputs.length > 1) throw new UsageError(`-o takes a single input (got ${inputs.length}); use --out-dir`);
  } catch (err) {
    if (err instanceof UsageError) return usage(err.message);
    throw err;
  }

  let failed = 0;
  for (const input of inputs) {
    const name = input.path === '-' ? '<stdin>' : input.path;
    try {
      const source = input.path === '-' ? await readStdin() : await readFile(input.path, 'utf8');
      const result = await render(source, { theme, layout: direction ? { direction } : undefined });
      const target = outputPath(input, format, opts);
      if (target === '-') {
        process.stdout.write(result[format]);
      } else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, result[format]);
        if (!values.quiet) process.stderr.write(`${name} → ${target}\n`);
      }
    } catch (err) {
      failed++;
      if (err instanceof MermaidParseError) {
        process.stderr.write(`${name}${err.line !== undefined ? `:${err.line}` : ''}: ${err.message}\n`);
      } else {
        process.stderr.write(`${name}: ${(err as Error)?.stack ?? err}\n`);
      }
    }
  }
  if (failed && inputs.length > 1) process.stderr.write(`${failed} of ${inputs.length} diagrams failed\n`);
  return failed ? 1 : 0;
}

function usage(message: string): number {
  process.stderr.write(`mermaid-archify: ${message}\nRun mermaid-archify --help for usage.\n`);
  return 2;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (err) => {
    process.stderr.write(`mermaid-archify: ${(err as Error)?.stack ?? err}\n`);
    process.exitCode = 1;
  },
);
