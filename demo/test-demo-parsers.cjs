/**
 * Executes the parser functions AS SHIPPED inside demo/index.html.
 *
 * Why this file exists: build-demo.cjs only proved bytes landed in the HTML. It proved
 * nothing about whether the parser logic is correct. The demo's central claim is
 * "a naive parser silently returns a different account" -- if that claim is wrong the
 * page is dishonest, and it is exactly the kind of claim I have published unverified
 * before. So this harness pulls the <script type="module"> body out of the built HTML,
 * feeds it a stub DOM, and runs the real functions.
 *
 * Nothing here is a re-implementation. If the HTML changes and this breaks, that is the
 * harness doing its job.
 *
 * PROVEN BY MUTATION: reintroducing the original `USDC.replace('F','f')` no-op bug makes
 * the tests in section 8 fail. Verified 2026-11-22 by scratch/mutation-test.cjs. The
 * earlier version of section 8 PASSED against that mutant, because it supplied its own
 * correct BAD_CK as a parameter and therefore shadowed the page's broken one -- the test
 * was checking a preset list the page never had. That exact mistake is what this repo
 * documents, so the fix was structural, not a new assertion.
 *
 * Run: node demo/test-demo-parsers.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const HTML = path.join(__dirname, 'index.html');
const html = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
const failures = [];
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(`${label}\n    want ${w}\n    got  ${g}`); }
};

// ---- extract the inline module and the two parse functions -------------------
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('FATAL: no inline module found in index.html'); process.exit(2); }
const script = m[1];

// Slice out only the pure functions + constants, so we never need a DOM.
const grab = (name) => {
  const start = script.indexOf('function ' + name);
  if (start < 0) { console.error('FATAL: ' + name + ' not found in shipped HTML'); process.exit(2); }
  let depth = 0, i = script.indexOf('{', start), end = -1;
  for (; i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) { console.error('FATAL: unbalanced braces in ' + name); process.exit(2); }
  return script.slice(start, end);
};

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BODY = USDC.slice(2);

const src =
  grab('keccak256') + '\n' +
  grab('toHex') + '\n' +
  grab('toChecksumAddress') + '\n' +
  // permute/rotl/constants the hash depends on
  'const MASK = (1n << 64n) - 1n;\n' +
  grab('rotl') + '\n' +
  grab('permute') + '\n' +
  'const RC = [' + (script.match(/const RC = \[([\s\S]*?)\];/) || [, ''])[1] + '];\n' +
  'const ROT = [' + (script.match(/const ROT = \[([\s\S]*?)\n\];/) || [, ''])[1] + '];\n' +
  grab('parseAddressSpec') + '\n' +
  grab('parseAddressBuggy') + '\n' +
  'module.exports = { parseAddressSpec, parseAddressBuggy, toChecksumAddress, keccak256 };';

const tmp = path.join(__dirname, '.shipped-parsers.cjs');
fs.writeFileSync(tmp, src);

let P;
try {
  P = require(tmp);
} catch (e) {
  console.error('FATAL: shipped parser code does not execute: ' + e.message);
  process.exit(2);
} finally {
  try { fs.unlinkSync(tmp); } catch {}
}

const { parseAddressSpec, parseAddressBuggy } = P;

// ---- 1. the valid URI must be accepted by both, agreeing --------------------
const valid = 'ethereum:pay-' + USDC + '@8453/transfer?address=0x' + BODY + '&uint256=1000000';
const vs = parseAddressSpec(valid), vb = parseAddressBuggy(valid);
eq('valid: spec accepts', vs.ok, true);
eq('valid: buggy accepts', vb.ok, true);
eq('valid: they agree', vs.addr.toLowerCase(), vb.addr.toLowerCase());
eq('valid: stored lowercase body', vs.addr, BODY);

// ---- 2. over-length: spec must REJECT, buggy must ACCEPT --------------------
for (const extra of [1, 2, 13, 24]) {
  const uri = 'ethereum:pay-0x' + BODY + 'a'.repeat(extra) + '@8453';
  const s = parseAddressSpec(uri), b = parseAddressBuggy(uri);
  eq(`over+${extra}: spec rejects`, s.ok, false);
  eq(`over+${extra}: spec reason names the length`, s.reason, 'length-' + (40 + extra));
  eq(`over+${extra}: buggy ACCEPTS (this is the bug)`, b.ok, true);
  eq(`over+${extra}: buggy returns the intended account by luck of position`,
     '0x' + b.addr, USDC.toLowerCase());
}

// ---- 3. under-length: spec MUST reject -------------------------------------
const short = 'ethereum:pay-0x' + BODY.slice(0, 39) + '@8453';
eq('short: spec rejects', parseAddressSpec(short).ok, false);
eq('short: reason is length-39', parseAddressSpec(short).reason, 'length-39');

// ---- 4. ABI word (24 zero bytes + address): must NOT be silently unwrapped --
const abi = 'ethereum:pay-0x' + '0'.repeat(24) + BODY + '@8453';
eq('abi-word: spec rejects (no silent unwrap)', parseAddressSpec(abi).ok, false);
eq('abi-word: reason names 64', parseAddressSpec(abi).reason, 'length-64');

// ---- 5. bad checksum: mixed case that is not canonical must be rejected ----
// Same derivation the page uses, but computed independently here so the PARSER can be
// tested against a known-bad string. (Section 8 is the one that must use the PAGE's
// value -- that distinction is the whole point of the mutation finding above.)
const BAD_CK_TEST = (() => {
  const c = P.toChecksumAddress(BODY);
  const i = c.search(/[a-f]/);
  return c.slice(0, i) + c[i].toUpperCase() + c.slice(i + 1);
})();
const badSum = 'ethereum:pay-0x' + BAD_CK_TEST + '@8453';

// Guard the fixture itself: if BAD_CK_TEST is accidentally canonical, the whole
// bad-checksum test would be vacuous.
eq('fixture: BAD_CK_TEST is mixed-case',
   BAD_CK_TEST !== BAD_CK_TEST.toLowerCase() && BAD_CK_TEST !== BAD_CK_TEST.toUpperCase(), true);
eq('fixture: BAD_CK_TEST differs from canonical',
   BAD_CK_TEST !== P.toChecksumAddress(BODY), true);
const bs = parseAddressSpec(badSum);
eq('bad-checksum: spec rejects', bs.ok, false);
eq('bad-checksum: reason is bad-checksum', bs.reason, 'bad-checksum');
eq('bad-checksum: reports the canonical form', bs.canonical, USDC.slice(2));

// ---- 6. all-lowercase is legal and must be accepted -----------------------
const lower = 'ethereum:pay-' + USDC.toLowerCase() + '@8453';
eq('all-lowercase: accepted (EIP-55 makes no claim)', parseAddressSpec(lower).ok, true);

// ---- 7. no prefix / garbage ----------------------------------------------
eq('no 0x: rejected', parseAddressSpec('ethereum:pay-1234@8453').ok, false);
eq('no scheme: rejected', parseAddressSpec('garbage').ok, false);

// ---- 8. the PAGE's own presets, including the PAGE's own BAD_CK -----------
// STRUCTURAL RULE, learned by mutation: never pass BAD_CK into this evaluation. If the
// caller supplies it, a broken page is silently masked by a correct caller value. So the
// contiguous slice from `const USDC = ` through the end of `const PRESETS = [...]` is
// evaluated as ONE unit, and the only free variable given to it is toChecksumAddress --
// the single genuine dependency of the BAD_CK derivation.
const sStart = script.indexOf('const USDC = ');
const sPresets = script.indexOf('const PRESETS = [');
if (sStart < 0 || sPresets < 0) {
  console.error('FATAL: USDC/PRESETS block not found in shipped HTML');
  process.exit(2);
}
let bd8 = 0, sEnd = -1;
for (let i = script.indexOf('[', sPresets); i < script.length; i++) {
  if (script[i] === '[') bd8++;
  else if (script[i] === ']') { bd8--; if (bd8 === 0) { sEnd = i + 1; break; } }
}
if (sEnd < 0) { console.error('FATAL: unbalanced PRESETS array'); process.exit(2); }

const pageBlock = script.slice(sStart, sEnd);
const pageVals = new Function('toChecksumAddress',
  pageBlock + '\nreturn { USDC, BODY, BAD_CK, PRESETS };')(P.toChecksumAddress);
const PRESETS = pageVals.PRESETS;

// Sanity: the page's constants must be the ones this test assumes, otherwise everything
// above is measuring a different page than the one shipped.
eq('page USDC matches expectation', pageVals.USDC, USDC);
eq('page preset count', PRESETS.length, 6);

// THE REGRESSION ASSERTION. The page's bad-checksum preset must encode an address that
// is (a) non-canonical and (b) rejected by the spec parser. The original bug made
// USDC.replace('F','f') a no-op because the address has no uppercase 'F', so the preset
// labelled "bad checksum" rendered the perfectly VALID canonical address.
eq('page BAD_CK differs from canonical body (preset is genuinely bad)',
   pageVals.BAD_CK !== USDC.slice(2), true);
eq('page BAD_CK is not the untouched lowercase body',
   pageVals.BAD_CK !== BODY, true);

const pageBad = PRESETS.filter(([label]) => /bad checksum/i.test(label));
eq('page has exactly one bad-checksum preset', pageBad.length, 1);
if (pageBad.length === 1) {
  // The preset string must literally contain the page's own BAD_CK -- i.e. the label and
  // the data are consistent with each other.
  eq('page bad-checksum preset embeds the page BAD_CK',
     pageBad[0][1].includes(pageVals.BAD_CK), true);
  const pr = parseAddressSpec(pageBad[0][1]);
  eq('page bad-checksum preset IS rejected by the spec parser', pr.ok, false);
  eq('page bad-checksum preset reason is bad-checksum', pr.reason, 'bad-checksum');
}

// Every preset must parse without throwing (they are all strings the page displays).
for (const [label, uri] of PRESETS) {
  eq('preset parses without throwing: ' + label, (() => {
    try { parseAddressSpec(uri); parseAddressBuggy(uri); return true; } catch { return false; }
  })(), true);
}

// ---- 9. NEGATIVE CONTROL on the buggy parser itself ----------------------
// If I "fixed" parseAddressBuggy by adding a length check, test 2 would fail and the
// demo's whole premise would evaporate. Assert the naive parser still truncates, i.e.
// the demo is demonstrating a real defect rather than a strawman I already patched.
const trunc = parseAddressBuggy('ethereum:pay-0x' + BODY + 'a'.repeat(24) + '@8453');
eq('NEGATIVE CONTROL: naive parser still truncates 64 chars to 40',
   trunc.ok && trunc.addr.length === 40, true);

console.log(`shipped-parser tests: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exitCode = fail === 0 ? 0 : 1;
