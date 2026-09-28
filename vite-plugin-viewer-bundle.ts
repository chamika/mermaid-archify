import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { type Plugin, build } from 'vite';

const ID = 'virtual:viewer-bundle';

/**
 * Exposes the standalone viewer runtime (src/viewer/standalone.tsx) as a
 * minified IIFE string, for embedding in exported HTML. Built on demand, so it
 * works in dev and production builds alike.
 */
export function viewerBundle(): Plugin {
  let cache: string | undefined;
  const root = resolve(__dirname, 'src');
  return {
    name: 'viewer-bundle',
    resolveId: (id) => (id === ID ? '\0' + ID : undefined),
    async load(id) {
      if (id !== '\0' + ID) return;
      if (!cache) {
        const out = await build({
          configFile: false,
          logLevel: 'warn',
          plugins: [preact()],
          build: {
            write: false,
            minify: true,
            lib: { entry: resolve(root, 'viewer/standalone.tsx'), formats: ['iife'], name: 'MermaidArchifyViewer', fileName: () => 'viewer.js' },
            rollupOptions: { output: { inlineDynamicImports: true } },
          },
        });
        const outputs = (Array.isArray(out) ? out : [out]) as { output: { type: string; code?: string }[] }[];
        cache = outputs[0].output.find((o) => o.type === 'chunk')!.code!;
      }
      return `export default ${JSON.stringify(cache)};`;
    },
    handleHotUpdate({ file }) {
      if (file.startsWith(resolve(root, 'viewer')) || file.startsWith(resolve(root, 'export')) || file.startsWith(resolve(root, 'scene'))) {
        cache = undefined;
      }
    },
  };
}
