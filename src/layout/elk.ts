import ELK from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { ElkLike } from './elkGraph';

/** Longest a layout may run before it is abandoned (ELK takes ~40 s on a complete graph of 30 nodes). */
export const LAYOUT_TIMEOUT_MS = 20_000;

export class LayoutTimeoutError extends Error {
  constructor() {
    super(`Layout took longer than ${LAYOUT_TIMEOUT_MS / 1000} s. Try fewer edges, or polyline routing.`);
    this.name = 'LayoutTimeoutError';
  }
}

/**
 * ELK in a Web Worker. A layout that is superseded (`signal`), runs past
 * LAYOUT_TIMEOUT_MS or crashes the worker ends that worker, since ELK cannot be
 * interrupted any other way; the next layout starts a fresh one.
 */
export function workerElk(makeWorker: () => Worker): (signal?: AbortSignal) => ElkLike {
  let current: { elk: InstanceType<typeof ELK>; crashed: Promise<never> } | undefined;
  const stop = () => {
    current?.elk.terminateWorker();
    current = undefined;
  };
  const start = () => {
    let crash!: (err: Error) => void;
    const crashed = new Promise<never>((_, reject) => (crash = reject));
    crashed.catch(() => undefined);
    const elk = new ELK({
      workerFactory: () => {
        const worker = makeWorker();
        worker.addEventListener('error', (e) => crash(new Error(e.message || 'The layout worker stopped')));
        return worker;
      },
    });
    return { elk, crashed };
  };

  return (signal) => ({
    layout(graph) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      current ??= start();
      const { elk, crashed } = current;
      return new Promise((resolve, reject) => {
        const fail = (err: unknown) => {
          stop();
          reject(err);
        };
        const timer = setTimeout(() => fail(new LayoutTimeoutError()), LAYOUT_TIMEOUT_MS);
        const onAbort = () => fail(signal!.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.race([elk.layout(graph), crashed])
          .then(resolve, fail)
          .finally(() => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
          });
      });
    },
  });
}

/** Browser ELK for the app; layout runs in a Web Worker so typing never blocks. */
export const browserElk = workerElk(() => new Worker(workerUrl));
