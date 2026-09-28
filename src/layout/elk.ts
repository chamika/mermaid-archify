import ELK from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { ElkLike } from './elkGraph';

let instance: ElkLike | undefined;

/** Browser ELK instance; layout runs in a Web Worker so typing never blocks. */
export function browserElk(): ElkLike {
  instance ??= new ELK({ workerUrl });
  return instance;
}
