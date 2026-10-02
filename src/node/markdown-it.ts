import { MessageChannel, type MessagePort, Worker, receiveMessageOnPort } from 'node:worker_threads';
import { type Attrs, DEFAULT_LANGUAGES, type EmbedOptions, cacheKey, diagramError, elementAttrs, elementHtml } from './embed';
import type { LayoutSettings } from '../layout/settings';
import type { Scene } from '../scene/types';

export type { EmbedOptions };

/** The slice of markdown-it this plugin touches; structural, so markdown-it is not a dependency. */
interface Token {
  info: string;
  content: string;
  map: [number, number] | null;
}
interface MarkdownItLike {
  // Method syntax: checked bivariantly, so markdown-it's own (richer) Token type is accepted.
  renderer: { rules: { fence?(tokens: Token[], idx: number, options: unknown, env: Record<string, unknown> | undefined, self: unknown): string } };
}

export interface MarkdownItOptions extends EmbedOptions {
  /** Markup that survives Vue's template compiler. Set it for VitePress. */
  vue?: boolean;
  /** Renders one diagram synchronously. Default: Mermaid + ELK in a worker thread. */
  renderScene?: (source: string, layout?: LayoutSettings) => Scene;
}

/**
 * markdown-it plugin (VitePress, Eleventy, ...): replaces ```` ```mermaid ```` fences with
 * `<mermaid-archify>`, laid out at build time. The file name in error messages comes
 * from `env.relativePath` (VitePress) or `env.path`.
 */
export default function markdownItMermaidArchify(md: MarkdownItLike, options: MarkdownItOptions = {}): void {
  const langs = options.languages ?? DEFAULT_LANGUAGES;
  const renderScene = options.renderScene ?? renderSceneSync;
  const cache = new Map<string, Scene>();
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const [lang, ...rest] = token.info.trim().split(/\s+/);
    if (!langs.includes(lang)) return fence!(tokens, idx, opts, env, self);
    const attrs: Attrs = elementAttrs(options, rest.join(' '));
    const source = token.content;
    if (options.mode === 'client') return elementHtml(attrs, { source }, options.vue);
    const key = cacheKey(source, options.layout);
    try {
      let scene = cache.get(key);
      if (!scene) cache.set(key, (scene = renderScene(source, options.layout)));
      return elementHtml(attrs, { scene }, options.vue);
    } catch (err) {
      const file = (env?.relativePath ?? env?.path) as string | undefined;
      const error = diagramError(err, file, token.map ? token.map[0] + 1 : undefined);
      if (options.onError !== 'warn') throw error;
      console.warn(error.message);
      return elementHtml(attrs, { source }, options.vue);
    }
  };
}

let worker: { port: MessagePort; worker: Worker } | undefined;

/**
 * Mermaid's parser and ELK are async, markdown-it is not: render in a worker
 * and block on a shared flag until it answers. The worker is unref'd, so it
 * never keeps the process alive.
 */
export function renderSceneSync(source: string, layout?: LayoutSettings): Scene {
  if (!worker) {
    const { port1, port2 } = new MessageChannel();
    const w = new Worker(new URL('./render-worker.js', import.meta.url), { workerData: { port: port2 }, transferList: [port2] });
    w.unref();
    port1.unref();
    worker = { port: port1, worker: w };
  }
  const signal = new Int32Array(new SharedArrayBuffer(4));
  worker.port.postMessage({ source, layout, signal });
  if (Atomics.wait(signal, 0, 0, 60_000) === 'timed-out') throw new Error('Timed out rendering diagram');
  const reply = receiveMessageOnPort(worker.port)?.message as { scene?: Scene; error?: { message: string; line?: number } } | undefined;
  if (!reply) throw new Error('No reply from the render worker');
  if (reply.error) throw Object.assign(new Error(reply.error.message), { line: reply.error.line });
  return reply.scene!;
}
