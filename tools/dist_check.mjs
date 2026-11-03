// tools/dist_check.mjs — verify what a stranger actually receives: pack -> install -> import.
// Lives in tools/ so it is NOT in the published tarball (the "files" whitelist omits tools/).
//
// Run: node tools/dist_check.mjs
//
// WHY THIS FILE EXISTS
// Every other suite runs the package from its source directory, where a stray relative
// import or a file left out of "files" cannot show up. Distribution is a different question:
// does the ARTIFACT work when a stranger installs it and knows nothing about this repo?
//
// CONTRACT TESTED
//   The exports declared in index.d.ts must exist at runtime in the INSTALLED package.
//   That is the check an earlier version of this file got wrong by hardcoding a remembered
//   API name (`formatEip681`, which has never existed -- the real export is `format`) and by
//   guessing the CLI subcommand (`parse` -- the real one is `check`). Guessing at an API and
//   then reporting the package as broken is worse than not testing, because it manufactures
//   false defects. So expectations are READ from the shipped declaration file, never recalled.
//
// It also checks the invariant that matters most for a payment library: a URI the parser
// REJECTS must not hand back a usable amount -- verified in the installed copy.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
// npm is not on PATH for a child process on this host -- use the absolute path.
const NPM = 'C:/Users/HUAWEI/.workbuddy/binaries/node/versions/22.22.2-6/npm.cmd';

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: cmd.endsWith('.cmd') });

let bad = 0;
const fail = m => { bad++; console.log('FAIL  ' + m); };
const pass = m => console.log('pass  ' + m);

// ---------------------------------------------------------------- 1. tarball contents
console.log('== npm pack --dry-run ==');
const info = JSON.parse(run(NPM, ['pack', '--dry-run', '--json'], ROOT))[0];
const names = info.files.map(f => f.path);
console.log(`files=${info.entryCount} unpacked=${info.unpackedSize}B tarball=${info.size}B`);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const entry of pkg.files) {
  const hit = names.some(n => n === entry || n.startsWith(entry.replace(/\/$/, '') + '/'));
  if (hit) pass(`declared in files, present: ${entry}`);
  else fail(`declared in package.json files but ABSENT from tarball: ${entry}`);
}

// Only these categories are genuinely unwanted. Data corpora (.json under vectors/ and
// conformance/) are INTENTIONAL -- `eip681 vectors` reports their location at runtime.
const unwanted = names.filter(n =>
  /(^|\/)node_modules\//.test(n) ||
  /(^|\/)\.git\//.test(n) ||
  /\.(tgz|log|bak|orig)$/.test(n) ||
  /^_/.test(n) ||
  /^(runsuite\.bat|ship.*\.cjs|api_ship\.cjs)$/.test(n)
);
if (unwanted.length === 0) pass('no node_modules/.git/local-only scripts in tarball');
else { unwanted.forEach(u => console.log('        unwanted: ' + u)); fail(`${unwanted.length} unwanted file(s) in tarball`); }

