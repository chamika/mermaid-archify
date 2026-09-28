import type { ExportAction } from '../viewer/Viewer';
import { download, slug } from './download';
import { svgToPng } from './png';
import { serializeSvg } from './svg';

/** SVG and PNG exports; shared by the app and the standalone viewer. */
export const imageExports: ExportAction[] = [
  {
    id: 'svg',
    label: 'SVG (current theme)',
    run: ({ svg, scene }) => download(serializeSvg(svg, scene), `${slug(scene.title, scene.kind)}.svg`, 'image/svg+xml'),
  },
  {
    id: 'png',
    label: 'PNG (2×)',
    run: async ({ svg, scene }) => download(await svgToPng(serializeSvg(svg, scene)), `${slug(scene.title, scene.kind)}.png`),
  },
];
