'use strict';
/**
 * Generate EIP-681 ADDRESS validation conformance vectors.
 *
 * Why this file exists: the amount vectors cover value. Address structure is the other
 * half of every EIP-681 URI, and the defect class there is nastier, because a
 * wrong-length address is usually not rejected -- it is silently TRUNCATED (or
 * silently unwrapped) into a different, perfectly valid-looking account, with no error
 * for the caller to observe. Two independently measured real-world instances:
 *
 *   - eth-url-parser@1.0.4: 24 of 24 over-length inputs accepted; surplus digits were
 *     absorbed into chain_id, so a different account was returned than was signed.
 *   - zcash/librustzcash: 25 of 25 over-length inputs accepted before my fix; that fix
 *     is merged upstream as PR #3062.
 *
 * The `expect` values are NOT emitted from a parser. They come from the spec function
 * below, written from the EIP-681 / EIP-55 text. That is the difference between
 * documenting behavior and defining correctness.
 *
 * The checksum primitive is delegated to the shipped, already-tested
 * isChecksumAddress / toChecksumAddress rather than reimplemented.
 *
 * PRECONDITION: this file refuses to write unless all six refusal reasons are produced
 * by the fixtures AND every negative-control target vector is present. Caught the first
 * version of this file, which claimed 6/6 coverage while its "non-hex" fixtures were 38
 * and 37 chars (length fired first) and whose checksum flip targeted a digit.
 */
const fs = require('node:fs');
const path = require('node:path');
const K = require('../eip681.mjs');

const ROOT = 'C:/Users/HUAWEI/workspace/eip681-kit';
const OUT_DIR = ROOT + '/address/vectors';
const OUT = OUT_DIR + '/eip681-address-vectors.json';
const REASONS = ['empty', 'prefix-only', 'too-short', 'too-long', 'non-hex', 'bad-checksum'];

// ---------------------------------------------------------------- spec function
// Check ORDER is part of the contract and observable, fixed here and documented:
// empty -> prefix-only -> length -> non-hex -> checksum.
function validateAddress(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'empty' };
  const s = input.trim();
  if (s === '') return { ok: false, reason: 'empty' };

  let body = s, prefixed = false;
  if (/^0[xX]/.test(s)) { prefixed = true; body = s.slice(2); }
  if (body === '') return { ok: false, reason: 'prefix-only' };

  // length BEFORE character class: makes "vitalik.eth" report too-short, not non-hex
  if (body.length < 40) return { ok: false, reason: 'too-short' };
  if (body.length > 40) return { ok: false, reason: 'too-long' };

  if (!/^[0-9a-fA-F]{40}$/.test(body)) return { ok: false, reason: 'non-hex' };

  const lower = body.toLowerCase();
  const isAllLower = body === lower;
  const isAllUpper = body === body.toUpperCase();

  let checksummed = false;
  if (!isAllLower && !isAllUpper) {
    if (!K.isChecksumAddress('0x' + body)) return { ok: false, reason: 'bad-checksum' };
    checksummed = true;
  }
  return { ok: true, address: '0x' + lower, prefixed, checksummed };
}

// ---------------------------------------------------------------- fixtures
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // real, checksummed, Base
const ZERO = '0x0000000000000000000000000000000000000000';
const WETH = '0x4200000000000000000000000000000000000006';
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const BODY = USDC.slice(2); // exactly 40 hex chars

// flip the FIRST ALPHABETIC char -- flipping a digit does nothing, which is exactly the
// bug the first version of this file shipped.
const firstLetter = BODY.split('').findIndex((c) => /[a-fA-F]/.test(c));
if (firstLetter < 0) throw new Error('PRECONDITION: USDC fixture has no letter to flip');
const flippedBody = BODY.slice(0, firstLetter)
  + (BODY[firstLetter] === BODY[firstLetter].toLowerCase()
    ? BODY[firstLetter].toUpperCase()
    : BODY[firstLetter].toLowerCase())
  + BODY.slice(firstLetter + 1);

const NONHEX_BODY = BODY.slice(0, 39) + 'z';        // exactly 40 chars, one non-hex
const PLUS_BODY = BODY.slice(0, 31) + '+123456789'; // exactly 40 chars, one '+'

const cases = [];
const add = (group, input, note, controlTarget) => {
  const c = { group, input, note, expect: validateAddress(input) };
  if (controlTarget) c.controlTarget = controlTarget; // which control MUST catch this
  cases.push(c);
};