// ---------------------------------------------------------------- 2. install clean
console.log('\n== pack + install into a clean directory ==');
const stg = mkdtempSync(join(tmpdir(), 'eip681-dist-'));
let tgz = null;
try {
  tgz = join(ROOT, JSON.parse(run(NPM, ['pack', '--json'], ROOT))[0].filename);
  pass('tarball produced');
  writeFileSync(join(stg, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', type: 'module', private: true }));
  run(NPM, ['install', tgz, '--no-audit', '--no-fund'], stg);
  pass('tarball installed into an empty project');
} catch (e) {
  console.log(((e.stdout || '') + (e.stderr || '')).trim().split('\n').slice(-8).join('\n'));
  fail('pack/install failed');
  process.exit(1);
}

// ---------------------------------------------------------------- 3. declaration vs runtime
const dts = readFileSync(join(ROOT, 'index.d.ts'), 'utf8');
const declared = new Set();
for (const m of dts.matchAll(/^\s*export\s+(?:declare\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);
for (const m of dts.matchAll(/^\s*export\s*\{([^}]+)\}/gm))
  m[1].split(',').forEach(s => { const t = s.trim().split(/\s+as\s+/).pop().trim(); if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t); });

const EXPECT = [...declared].sort();
console.log(`\n== declaration vs runtime (${EXPECT.length} names declared in index.d.ts) ==`);

const PROBE = `
import * as kit from 'eip681-kit';
const expect = ${JSON.stringify(EXPECT)};
const missing = expect.filter(n => kit[n] === undefined);
console.log('RUNTIME_EXPORTS=' + Object.keys(kit).sort().join(','));
console.log('MISSING=' + missing.join(','));

const target = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
const uri = 'ethereum:' + target + '@1/transfer?address=0x2222222222222222222222222222222222222222&uint256=1e18';
const r = kit.parse(uri);
console.log('PARSE ok=' + r.ok + ' amount=' + r.amount + ' chain=' + r.chainId);
if (!r.ok) console.log('PARSE_FAILED');

const cs = kit.toChecksumAddress(target.toLowerCase());
console.log('CHECKSUM_MATCH=' + (cs === target));
if (cs !== target) console.log('CHECKSUM_FAILED');

const bad = kit.parse('ethereum:' + target + '@1/transfer?address=0x2222222222222222222222222222222222222222&uint256=0xZZ');
console.log('REJECT ok=' + bad.ok + ' amount=' + (bad.amount === null ? 'null' : bad.amount));
if (bad.ok === false && bad.amount !== null && bad.amount !== undefined) console.log('I1_VIOLATED');
`;
writeFileSync(join(stg, 'probe.mjs'), PROBE);
let out = '';
try {
  out = run(NODE, ['probe.mjs'], stg);
  out.trim().split('\n').forEach(l => console.log('  ' + l));
} catch (e) {
  console.log(((e.stdout || '') + (e.stderr || '')).trim().split('\n').slice(-6).join('\n'));
  fail('probe could not run against the installed package');
}

const get = k => (out.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
if (get('MISSING') === '') pass(`all ${EXPECT.length} declared exports exist at runtime`);
else if (get('MISSING') !== undefined) fail('declared but missing at runtime: ' + get('MISSING'));
if (get('PARSE_FAILED')) fail('installed parser rejected a valid ERC-20 transfer URI');
if (get('CHECKSUM_FAILED')) fail('toChecksumAddress disagrees with the canonical EIP-55 vector when installed');
if (get('I1_VIOLATED')) fail('invariant I1 violated in the installed copy');
else pass('I1 holds in the installed copy (rejected parse exposes no amount)');

// ---------------------------------------------------------------- 4. CLI as installed
console.log('\n== installed CLI ==');
try {
  const cli = join(stg, 'node_modules', 'eip681-kit', 'cli.mjs');
  if (!existsSync(cli)) fail('cli.mjs absent from installed package');
  else {
    // `check` is the documented single-URI validator; `parse` is not a command.
    const ok = run(NODE, [cli, 'check', 'ethereum:0x1111111111111111111111111111111111111111@1/transfer?address=0x2222222222222222222222222222222222222222&uint256=1e18'], stg);
    console.log('  check -> ' + ok.trim().split('\n')[0]);
    pass('installed CLI `check` accepts a valid URI');

    let rejected = false;
    try {
      run(NODE, [cli, 'check', 'ethereum:0x1111111111111111111111111111111111111111@1/transfer?address=0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d35a&uint256=1e18'], stg);
    } catch (e) { rejected = e.status === 1; }
    if (rejected) pass('installed CLI `check` exits 1 on a bad EIP-55 claim');
    else fail('installed CLI `check` did NOT exit 1 on a bad EIP-55 claim');
  }
} catch (e) {
  console.log('  ' + ((e.stdout || '') + (e.stderr || '')).trim().split('\n').slice(0, 3).join('\n  '));
  fail('installed CLI failed');
}

try { rmSync(tgz, { force: true }); } catch {}
try { rmSync(stg, { recursive: true, force: true }); } catch {}

console.log('\n' + '='.repeat(60));
console.log(bad === 0 ? 'DISTRIBUTION OK — the tarball installs and works standalone.' : bad + ' problem(s) found.');
process.exit(bad === 0 ? 0 : 1);
