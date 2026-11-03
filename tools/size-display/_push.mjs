/**
 * _push.mjs - publish local repo state to GitHub via the REST API.
 *
 * Why this exists: the `git` binary is not on PATH in this shell, so commits
 * cannot be made locally. The contents API needs no git.
 *
 * Contract:
 *  - Diffs every publishable local file against the remote tree (by blob SHA).
 *  - Pushes only files whose content actually differs. No-op when nothing differs.
 *  - An explicit denylist keeps scratch artifacts (shell/batch helpers, captured
 *    test output, commit-message drafts) out of the public repo. Publishing
 *    scratch is clutter, and clutter is worse than nothing.
 *  - Never retries a write. A 2xx ends that step, full stop.
 *      (D6 rule 3: a blind-retrying wrapper on a write is what created the
 *       ten-duplicate comment incident. This tool has no retry path at all.)
 *  - Writes are atomic: all blobs -> one tree -> one commit -> one ref update.
 *    A partial publish is therefore impossible.
 *
 * Usage: node _push.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) { console.error('FATAL: no GITHUB_TOKEN'); process.exit(1); }

const OWNER = '469536968-svg';
const REPO = 'eip681-kit';
const BRANCH = 'main';
const ROOT = 'C:/Users/HUAWEI/workspace/eip681-kit';
const DRY = process.argv.includes('--dry-run');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.cache']);

// Publishable = anything not matched here. Anything matched stays local-only.
const SCRATCH = [
  /^_push\.mjs$/, /^_sync\.mjs$/, /^_patch\.mjs$/,
  /^commitmsg\.txt$/, /\.bat$/i, /^RECOVER_AND_SCAN\.sh$/,
  /^out\.txt$/, /\.log$/i, /^\.env/i,
];
const isScratch = (base) => SCRATCH.some((re) => re.test(base));

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'qiming-eip681-publisher',
  'Content-Type': 'application/json',
};

const gitBlobSha = (buf) => {
  const h = crypto.createHash('sha1');
  h.update(`blob ${buf.length}\0`);
  h.update(buf);
  return h.digest('hex');
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      if (!isScratch(e.name)) out.push(path.join(dir, e.name));
    }
  }
  return out;
}

const relOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

const COMMIT_MSG = [
  'publish local work that had never been pushed; add size-display measurement suite',
  '',
  'The remote was behind local by content. This publishes it in one atomic',
  'tree + commit + ref update, so no partial state is possible. Scratch artifacts',
  '(shell/batch helpers, captured output, commit-message drafts) are denylisted and',
  'stay local rather than cluttering the public repo.',
  '',
  'size-display: measure the display quantum instead of assuming it. The quantum of a',
  'round-to-1-decimal formatter is HALF the last-digit step, not the full step:',
  "moving '1.0 MiB' to '1.1 MiB' is driven by rounding, so the smallest observable",
  'change is 0.05 MiB = 52429 bytes, not 104858. My first assertion expected the full',
  'step and failed; the measurement was right and the assertion was wrong. That class of',
  'error is now caught by a relationship guard instead of by accident.',
  '',
  'The self-test lives in the module (selfTest()), so the numbers are reproducible',
  'in-repo rather than in captured scratch output: `node display-resolution.mjs` prints',
  'the same 2412/3456 = 69.8% collision rate. Negative control included: a formatter',
  'that keeps a sub-KiB branch still collides above 1 KiB, so the property under test is',
  'not vacuous.',
].join('\n');

(async () => {
  const refRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, { headers: H });
  if (!refRes.ok) { console.error('FATAL ref', refRes.status, (await refRes.text()).slice(0, 200)); process.exit(1); }
  const headSha = (await refRes.json()).object.sha;

  const cRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits/${headSha}`, { headers: H });
  const treeSha = (await cRes.json()).tree.sha;

  const tRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${treeSha}?recursive=1`, { headers: H });
  const tree = await tRes.json();
  if (!Array.isArray(tree.tree)) { console.error('FATAL tree', JSON.stringify(tree).slice(0, 300)); process.exit(1); }

  const remoteByPath = new Map();
  for (const n of tree.tree) if (n.type === 'blob') remoteByPath.set(n.path, n.sha);

  const localFiles = walk(ROOT);
  const changed = [];
  for (const abs of localFiles) {
    const rel = relOf(abs);
    if (rel.startsWith('..')) continue;
    const buf = fs.readFileSync(abs);
    if (gitBlobSha(buf) !== remoteByPath.get(rel)) changed.push({ rel, abs, buf });
  }

  console.log(`head ${headSha.slice(0, 8)} | publishable local ${localFiles.length} | remote ${remoteByPath.size}`);
  console.log(`changed: ${changed.length}`);
  for (const c of changed) console.log(`  M ${c.rel} (${c.buf.length}b)`);

  if (!changed.length) { console.log('NOTHING_TO_DO'); return; }
  if (DRY) { console.log('DRY_RUN - no writes'); return; }

  const treeEntries = [];
  for (const c of changed) {
    const bRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ content: c.buf.toString('base64'), encoding: 'base64' }),
    });
    if (bRes.status !== 201) { console.error(`FATAL blob ${c.rel}`, bRes.status, (await bRes.text()).slice(0, 200)); process.exit(1); }
    const blob = await bRes.json();
    treeEntries.push({ path: c.rel, mode: '100644', type: 'blob', sha: blob.sha });
    console.log(`  blob ${c.rel} -> ${blob.sha.slice(0, 8)}`);
  }

  const ntRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ base_tree: treeSha, tree: treeEntries }),
  });
  if (ntRes.status !== 201) { console.error('FATAL newtree', ntRes.status, (await ntRes.text()).slice(0, 300)); process.exit(1); }
  const newTree = await ntRes.json();

  const ncRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ message: COMMIT_MSG, tree: newTree.sha, parents: [headSha] }),
  });
  if (ncRes.status !== 201) { console.error('FATAL commit', ncRes.status, (await ncRes.text()).slice(0, 300)); process.exit(1); }
  const commit = await ncRes.json();

  const upRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  if (!upRes.ok) { console.error('FATAL ref-update', upRes.status, (await upRes.text()).slice(0, 300)); process.exit(1); }

  console.log(`PUSHED ${commit.sha}`);
  console.log(`https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
})();
