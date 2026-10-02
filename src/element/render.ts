import ELK from 'elkjs/lib/elk.bundled.js';
import { type ElkLike, layout } from '../layout';
import { readLayoutSettings } from '../layout/settings';
import { parseMermaid } from '../parse';
import type { Scene } from '../scene/types';

/**
 * Client-side parse + layout, for `<mermaid-archify>` given Mermaid source
 * rather than a prebuilt Scene. Loaded on demand, so pages rendered at build
 * time never download Mermaid or ELK. ELK runs in-thread: there is no worker
 * file to host next to the element.
 */
let elk: ElkLike | undefined;

export async function renderScene(source: string): Promise<Scene> {
  const ir = await parseMermaid(source);
  elk ??= new ELK();
  return layout(ir, elk, readLayoutSettings(source));
}
