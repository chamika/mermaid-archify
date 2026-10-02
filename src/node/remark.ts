import { render } from './index';
import { type Attrs, DEFAULT_LANGUAGES, type EmbedOptions, cacheKey, diagramError, elementAttrs } from './embed';
import { escapeScript } from '../export/html';
import type { Scene } from '../scene/types';

export type { EmbedOptions };

export interface RemarkOptions extends EmbedOptions {
  /**
   * Emit MDX JSX (`mdxJsxFlowElement`) instead of an HTML element node. Default:
   * detected (remark-mdx in the processor, or an `.mdx` file), which covers Docusaurus.
   */
  mdx?: boolean;
}

/** The slice of mdast/unified this plugin touches; structural, so no type packages are needed. */
interface MdNode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  position?: { start: { line: number } };
  children?: MdNode[];
  [key: string]: unknown;
}
interface VFileLike {
  path?: string;
  extname?: string;
  message?: (reason: string) => unknown;
}
interface ProcessorLike {
  data?: (key: string) => unknown;
}

const cache = new Map<string, Promise<Scene>>();

/**
 * remark plugin: replaces ```` ```mermaid ```` code blocks with `<mermaid-archify>`,
 * laid out at build time. Works with remark-rehype (HTML pipelines, Astro) and
 * MDX (Docusaurus); the page still needs the element script.
 */
export default function remarkMermaidArchify(this: ProcessorLike | void, options: RemarkOptions = {}) {
  const langs = options.languages ?? DEFAULT_LANGUAGES;
  const processor = this || undefined;
  // Typed loosely so unified's own Node/VFile types are accepted without depending on them.
  return async (root: unknown, vfile?: unknown) => {
    const tree = root as MdNode;
    const file = (vfile ?? {}) as VFileLike;
    const mdx = options.mdx ?? (usesMdx(processor) || file.extname === '.mdx' || /\.mdx$/.test(file.path ?? ''));
    const jobs: Promise<void>[] = [];
    walk(tree, (node, parent, index) => {
      if (node.type !== 'code' || !node.lang || !langs.includes(node.lang)) return;
      const attrs = elementAttrs(options, node.meta);
      const source = node.value ?? '';
      const replace = (content: { scene: Scene } | { source: string }) => {
        parent.children![index] = mdx ? mdxNode(attrs, content) : hastNode(attrs, content);
      };
      if (options.mode === 'client') return replace({ source });
      jobs.push(
        sceneFor(source, options).then(
          (scene) => replace({ scene }),
          (err) => {
            const error = diagramError(err, file.path, node.position?.start.line);
            if (options.onError !== 'warn') throw error;
            console.warn(error.message);
            replace({ source });
          },
        ),
      );
    });
    await Promise.all(jobs);
  };
}

function sceneFor(source: string, options: EmbedOptions): Promise<Scene> {
  const key = cacheKey(source, options.layout);
  let scene = cache.get(key);
  if (!scene) {
    scene = render(source, { layout: options.layout }).then((r) => r.scene);
    cache.set(key, scene);
    scene.catch(() => cache.delete(key));
  }
  return scene;
}

function walk(node: MdNode, visit: (node: MdNode, parent: MdNode, index: number) => void) {
  node.children?.forEach((child, i) => {
    visit(child, node, i);
    walk(node.children![i], visit);
  });
}

/** remark-mdx registers mdast-util-mdx-jsx, whose from-markdown handlers enter `mdxJsxFlowTag`. */
function usesMdx(processor: ProcessorLike | undefined): boolean {
  const exts = processor?.data?.('fromMarkdownExtensions');
  if (!Array.isArray(exts)) return false;
  return exts.flat(Infinity).some((ext: { enter?: Record<string, unknown> }) => !!ext?.enter && 'mdxJsxFlowTag' in ext.enter);
}

/** An mdast node that mdast-util-to-hast turns into the element (via `data.hName`), with no raw HTML. */
function hastNode(attrs: Attrs, content: { scene: Scene } | { source: string }): MdNode {
  const [type, text] = 'scene' in content ? ['application/json', JSON.stringify(content.scene)] : ['text/mermaid', content.source];
  return {
    type: 'mermaidArchify',
    data: {
      hName: 'mermaid-archify',
      hProperties: Object.fromEntries(attrs),
      // hast-util-to-html writes script text verbatim, so it is escaped here.
      hChildren: [{ type: 'element', tagName: 'script', properties: { type }, children: [{ type: 'text', value: escapeScript(text) }] }],
    },
  };
}

/**
 * MDX JSX: the Scene goes in the `scene-json` attribute and the source is plain
 * text, since React escapes `<script>` text (which the HTML parser then keeps verbatim).
 */
function mdxNode(attrs: Attrs, content: { scene: Scene } | { source: string }): MdNode {
  const attr = (name: string, value: string) => ({ type: 'mdxJsxAttribute', name, value });
  const children = 'scene' in content ? [] : [{ type: 'text', value: content.source }];
  return {
    type: 'mdxJsxFlowElement',
    name: 'mermaid-archify',
    attributes: [...attrs.map(([k, v]) => attr(k, v)), ...('scene' in content ? [attr('scene-json', JSON.stringify(content.scene))] : [])],
    children,
  };
}