// --- legal -------------------------------------------------------------------
add('legal', USDC, 'real USDC on Base, mixed case checksum valid');
add('legal', USDC.toLowerCase(), 'all lowercase: no checksum information, legal');
add('legal', '0x' + BODY.toUpperCase(), 'all uppercase: no checksum information, legal');
add('legal', BODY, 'no prefix: 40 hex digits is still one address');
add('legal', ZERO, 'zero address is structurally valid');
add('legal', WETH, 'WETH on Base, trailing zeros significant');
add('legal', VITALIK, 'vitalik.eth resolved address');
add('legal', '  ' + USDC + '  ', 'surrounding whitespace is trimmed, not rejected');

// --- refuse ------------------------------------------------------------------
add('refuse', '', 'empty string');
add('refuse', '0x', 'prefix with no body');
add('refuse', '0X', 'uppercase prefix, no body');
add('refuse', USDC.slice(0, 41), '39 hex digits, one short');
add('refuse', 'vitalik.eth', 'ENS name is not an address; too-short fires before non-hex');
add('refuse', '0x' + NONHEX_BODY, 'exactly 40 body chars, one non-hex: reaches the hex check');
add('refuse', '0x' + PLUS_BODY, 'exactly 40 body chars containing a plus sign');

// --- checksum ------------------------------------------------------------------
add('checksum', '0x' + flippedBody,
  `one letter case-flipped at body index ${firstLetter}, otherwise valid -> must be rejected`,
  'case-blind');
add('checksum', K.toChecksumAddress(USDC.toLowerCase()), 'canonical EIP-55 form re-derived, must be accepted');

// --- trap: silent-corruption group ---------------------------------------------
// Over-length bodies. A parser that slices, or that unwraps ABI padding, returns a
// real-looking address and raises nothing.
add('trap', USDC + 'a', '41 digits: slicing to 40 returns USDC silently', 'truncating');
add('trap', USDC + 'abc', '43 digits: slicing to 40 returns USDC silently', 'truncating');
add('trap', USDC + 'ffffffffffffffffff', '58 digits: eth-url-parser chain_id absorption shape', 'truncating');
add('trap', '0x' + '0'.repeat(24) + BODY,
  '64 digits, left-padded with 24 zeros: classic ABI uint256 encoding; unwrapping is a GUESS, must be refused',
  'padding');
add('trap', '0x' + 'f'.repeat(64), '64 f-digits: max uint256, not an address');
add('trap', BODY + '0'.repeat(24), '64 digits, right-padded: address-then-junk, must be refused');

// ---------------------------------------------------------------- PRECONDITIONS
const seen = new Set(cases.filter((c) => !c.expect.ok).map((c) => c.expect.reason));
const missing = REASONS.filter((r) => !seen.has(r));
if (missing.length) {
  console.error('PRECONDITION FAILED: fixtures produce no reason ' + missing.join(', '));
  for (const c of cases) console.error(`  ${(c.expect.ok ? 'ok' : c.expect.reason).padEnd(13)} ${JSON.stringify(c.input)}`);
  process.exit(2);
}
const groups = {};
for (const c of cases) groups[c.group] = (groups[c.group] || 0) + 1;
for (const g of ['legal', 'refuse', 'checksum', 'trap']) {
  if (!groups[g]) { console.error('PRECONDITION FAILED: empty group ' + g); process.exit(2); }
}
// every control must have at least one vector it is required to catch, otherwise the
// control is decorative -- exactly the "buggy regex present: true" mistake.
const targets = {};
for (const c of cases) if (c.controlTarget) targets[c.controlTarget] = (targets[c.controlTarget] || 0) + 1;
for (const [name, n] of Object.entries(targets)) {
  if (n === 0) { console.error('PRECONDITION FAILED: control has no target vectors: ' + name); process.exit(2); }
}
if (!targets.truncating || !targets.padding || !targets['case-blind']) {
  console.error('PRECONDITION FAILED: a control has no target vector: ' + JSON.stringify(targets));
  process.exit(2);
}

const V = {
  meta: {
    spec: 'EIP-681 address field structure + EIP-55 checksum',
    generated_by: 'address/gen-vectors.cjs',
    check_order: REASONS,
    reason_note: 'exactly these six values; refused cases carry a reason so a caller cannot conflate them',
    control_targets: targets,
  },
  address: cases,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(V, null, 2) + '\n');

console.log(`wrote ${path.relative(ROOT, OUT)}  total=${cases.length}`);
console.log('groups: ' + JSON.stringify(groups));
console.log(`refusal reasons: ${seen.size}/${REASONS.length} -> ${[...seen].sort().join(', ')}`);
console.log('control targets: ' + JSON.stringify(targets));
