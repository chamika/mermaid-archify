// Delete Cloudflare Pages preview deployments for PR branches (`pr-<n>`).
//
//   node scripts/pages-cleanup.mjs --pr 17          delete every deployment of branch pr-17
//   node scripts/pages-cleanup.mjs --sweep 3,5,12   delete every pr-* branch except the listed open PRs
//
// Needs CLOUDFLARE_API_TOKEN (Account → Cloudflare Pages → Edit) and CLOUDFLARE_ACCOUNT_ID.
// Only branches named exactly `pr-<number>` are ever touched, so production (`main`) is safe.
// Exits non-zero on any API failure or if a targeted deployment survives.

const PROJECT = process.env.PAGES_PROJECT ?? 'mermaid-archify';
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');

const [mode, arg = ''] = process.argv.slice(2);
let isTarget;
if (mode === '--pr' && /^\d+$/.test(arg)) {
  isTarget = (branch) => branch === `pr-${arg}`;
} else if (mode === '--sweep') {
  const open = new Set(arg.split(/[\s,]+/).filter(Boolean));
  isTarget = (branch) => /^pr-\d+$/.test(branch) && !open.has(branch.slice(3));
} else {
  throw new Error('usage: pages-cleanup.mjs --pr <number> | --sweep <open PR numbers, comma-separated>');
}

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}/deployments`;

async function api(url, init) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body;
}

// Collect everything before deleting: deleting while paging shifts later pages.
async function targets() {
  const found = [];
  for (let page = 1; ; page++) {
    const { result, result_info: info } = await api(`${base}?env=preview&per_page=25&page=${page}`);
    for (const d of result) {
      const branch = d.deployment_trigger?.metadata?.branch ?? '';
      if (isTarget(branch)) found.push({ id: d.id, branch, url: d.url });
    }
    if (result.length === 0 || page >= (info?.total_pages ?? page)) return found;
  }
}

const doomed = await targets();
console.log(`${doomed.length} preview deployment(s) to delete`);
for (const d of doomed) {
  // force=true is required to delete a deployment that a branch alias points at.
  await api(`${base}/${d.id}?force=true`, { method: 'DELETE' });
  console.log(`deleted ${d.branch} ${d.id} ${d.url}`);
}

const left = await targets();
if (left.length) {
  console.error(`still present: ${left.map((d) => `${d.branch} ${d.id}`).join(', ')}`);
  process.exit(1);
}
console.log('clean');
