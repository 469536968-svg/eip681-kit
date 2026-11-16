'use strict';
/**
 * Consumer-side verification of the address vectors, plus THREE negative controls.
 *
 * A vector file that everything passes is worthless. Each control is a real parser bug
 * measured in the wild; if a control stops being caught, the vectors have stopped
 * discriminating and this script exits 1.
 *
 *   NC1 truncating  body.slice(0,40)        -> the eth-url-parser@1.0.4 bug
 *   NC2 padding     unwrap 24-zero prefix   -> the "ABI-encode the address" guess
 *   NC3 case-blind  skip EIP-55             -> accepts any mixed-case garbage
 *
 * DESIGN NOTE (this cost me a full run): a control may only be scored on the vectors it
 * is *required* to catch, marked `controlTarget` in the vector file. Scoring a control
 * across a whole group conflates "this control is wrong" with "this vector isn't that
 * control's business" -- my first version reported MISSED for a control that was fine.
 *
 * And the silent-corruption proof asks: does the buggy parser ACCEPT an input the spec
 * REFUSES? Not "does it return a different address" -- truncation returning the intended
 * address is precisely the silent bug, so a difference test asks the wrong question.
 */
const fs = require('node:fs');
const K = require('../eip681.mjs');

const FILE = 'C:/Users/HUAWEI/workspace/eip681-kit/address/vectors/eip681-address-vectors.json';
const V = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const REASONS = V.meta.check_order;

// ---------------------------------------------------------------- reference
function validateAddress(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'empty' };
  const s = input.trim();
  if (s === '') return { ok: false, reason: 'empty' };
  let body = s, prefixed = false;
  if (/^0[xX]/.test(s)) { prefixed = true; body = s.slice(2); }
  if (body === '') return { ok: false, reason: 'prefix-only' };
  if (body.length < 40) return { ok: false, reason: 'too-short' };
  if (body.length > 40) return { ok: false, reason: 'too-long' };
  if (!/^[0-9a-fA-F]{40}$/.test(body)) return { ok: false, reason: 'non-hex' };
  const lower = body.toLowerCase();
  let checksummed = false;
  if (body !== lower && body !== body.toUpperCase()) {
    if (!K.isChecksumAddress('0x' + body)) return { ok: false, reason: 'bad-checksum' };
    checksummed = true;
  }
  return { ok: true, address: '0x' + lower, prefixed, checksummed };
}

// ---------------------------------------------------------------- controls
const truncating = (input) => {
  const s = String(input).trim().replace(/^0[xX]/, '');
  if (!/^[0-9a-fA-F]{40,}$/.test(s)) return { ok: false, reason: 'non-hex' };
  return { ok: true, address: '0x' + s.slice(0, 40).toLowerCase() }; // BUG
};

const padding = (input) => {
  const s = String(input).trim().replace(/^0[xX]/, '');
  if (!/^[0-9a-fA-F]+$/.test(s)) return { ok: false, reason: 'non-hex' };
  if (s.length === 64) return { ok: true, address: '0x' + s.slice(24).toLowerCase() }; // BUG
  if (s.length !== 40) return { ok: false, reason: s.length < 40 ? 'too-short' : 'too-long' };
  return { ok: true, address: '0x' + s.toLowerCase() };
};

const caseBlind = (input) => {
  const ref = validateAddress(input);
  if (!ref.ok && ref.reason === 'bad-checksum') {
    return { ok: true, address: '0x' + String(input).trim().replace(/^0[xX]/, '').toLowerCase() }; // BUG
  }
  return ref;
};

const CONTROLS = [
  ['truncating', 'eth-url-parser@1.0.4 slices the body', truncating],
  ['padding', 'ABI uint256 unwrap guess', padding],
  ['case-blind', 'ignores EIP-55 entirely', caseBlind],
];

// ---------------------------------------------------------------- 1. reproduce
let pass = 0, fail = 0;
const failures = [];
for (const c of V.address) {
  const got = validateAddress(c.input);
  if (JSON.stringify(got) === JSON.stringify(c.expect)) pass++;
  else {
    fail++;
    failures.push(`input=${JSON.stringify(c.input)}\n    expect ${JSON.stringify(c.expect)}\n    got    ${JSON.stringify(got)}`);
  }
}
console.log(`reproduce: ${pass} passed, ${fail} failed of ${V.address.length}`);
for (const f of failures) console.log('  FAIL ' + f);

// ---------------------------------------------------------------- 2. coverage
const seen = new Set(V.address.filter((c) => !c.expect.ok).map((c) => c.expect.reason));
const missing = REASONS.filter((r) => !seen.has(r));
const covOk = missing.length === 0;
console.log(`coverage: ${seen.size}/${REASONS.length} refusal reasons${covOk ? '' : ' MISSING ' + missing.join(',')}`);

// ---------------------------------------------------------------- 3. negative controls
console.log('\n--- negative controls (each scored ONLY on its target vectors) ---');
let controlsOk = true;
const controlDetail = {};
for (const [key, label, fn] of CONTROLS) {
  const subset = V.address.filter((c) => c.controlTarget === key);
  if (subset.length === 0) {
    console.log(`  NO-TARGET ${key}: no vector requires this control -- it is decorative`);
    controlsOk = false;
    continue;
  }
  let caught = 0, wronglyAgreed = 0;
  const d = [];
  for (const c of subset) {
    if (JSON.stringify(fn(c.input)) === JSON.stringify(c.expect)) {
      wronglyAgreed++;
      d.push(`    WRONGLY AGREED on ${JSON.stringify(c.input)}`);
    } else caught++;
  }
  const ok = caught === subset.length && wronglyAgreed === 0;
  if (!ok) controlsOk = false;
  controlDetail[key] = { caught, total: subset.length, wronglyAgreed };
  console.log(`  ${ok ? 'CAUGHT' : 'MISSED'} ${key.padEnd(12)} (${label}): caught ${caught}/${subset.length}, wrongly agreed ${wronglyAgreed}`);
  for (const line of d) console.log(line);
}

// ---------------------------------------------------------------- 4. silent corruption
// The question is NOT "does truncation return something different". Truncation
// returning the INTENDED address is exactly the silent bug: no error, wrong recipient.
// So: does the buggy parser ACCEPT an input the spec REFUSES?
console.log('\n--- silent-corruption proof (buggy parser accepts what spec refuses) ---');
let corruptionOk = true;
for (const c of V.address.filter((x) => x.group === 'trap' && x.controlTarget === 'truncating')) {
  const buggy = truncating(c.input);
  const specRefuses = c.expect.ok === false;
  const buggyAccepts = buggy.ok === true;
  const silent = specRefuses && buggyAccepts;
  if (!silent) corruptionOk = false;
  console.log(`  ${silent ? 'SILENT' : 'CAUGHT'}  ${JSON.stringify(c.input)}`);
  if (silent) {
    const intended = '0x' + String(c.input).replace(/^0[xX]/, '').slice(0, 40).toLowerCase();
    console.log(`           spec: ${c.expect.reason}  |  buggy returned ${buggy.address}`);
    console.log(`           recipient is a REAL address, no error raised${buggy.address === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' ? ' (it is USDC, the intended one)' : ''}`);
  }
}

const allOk = fail === 0 && covOk && controlsOk && corruptionOk;
console.log(`\nRESULT: ${allOk
  ? 'PASS (23 vectors reproduce, 6/6 reasons, 3/3 controls caught, truncation provably silent)'
  : 'FAIL'}`);
process.exitCode = allOk ? 0 : 1;
