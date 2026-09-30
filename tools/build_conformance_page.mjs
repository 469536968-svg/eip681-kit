// tools/build_conformance_page.mjs
//
// Builds a SINGLE self-contained HTML file that runs the whole EIP-681 conformance
// corpus in the browser: parser inlined, vectors inlined, zero network, zero deps.
//
//   node tools/build_conformance_page.mjs
//
// Why this exists: the corpus is only useful if a human can run it without cloning
// anything. A citable URL that shows 49/49 live is a deliverable; a repo file is a claim.
//
// The build FAILS LOUDLY if the parser cannot be inlined (any import that is not
// relative-and-present, or any use of a Node builtin) rather than emitting a broken page.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const parserPath = join(root, 'eip681.mjs');
const vectorsPath = join(root, 'conformance', 'vectors.json');

let src = readFileSync(parserPath, 'utf8');

// --- refuse to inline anything that cannot work in a browser -----------------
const badImports = [...src.matchAll(/^\s*import\s.*$/gm)].map((m) => m[0].trim());
const destructive = badImports.filter(
  (l) => !/from\s+['"]\.\//.test(l) || /node:|['"][a-z@]/i.test(l.replace(/from\s+['"]\.[^'"]*['"]/, ''))
);
if (destructive.length) {
  console.error('BUILD FAILED: parser has imports that cannot be inlined:');
  for (const l of destructive) console.error('  ' + l);
  process.exit(1);
}
if (/from\s+['"]\.\//.test(src)) {
  console.error('BUILD FAILED: relative imports present; inline dependencies first.');
  process.exit(1);
}
for (const builtin of ['node:crypto', 'node:fs', 'node:path', 'require(', 'process.env']) {
  if (src.includes(builtin)) {
    console.error(`BUILD FAILED: parser uses ${builtin}, which does not exist in a browser.`);
    process.exit(1);
  }
}

// --- convert ESM exports into plain module-scope declarations ----------------
src = src.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');        // export { a, b };
src = src.replace(/^\s*export\s+default\s+/gm, '');                // export default X
src = src.replace(/^(\s*)export\s+/gm, '$1');                      // export function/const/class

const suite = JSON.parse(readFileSync(vectorsPath, 'utf8'));

if (!/function\s+parse\s*\(/.test(src)) {
  console.error('BUILD FAILED: no top-level `parse` function found after inlining.');
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EIP-681 conformance runner — 49 vectors, offline</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem 1.25rem; background: #0d1117; color: #e6edf3;
         font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main { max-width: 940px; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .35rem; }
  h2 { font-size: 1rem; margin: 2rem 0 .6rem; color: #e6edf3; }
  p.sub { color: #8b949e; margin: 0 0 1.5rem; }
  a { color: #58a6ff; }
  .big { font-size: 1.7rem; font-weight: 700; margin: 1rem 0 .25rem; }
  .pass { color: #3fb950; } .fail { color: #f85149; }
  table { width: 100%; border-collapse: collapse; margin-top: .5rem; font-size: 13px; }
  th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid #21262d;
           vertical-align: top; }
  th { color: #8b949e; font-weight: 600; }
  tr.bad td { background: #2d1214; }
  .pill { display: inline-block; padding: .05rem .45rem; border-radius: 999px;
          font-size: 11px; border: 1px solid #30363d; color: #8b949e; }
  code { background: #161b22; padding: .1rem .35rem; border-radius: 4px; }
  textarea { width: 100%; min-height: 4.2rem; background: #161b22; color: #e6edf3;
             border: 1px solid #30363d; border-radius: 6px; padding: .6rem; font: inherit; }
  button { background: #21262d; color: #e6edf3; border: 1px solid #30363d;
           border-radius: 6px; padding: .5rem 1rem; font: inherit; cursor: pointer; }
  button:hover { background: #30363d; }
  pre { background: #161b22; border: 1px solid #21262d; border-radius: 6px;
        padding: .8rem; overflow-x: auto; font-size: 13px; }
  .muted { color: #8b949e; }
</style>
</head>
<body>
<main>
  <h1>EIP-681 conformance runner</h1>
  <p class="sub">
    ${suite.vectors.length} vectors, hand-authored from the
    <a href="https://eips.ethereum.org/EIPS/eip-681">EIP-681 specification</a> and from defects
    observed in real parsers. Runs entirely in this page — no network, no build step.
  </p>

  <div id="summary" class="big">running…</div>
  <p class="muted" id="sub"></p>

  <h2>Vectors</h2>
  <p class="muted">A failing row means the parser in this page disagrees with the spec-derived
  expectation. That is the point: the corpus is falsifiable.</p>
  <table>
    <thead><tr><th>id</th><th>verdict</th><th>input</th><th>detail</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <h2>Try your own URI</h2>
  <textarea id="in" spellcheck="false">ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359&uint256=1000</textarea>
  <p><button id="go">Parse</button></p>
  <pre id="out">—</pre>

  <h2>What this catches</h2>
  <p class="muted">
    The address-length cases exist because a grammar written as a <em>minimum</em> has no
    ceiling: 41–64 hex digits then reach the checksum step and get reported as a checksum
    problem rather than a length problem. That is a real defect observed in
    <code>librustzcash</code> <code>components/eip681</code>.
    <code>T-05</code> checks the subtlest one: when a parse fails, it must expose
    <em>no</em> amount, or a caller testing <code>amount !== null</code> pays a silently
    chosen number.
  </p>
</main>

<script type="module">
// ===== inlined parser (generated from eip681.mjs — do not edit here) =====
${src}
// ===== end inlined parser =====

const SUITE = ${JSON.stringify(suite)};

const codes = (list) => (list || []).map((e) => e.code);
const low = (x) => (typeof x === 'string' ? x.toLowerCase() : x);

function runOne(v) {
  const problems = [];
  let r;
  try { r = parse(v.input); }
  catch (e) { return { problems: ['threw: ' + e.message] }; }

  if (r.ok !== v.expect.ok) {
    const c = codes(r.errors).join(',') || 'none';
    problems.push('ok: expected ' + v.expect.ok + ' got ' + r.ok + ' [errors: ' + c + ']');
  }
  const haveErrors = codes(r.errors);
  for (const c of v.expect.error_codes || []) {
    if (!haveErrors.includes(c)) problems.push('missing error code "' + c + '" (have: ' + (haveErrors.join(',') || 'none') + ')');
  }
  const haveWarnings = codes(r.warnings);
  for (const c of v.expect.warning_codes || []) {
    if (!haveWarnings.includes(c)) problems.push('missing warning code "' + c + '" (have: ' + (haveWarnings.join(',') || 'none') + ')');
  }
  if (v.expect.ok && v.expect.fields) {
    const f = v.expect.fields;
    if ('chainId' in f && r.chainId !== f.chainId) problems.push('chainId: expected ' + f.chainId + ' got ' + r.chainId);
    if ('amount' in f) {
      const got = r.amount === null || r.amount === undefined ? null : r.amount.toString();
      if (got !== f.amount) problems.push('amount: expected ' + f.amount + ' got ' + got);
    }
    if ('recipient' in f && low(r.recipient) !== f.recipient) problems.push('recipient: expected ' + f.recipient + ' got ' + low(r.recipient));
    if ('target' in f && low(r.target) !== f.target) problems.push('target: expected ' + f.target + ' got ' + low(r.target));
    if ('isTokenTransfer' in f && r.isTokenTransfer !== f.isTokenTransfer) problems.push('isTokenTransfer: expected ' + f.isTokenTransfer + ' got ' + r.isTokenTransfer);
  }
  if (!v.expect.ok && v.expect.fields && 'amount' in v.expect.fields) {
    const got = r.amount === null || r.amount === undefined ? null : r.amount.toString();
    if (got !== v.expect.fields.amount) problems.push('amount on a FAILED parse: expected ' + v.expect.fields.amount + ' got ' + got);
  }
  return { problems };
}

let pass = 0;
const tbody = document.getElementById('rows');
for (const v of SUITE.vectors) {
  const { problems } = runOne(v);
  const good = problems.length === 0;
  if (good) pass++;
  const tr = document.createElement('tr');
  if (!good) tr.className = 'bad';
  tr.innerHTML =
    '<td>' + v.id + '</td>' +
    '<td class="' + (good ? 'pass' : 'fail') + '">' + (good ? 'pass' : 'FAIL') + '</td>' +
    '<td><code>' + v.input.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</code></td>' +
    '<td>' + (good ? '<span class="pill">ok</span>' : problems.join('<br>')) + '</td>';
  tbody.appendChild(tr);
}

const total = SUITE.vectors.length;
document.getElementById('summary').textContent = pass + ' / ' + total;
document.getElementById('summary').className = 'big ' + (pass === total ? 'pass' : 'fail');
document.getElementById('sub').textContent = pass === total
  ? 'all vectors satisfied — parser and spec-derived expectations agree'
  : (total - pass) + ' mismatch(es) — the parser disagrees with the hand-authored expectation';

// ---- interactive box ----
function show() {
  const raw = document.getElementById('in').value;
  const out = document.getElementById('out');
  try {
    const r = parse(raw);
    const e = codes(r.errors), w = codes(r.warnings);
    out.textContent = JSON.stringify({
      ok: r.ok,
      errors: e.length ? e : undefined,
      warnings: w.length ? w : undefined,
      chainId: r.chainId,
      target: r.target,
      recipient: r.recipient,
      amount: r.amount === null || r.amount === undefined ? null : r.amount.toString(),
      isTokenTransfer: r.isTokenTransfer
    }, null, 2);
  } catch (err) {
    out.textContent = 'threw: ' + err.message;
  }
}
document.getElementById('go').addEventListener('click', show);
document.getElementById('in').addEventListener('input', show);
show();
</script>
</body>
</html>
`;

const outPath = join(root, 'conformance.html');
writeFileSync(outPath, html, 'utf8');
console.log(`wrote conformance.html (${html.length} bytes), ${suite.vectors.length} vectors inlined`);
console.log(`parser inlined: ${src.length} bytes, imports: ${badImports.length} (all relative/none)`);
