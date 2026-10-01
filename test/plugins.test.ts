// @vitest-environment node
import MarkdownIt from 'markdown-it';
import rehypeStringify from 'rehype-stringify';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, test } from 'vitest';
import { render } from '../src/node';
import markdownItMermaidArchify from '../src/node/markdown-it';
import remarkMermaidArchify, { type RemarkOptions } from '../src/node/remark';
import type { Scene } from '../src/scene/types';

const FLOW = 'flowchart LR\n  web[Web app] --> api[API]\n';
const doc = (info = 'mermaid', body = FLOW) => `# Title\n\n\`\`\`${info}\n${body}\`\`\`\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n`;

/** The JSON inside the element's application/json script, unescaped. */
const sceneIn = (html: string): Scene => JSON.parse(/<script type="application\/json">(.*?)<\/script>/s.exec(html)![1].replace(/<\\\//g, '</'));

const remarkHtml = async (md: string, opts: RemarkOptions = {}) =>
  String(await unified().use(remarkParse).use(remarkMermaidArchify, opts).use(remarkRehype).use(rehypeStringify).process(md));

describe('remark plugin', () => {
  test('replaces mermaid code blocks with a build-time scene; other code is untouched', async () => {
    const html = await remarkHtml(doc());
    expect(html).toContain('<mermaid-archify><script type="application/json">');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).not.toContain('language-mermaid');
    expect(sceneIn(html)).toEqual((await render(FLOW)).scene);
  });

  test('options and per-block info set the attributes', async () => {
    const html = await remarkHtml(doc('mermaid height=320 controls=false'), { theme: 'dark', height: 500 });
    expect(html).toContain('<mermaid-archify theme="dark" height="320" controls="false">');
  });

  test('scene JSON cannot close its script', async () => {
    const html = await remarkHtml(doc('mermaid', 'flowchart LR\n  a["</script><!--"] --> b\n'));
    const script = /<script type="application\/json">(.*?)<\/script>/s.exec(html)![1];
    expect(script).not.toMatch(/<\/script|<!--/i);
  });

  test('client mode emits the source, without rendering', async () => {
    const html = await remarkHtml(doc('mermaid', 'flowchart LR\n  a --> b{{"<b>x</b>"}}\n'), { mode: 'client' });
    expect(html).toContain('<mermaid-archify><script type="text/mermaid">flowchart LR\n  a --> b{{"<b>x</b>"}}</script></mermaid-archify>');
  });

  test('MDX gets a JSX element with the scene as an attribute', async () => {
    const processor = unified().use(remarkParse).use(remarkMdx).use(remarkMermaidArchify, { height: 300 });
    const tree = (await processor.run(processor.parse(doc()))) as unknown as { children: Record<string, unknown>[] };
    const node = tree.children[1] as { type: string; name: string; attributes: { name: string; value: string }[] };
    expect(node.type).toBe('mdxJsxFlowElement');
    expect(node.name).toBe('mermaid-archify');
    expect(node.attributes.map((a) => a.name)).toEqual(['height', 'scene-json']);
    expect(JSON.parse(node.attributes[1].value).kind).toBe('flowchart');
  });

  test('parse errors fail the build with file:line, or warn and fall back', async () => {
    const bad = doc('mermaid', 'flowchart LR\n  a -->\n');
    const file = { path: 'docs/intro.md', value: bad };
    await expect(unified().use(remarkParse).use(remarkMermaidArchify).use(remarkRehype).use(rehypeStringify).process(file)).rejects.toThrow(
      /^mermaid-archify: docs\/intro\.md:\d+: /,
    );
    const html = await remarkHtml(bad, { onError: 'warn' });
    expect(html).toContain('<script type="text/mermaid">');
  });
});

describe('markdown-it plugin', () => {
  // The default renderer blocks on a worker built into dist-node (covered by e2e/embed.spec.ts); here, a stub.
  const stub = async () => {
    const { scene } = await render(FLOW);
    const calls: string[] = [];
    return { calls, renderScene: (source: string) => (calls.push(source), scene) };
  };

  test('replaces mermaid fences and passes others to the default renderer', async () => {
    const { calls, renderScene } = await stub();
    const md = new MarkdownIt().use(markdownItMermaidArchify, { renderScene, theme: 'light' });
    const html = md.render(doc('mermaid height=300'));
    expect(html).toContain('<mermaid-archify theme="light" height="300"><script type="application/json">');
    expect(html).toContain('<pre><code class="language-js">');
    expect(sceneIn(html).kind).toBe('flowchart');
    md.render(doc('mermaid'));
    expect(calls).toEqual([FLOW]); // cached
  });

  test('client mode escapes the source', () => {
    const md = new MarkdownIt().use(markdownItMermaidArchify, { mode: 'client' });
    expect(md.render(doc('mermaid', 'flowchart LR\n  a["</script>"] --> b\n'))).toContain('a["<\\/script>"]');
  });

  test('vue: no <script>, scene in an attribute, compilation skipped', async () => {
    const { renderScene } = await stub();
    const html = new MarkdownIt().use(markdownItMermaidArchify, { renderScene, vue: true }).render(doc());
    expect(html).toMatch(/^<h1>Title<\/h1>\n<mermaid-archify v-pre scene-json="\{&quot;version&quot;:1,/);
    expect(html).not.toContain('<script');
    const client = new MarkdownIt().use(markdownItMermaidArchify, { mode: 'client', vue: true }).render(doc('mermaid', 'flowchart LR\n  a["{{ x }} <b>"] --> b\n'));
    expect(client).toContain('<mermaid-archify v-pre>flowchart LR\n  a[&quot;{{ x }} &lt;b&gt;&quot;] --&gt; b\n</mermaid-archify>');
  });

  test('errors name the file and the diagram line', () => {
    const renderScene = () => {
      throw Object.assign(new Error('Unexpected end of input'), { line: 2 });
    };
    const md = new MarkdownIt().use(markdownItMermaidArchify, { renderScene });
    // Fence on line 3; diagram line 2 is markdown line 5.
    expect(() => md.render(doc(), { relativePath: 'guide/a.md' })).toThrow('mermaid-archify: guide/a.md:5: Unexpected end of input');
  });
});
