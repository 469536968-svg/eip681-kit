'use strict';
/**
 * tools/prove-exports.cjs -- prove that every declared `exports` subpath can
 * actually be imported by a consumer, and that the documented behaviour holds
 * through that path.
 *
 * WHY THIS EXISTS
 * ---------------
 * `exports` in package.json is a hard allowlist. A file can exist, be listed in
 * `files`, and pass every unit test in-place, and STILL be unreachable as
 * `eip681-kit/<thing>` because the exports map does not list it. That happened
 * here: split.mjs and strict.mjs shipped while `exports` only had ".". Every
 * assertion in their test suites passed, and no consumer could load them.
 *
 * Byte-identical on GitHub is not shipped. Reachable by a resolver is shipped.
 *
 * WHAT IT DOES
 *   1. Stages exactly the entries in `files` (what a tarball would contain).
 *   2. Installs the stage as a real dependency of a throwaway project.
 *   3. Imports each declared subpath through Node's own resolver.
 *   4. Exercises the behaviour that subpath promises.
 *   5. NEGATIVE CONTROL: removes one export and requires the import to fail
 *      with ERR_PACKAGE_PATH_NOT_EXPORTED. Without this, a green run would only
 *      prove that *something* loaded.
 *
 * Usage:  node tools/prove-exports.cjs
 * Exit:   0 all subpaths reachable and correct, 1 otherwise.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KIT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'eip681-exports-'));

let failures = 0;
const log = (s) => console.log(s);
const bad = (s) => { failures++; console.log('  FAIL ' + s); };
const good = (s) => console.log('  PASS ' + s);

function stagePackage(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8'));
  const out = path.join(dir, 'node_modules', 'eip681-kit');
  fs.mkdirSync(out, { recursive: true });
  const staged = [];
  for (const entry of pkg.files) {
    const src = path.join(KIT, entry);
    if (!fs.existsSync(src)) { console.log(`  MISSING files[] entry: ${entry}`); continue; }
    fs.cpSync(src, path.join(out, entry), { recursive: true });
    staged.push(entry);
  }
  fs.copyFileSync(path.join(KIT, 'package.json'), path.join(out, 'package.json'));
  return { pkg, out, staged, dir };
}

function runIn(dir, source, name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, 'utf8');
  try {
    const out = execFileSync(NODE, [file], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim(), err: '' };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').trim(), err: (e.stderr || '').trim() };
  }
}

log('eip681-kit export prover');
log('staging into ' + WORK);

const { pkg, out: INSTALLED, staged } = stagePackage(WORK);
log(`staged ${staged.length}/${pkg.files.length} entries`);

// ---------------------------------------------------------------- subpaths
const subpaths = Object.keys(pkg.exports).filter((k) => k !== '.' && k !== './package.json');
log(`declared subpaths: ${subpaths.join(', ') || '(none)'}`);

for (const sub of subpaths) {
  const spec = 'eip681-kit/' + sub.replace(/^\.\//, '');
  log(`\n[${spec}]`);
  const r = runIn(WORK, `
const m = await import(${JSON.stringify(spec)});
const keys = Object.keys(m).sort();
if (keys.length === 0) throw new Error('imported with zero exports');
console.log('resolves; exports=' + keys.join(','));
`, 'probe' + sub.replace(/[^a-z]/gi, '_') + '.mjs');
  if (r.ok) good(r.out); else { bad(`${spec} did not resolve: ${r.err.slice(0, 200)}`); }
}

// ------------------------------------------------- behaviour: ./split
log('\n[behaviour: ./split]');
{
  const r = runIn(WORK, `
import { allocateEvenly, splitCursor } from 'eip681-kit/split';
const TOTAL = 10_000_000n, N = 3;
const parts = allocateEvenly(TOTAL, N);
if (parts.reduce((a, b) => a + b, 0n) !== TOTAL) throw new Error('allocateEvenly does not sum to total');
// remainder must land on the LAST payers, so out-of-order payment stays correct
if (parts[0] !== 3333333n) throw new Error('remainder not on the last payers: ' + parts.join(','));
const c = splitCursor(TOTAL, N);
const paid = []; while (!c.done()) paid.push(c.next());
if (paid.reduce((a, b) => a + b, 0n) !== TOTAL) throw new Error('cursor does not sum to total');
if (paid.join(',') !== parts.join(',')) throw new Error('cursor and allocate disagrees: ' + paid.join(',') + ' vs ' + parts.join(','));
console.log('sum exact, remainder on last payers, both paths agree');
`, 'beh_split.mjs');
  if (r.ok) good(r.out); else bad('split behaviour: ' + (r.err || r.out).slice(0, 300));
}

// ------------------------------------------------- behaviour: ./strict
log('\n[behaviour: ./strict]');
{
  const ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const RECIP = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
  const r = runIn(WORK, `
import { parseStrict } from 'eip681-kit/strict';
import { parse as baseParse } from 'eip681-kit/eip681';
const ADDR = ${JSON.stringify(ADDR)}, TOKEN = ${JSON.stringify(TOKEN)}, RECIP = ${JSON.stringify(RECIP)};
const check = (n, c) => { if (!c) throw new Error(n); };

check('valid native accepted', parseStrict('ethereum:' + ADDR + '@1?value=1000').ok === true);

// core claim: unknown param rejected AND nothing decision-bearing survives
const badUri = 'ethereum:' + ADDR + '@1?value=1000&foo=bar';
const s = parseStrict(badUri);
check('unknown param rejected', s.ok === false);
check('LEAK target', s.target === null);
check('LEAK recipient', s.recipient === null);
check('LEAK amount', s.amount === null);
check('LEAK chainId', s.chainId === null);
check('LEAK canonical', s.canonical === null);
check('LEAK params', Object.keys(s.params || {}).length === 0);

// negative control: base parser is permissive on the same input, so the
// rejection above is attributable to strict and not to the base parser.
const b = baseParse(badUri);
check('CONTROL base accepts same URI', b.ok === true);
check('CONTROL base exposes foo', (b.params || {}).foo === 'bar');

check('missing chainId rejected', parseStrict('ethereum:' + ADDR + '?value=1').ok === false);
check('open-ended transfer rejected', parseStrict('ethereum:' + TOKEN + '@1/transfer?address=' + RECIP).ok === false);
const full = parseStrict('ethereum:' + TOKEN + '@1/transfer?address=' + RECIP + '&uint256=1000000');
check('complete transfer accepted', full.ok === true);
check('recipient survives on success', full.recipient !== null);
check('base-invalid stays invalid', parseStrict('notaeip681uri').ok === false);
console.log('reject-blanks-everything invariant holds through the package export');
`, 'beh_strict.mjs');
  if (r.ok) good(r.out); else bad('strict behaviour: ' + (r.err || r.out).slice(0, 300));
}

// --------------------------------------------------------- negative control
log('\n[control: removing a subpath must break the import]');
{
  const target = './split';
  const pj = path.join(INSTALLED, 'package.json');
  const broken = JSON.parse(fs.readFileSync(pj, 'utf8'));
  delete broken.exports[target];
  fs.writeFileSync(pj, JSON.stringify(broken, null, 2), 'utf8');

  const r = runIn(WORK, `await import('eip681-kit/split');`, 'ctl.mjs');
  const precise = /ERR_PACKAGE_PATH_NOT_EXPORTED/.test(r.err);
  if (r.ok) bad('import still succeeded with ./split removed -- control proves nothing');
  else if (!precise) bad('failed for the wrong reason: ' + r.err.slice(0, 200));
  else good('import fails with ERR_PACKAGE_PATH_NOT_EXPORTED as required');

  fs.copyFileSync(path.join(KIT, 'package.json'), pj);
}

log('');
if (failures === 0) {
  log('ALL SUBPATHS REACHABLE AND CORRECT, control verified');
} else {
  log(`${failures} FAILURE(S) -- a declared export is not usable by a consumer`);
  process.exitCode = 1;
}
fs.rmSync(WORK, { recursive: true, force: true });
