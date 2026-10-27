export function download(data: Blob | string, filename: string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari may still be reading a large file a second later.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * A file name from a title: accents folded (`Système` → `systeme`), letters and
 * digits of any script kept (`支付流程`), everything else a single dash, at most 80
 * characters.
 */
export function slug(title: string | undefined, fallback: string): string {
  const s = (title ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
  return [...s].slice(0, 80).join('').replace(/-$/, '') || fallback;
}
