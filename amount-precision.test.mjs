// eip681-amount-precision.mjs
//
// Self-contained verification of EIP-681 amount-handling defects found while
// answering MetaMask/metamask-mobile#37818. Drives the PUBLISHED packages
// (eth-url-parser, @metamask/controller-utils) -- no app checkout required.
//
// Run:  npm i eth-url-parser @metamask/controller-utils
//       node eip681-amount-precision.mjs
//
// Two predicates, deliberately separate:
//   hasPositiveAmount(params)          -> is there a real, non-zero amount?
//   isRedesignedConfirmationCompatible -> amount present AND routing allowed?
// Conflating them is how the `approve` case got mis-asserted on the first run.

import { toHex } from '@metamask/controller-utils';
import { parse } from 'eth-url-parser';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
};
const tryToHex = (v) => { try { return { hex: toHex(v) }; } catch (e) { return { err: e.message }; } };

// --- exact expansion of exponent notation (string math, no float precision loss) ---
export function expandExponent(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const s = String(value);
  if (/^-?\d+$/.test(s)) return s;
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, intPart, fracPart = '', expRaw] = m;
  const digits = intPart + fracPart;
  const shift = parseInt(expRaw, 10) - fracPart.length;
  const body = shift >= 0 ? digits + '0'.repeat(shift) : digits.slice(0, shift) + '.' + digits.slice(shift);
  return sign + body;
}

// PREDICATE 1: amount only. Normalise BEFORE the digit test; require strictly > 0.
export function hasPositiveAmount(params) {
  if (!params) return false;
  const raw = params.uint256 !== undefined ? params.uint256 : params.value;
  if (raw === undefined || raw === null) return false;
  if (String(raw).trim() === '') return false;
  const expanded = String(expandExponent(String(raw)));
  if (!/^\d+$/.test(expanded)) return false;
  return BigInt(expanded) > 0n;
}

const ETH_ACTIONS = { TRANSFER: 'transfer', APPROVE: 'approve' };

// PREDICATE 2: routing decision. Amount present AND not a legacy-only action.
export function isRedesignedConfirmationCompatible(request) {
  if (!hasPositiveAmount(request.parameters)) return false;
  switch (request.function_name) {
    case ETH_ACTIONS.APPROVE: return false;
    case ETH_ACTIONS.TRANSFER:
    default: return true;
  }
}

const RCPT = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

console.log('=== FINDING 1: parser emits exponent notation for large amounts ===');
{
  const r = parse(`ethereum:${RCPT}@1?value=1000000000000000000000`);
  const raw = String(r.parameters.value);
  console.log(`  raw value = ${JSON.stringify(raw)}`);
  ok('21-digit amount comes back as exponent notation', /[eE]/.test(raw), raw);
  ok('naive /^\\d+$/ would REJECT it (the bug)', /^\d+$/.test(raw) === false);
  ok('expandExponent recovers the exact digits',
     expandExponent(raw) === '1000000000000000000000', expandExponent(raw));
}

console.log('\n=== FINDING 2: toHex rejects exponent notation -> uint256/value asymmetry ===');
{
  const bad = tryToHex('1e+21');
  console.log(`  toHex("1e+21") -> ${bad.err ? 'THROWS: ' + bad.err : bad.hex}`);
  ok('toHex throws on raw exponent notation', !!bad.err);
  const good = tryToHex(String(expandExponent('1e+21')));
  ok('toHex succeeds after exact expansion', good.hex === '0x3635c9adc5dea00000', good.hex);

  const erc20 = parse(`ethereum:${USDC}@1/transfer?address=${RCPT}&uint256=1000000000000000000000`);
  const native = parse(`ethereum:${RCPT}@1?value=1000000000000000000000`);
  const u = tryToHex(String(expandExponent(String(erc20.parameters.uint256))));
  const v = tryToHex(String(native.parameters.value));
  console.log(`  uint256 (normalised) -> ${u.err ? 'THROWS' : u.hex}`);
  console.log(`  value   (raw)        -> ${v.err ? 'THROWS: ' + v.err : v.hex}`);
  ok('uint256 path is safe only because it is pre-normalised', !u.err);
  ok('native value path throws when not normalised (asymmetry)', !!v.err);
  ok('native 21-digit link therefore still qualifies for confirmation',
     hasPositiveAmount(native.parameters) === true);
}

