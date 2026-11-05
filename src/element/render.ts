import workerSource from 'elkjs/lib/elk-worker.min.js?raw';
import { type ElkLike, layout } from '../layout';
import { LayoutTimeoutError, workerElk } from '../layout/elk';
import { readLayoutSettings } from '../layout/settings';
import { parseMermaid } from '../parse';
import type { Scene } from '../scene/types';

/**
 * Client-side parse + layout, for `<mermaid-archify>` given Mermaid source
 * rather than a prebuilt Scene. Loaded on demand, so pages rendered at build
 * time never download Mermaid or ELK.
 *
 * ELK runs in a Web Worker started from a `blob:` URL (there is no worker file
 * to host next to the element), so a large diagram never freezes the host
 * page. A page whose CSP forbids blob workers (`worker-src` without `blob:`)
 * gets ELK in-thread instead, loaded only then.
 */
let blobUrl: string | undefined;
const inWorker = workerElk(() => new Worker((blobUrl ??= URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })))));
/** Unknown until the first layout: does a worker start on this page? */
let workers: boolean | undefined = typeof Worker === 'undefined' ? false : undefined;
let inThread: Promise<ElkLike> | undefined;

export async function renderScene(source: string): Promise<Scene> {
  const ir = await parseMermaid(source);
  const settings = readLayoutSettings(source);
  if (workers !== false) {
    try {
      const scene = await layout(ir, inWorker(), settings);
      workers = true;
      return scene;
    } catch (err) {
      if (workers || err instanceof LayoutTimeoutError) throw err;
      workers = false; // the worker never ran: fall back below
    }
  }
  inThread ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  return layout(ir, await inThread, settings);
}
