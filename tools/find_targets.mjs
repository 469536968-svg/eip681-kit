// tools/find_targets.mjs — find open, current EIP-681 problems worth a technical reply.
//
// Not a scraper for volume: it exists to answer one question — "is there a repo where
// someone is STUCK right now on something I have already verified, and where I have not
// already replied?" A repo with no recent activity or no engagement is not a target.
//
//   node tools/find_targets.mjs

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) { console.error('no GITHUB_TOKEN'); process.exit(1); }

const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'qiming-recon' };
const ME = '469536968-svg';

// Every thread I have already posted to. Never touch these again (D6 boundary 5).
const ALREADY = new Set([
  'paritytech/getcash-community#54',
  'btcpayserver-tether/BTCPayServer.Plugins.USDt#67',
  'zodl-inc/zodl-swift-wallet-sdk#16',
  'zcash/librustzcash#3062',
  'void-layer/codec#14',
  'brunobar79/eth-url-parser#19',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const res = await fetch('https://api.github.com' + path, { headers: H });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (!res.ok) return { error: `${res.status}`, remaining };
  return { data: await res.json(), remaining };
}

async function search(q, sort = 'updated') {
  const url = `/search/issues?q=${encodeURIComponent(q)}&sort=${sort}&order=desc&per_page=30`;
  const r = await api(url);
  if (r.error) { console.error(`  ! search failed: ${r.error} (rate ${r.remaining})`); return []; }
  return r.data.items || [];
}

const QUERIES = [
  'EIP-681 in:title,body,comments state:open type:issue',
  '"ethereum:" URI parser in:title,body state:open type:issue',
  'payment URI ethereum token transfer in:title,body state:open type:issue',
  '"eip681" state:open',
  '"ethereum:" "transfer?address=" state:open type:issue',
  'ERC-681 state:open type:issue',
  '"toChecksumAddress" OR "to_checksum" in:title,body state:open type:issue',
  '"payment_uri" in:title,body state:open',
];

const seen = new Map();
for (const q of QUERIES) {
  const items = await search(q);
  for (const it of items) {
    const key = `${it.repository_url.split('/repos/')[1]}#${it.number}`;
    if (seen.has(key)) continue;
    seen.set(key, it);
  }
  console.log(`  query ok: "${q.slice(0, 42)}..." -> ${items.length} items`);
  await sleep(2200);
}

const now = Date.now();
const rows = [];
for (const [key, it] of seen) {
  const repo = key.split('#')[0];
  const ageDays = Math.floor((now - Date.parse(it.updated_at)) / 86400000);
  const body = (it.body || '') + ' ' + (it.title || '');
  const eip = /eip[- ]?681|ethereum:|erc[- ]?681|payment[_ ]?uri/i.test(body);
  rows.push({
    key, repo, number: it.number, title: it.title.slice(0, 88),
    created: it.created_at.slice(0, 10), updated: it.updated_at.slice(0, 10),
    ageDays, comments: it.comments, state: it.state,
    mine: ALREADY.has(key),
    eip681: eip,
    author: it.user?.login,
    url: it.html_url,
  });
}

// A target must be: open, EIP-681-relevant, active within 180 days, not mine,
// and have a real conversation (comments>0) — a silent issue is a dead end.
const targets = rows
  .filter((r) => !r.mine && r.eip681 && r.ageDays <= 180 && r.comments >= 1)
  .sort((a, b) => a.ageDays - b.ageDays || b.comments - a.comments);

const stale = rows.filter((r) => !r.mine && r.eip681 && r.ageDays > 180).length;
const dead = rows.filter((r) => !r.mine && r.eip681 && r.comments === 0).length;

console.log(`\nscanned ${rows.length} issues | ${rows.filter((r) => r.mine).length} already answered by me`);
console.log(`live candidates: ${targets.length}  (dropped: ${stale} stale >180d, ${dead} zero-comment)\n`);
console.log('AGE  UPDATED     CMS  REPO#N'.padEnd(66) + 'TITLE');
for (const t of targets.slice(0, 25)) {
  console.log(
    String(t.ageDays).padEnd(5) + t.updated.padEnd(12) + String(t.comments).padEnd(5) +
    `${t.repo}#${t.number}`.slice(0, 44).padEnd(46) + t.title.slice(0, 46)
  );
}
if (targets.length) console.log(`\n5 newest:\n` + targets.slice(0, 5).map((t) => `  ${t.url}`).join('\n'));
