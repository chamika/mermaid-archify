import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const STORE_KEY = 'mermaid-archify:source';
const LINK_KEY = 'mermaid-archify:link';

export function readHash(): { src?: string; focus?: string } {
  const params = new URLSearchParams(location.hash.slice(1));
  const packed = params.get('src');
  return {
    src: packed ? (decompressFromEncodedURIComponent(packed) ?? undefined) : undefined,
    focus: params.get('focus') ?? undefined,
  };
}

export function shareUrl(source: string, focus?: string): string {
  const params = new URLSearchParams({ src: compressToEncodedURIComponent(source) });
  if (focus) params.set('focus', focus);
  return `${location.origin}${location.pathname}#${params}`;
}

export function loadSaved(): string | undefined {
  try {
    return localStorage.getItem(STORE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function save(source: string) {
  try {
    localStorage.setItem(STORE_KEY, source);
  } catch {
    /* storage unavailable (private mode); autosave is a convenience only */
  }
}

/** Code ↔ diagram linking is on unless the user turned it off. */
export function loadLinking(): boolean {
  try {
    return localStorage.getItem(LINK_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveLinking(on: boolean) {
  try {
    localStorage.setItem(LINK_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable; the toggle still works for this session */
  }
}
