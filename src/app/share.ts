import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const STORE_KEY = 'mermaid-archify:source';
const LINK_KEY = 'mermaid-archify:link';

/**
 * lz-string can expand a short string enormously (30 KB of hash → 100M characters),
 * so links are capped both packed and unpacked. Real diagrams are far smaller.
 */
const MAX_PACKED = 32_768;
const MAX_SOURCE = 500_000;

/** Source and focus from a share link. A missing, truncated or oversized `src` reads as no source. */
export function readHash(hash = location.hash): { src?: string; focus?: string } {
  const params = new URLSearchParams(hash.slice(1));
  const packed = params.get('src');
  let src: string | undefined;
  if (packed && packed.length <= MAX_PACKED) {
    const text = decompressFromEncodedURIComponent(packed);
    if (text && text.length <= MAX_SOURCE && text.trim()) src = text;
  }
  return { src, focus: params.get('focus') ?? undefined };
}

/** The current URL without a share link's `src`, so a reload shows the autosaved edits rather than the link. */
export function urlWithoutSource(): string {
  const params = new URLSearchParams(location.hash.slice(1));
  params.delete('src');
  const rest = params.toString();
  return `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`;
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