console.log('\n=== FINDING 3: explicit zero is truthy, empty is not; neither should confirm ===');
{
  const cases = [
    ['?value=0',    `ethereum:${RCPT}@1?value=0`],
    ['?value=',     `ethereum:${RCPT}@1?value=`],
    ['?uint256=0',  `ethereum:${USDC}@1/transfer?address=${RCPT}&uint256=0`],
    ['?uint256=',   `ethereum:${USDC}@1/transfer?address=${RCPT}&uint256=`],
  ];
  for (const [label, url] of cases) {
    const p = parse(url).parameters;
    const raw = p.uint256 !== undefined ? p.uint256 : p.value;
    const truthy = !!raw;
    const hex = tryToHex(raw);
    console.log(`  ${label.padEnd(11)} raw=${JSON.stringify(raw).padEnd(4)} truthy=${String(truthy).padEnd(5)} toHex=${hex.err ? 'THROWS' : hex.hex}`);
    ok(`${label}: routed to prompt (never confirm a 0-value tx)`,
       isRedesignedConfirmationCompatible(parse(url)) === false);
  }
  ok('"0" is truthy, "" is falsy -> truthiness is the wrong test', (!!'0') === true && (!!'') === false);
}

console.log('\n=== Fuzz: predicate must never drop a legitimate amount (1..40 digits) ===');
{
  let checked = 0, dropped = 0, naiveDropped = 0;
  for (let digits = 1; digits <= 40; digits++) {
    const amt = '1' + '9'.repeat(digits - 1);
    for (const form of ['value', 'uint256']) {
      const url = form === 'value'
        ? `ethereum:${RCPT}@1?value=${amt}`
        : `ethereum:${USDC}@1/transfer?address=${RCPT}&uint256=${amt}`;
      let parsed; try { parsed = parse(url); } catch { continue; }
      checked++;
      if (!hasPositiveAmount(parsed.parameters)) { dropped++; console.log(`    DROPPED ${digits}d ${form}=${amt}`); }
      const rawAmt = parsed.parameters.uint256 !== undefined ? parsed.parameters.uint256 : parsed.parameters.value;
      if (!/^\d+$/.test(String(rawAmt))) naiveDropped++;
    }
  }
  console.log(`  checked=${checked}  corrected_dropped=${dropped}  naive_would_drop=${naiveDropped}`);
  ok('corrected predicate keeps every amount across 1..40 digits (both forms)', dropped === 0 && checked > 60);
  ok('naive /^\\d+$/ would drop 38 of them (fix is load-bearing)', naiveDropped === 38, String(naiveDropped));
}

console.log('\n=== Routing guards: legacy behaviour preserved (function_name matters) ===');
{
  const expect = [
    [`ethereum:${RCPT}@1`,                                                    false, 'native, no amount'],
    [`ethereum:${RCPT}@1?value=1000`,                                         true,  'native, amount'],
    [`ethereum:${USDC}@1/transfer?address=${RCPT}`,                            false, 'erc20, no amount'],
    [`ethereum:${USDC}@1/transfer?address=${RCPT}&uint256=1000000`,             true,  'erc20 transfer'],
    [`ethereum:${USDC}@1/approve?address=${RCPT}&uint256=1000000`,             false, 'approve stays legacy'],
  ];
  for (const [url, want, label] of expect) {
    const got = isRedesignedConfirmationCompatible(parse(url));
    ok(`${label.padEnd(24)} -> ${want}`, got === want, String(got));
  }
  // The exact defect the first run exposed: amount-only predicate cannot decide routing.
  const approve = parse(`ethereum:${USDC}@1/approve?address=${RCPT}&uint256=1000000`);
  ok('hasPositiveAmount(approve)=true but routing=false -> predicates must stay separate',
     hasPositiveAmount(approve.parameters) === true &&
     isRedesignedConfirmationCompatible(approve) === false);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
