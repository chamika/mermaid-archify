import { type MessagePort, workerData } from 'node:worker_threads';
import { render } from './index';
import type { LayoutSettings } from '../layout/settings';

/**
 * Worker half of `renderSync` (markdown-it renders synchronously): renders on
 * request, posts the result on the shared port, then wakes the blocked caller.
 */
const port = (workerData as { port: MessagePort }).port;
port.on('message', async ({ source, layout, signal }: { source: string; layout?: LayoutSettings; signal: Int32Array }) => {
  try {
    const { scene } = await render(source, { layout });
    port.postMessage({ scene });
  } catch (err) {
    const e = err as Error & { line?: number };
    port.postMessage({ error: { message: e.message, line: e.line } });
  }
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
