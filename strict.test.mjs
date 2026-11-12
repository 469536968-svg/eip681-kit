// strict.test.mjs — executed assertions for strict.mjs.
// Zero dependencies. Run: node strict.test.mjs
//
// Every assertion below is derived from MEASURED behaviour of the shipped
// eip681.mjs, not from reading the spec and hoping. The probe that established
// the base facts:
//
//   ethereum:0x..dEaD@1?value=1000&foo=bar  -> ok=true, params has foo, warnings=[]
//   ethereum:0x6B17..d0F@1/transfer?address=..&uint256=1000 -> ok=true, amount=1000n
//
// The suite is written so that DELETING the leak guard makes it fail. A green run
// that cannot go red is not evidence of anything.

import { parseStrict } from './strict.mjs';
import { parse as baseParse } from './eip681.mjs';

let passed = 0;
let failed = 0;

// JSON.stringify throws on BigInt ("Do not know how to serialize a BigInt") and
// that throw would crash the runner, hiding every later assertion. Format by hand.
function show(v) {
  if (typeof v === 'bigint') return v.toString() + 'n';
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(show).join(',') + ']';
  if (typeof v === 'object') {
    const ks = Object.keys(v);
    return '{' + ks.map((k) => k + ':' + show(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail === undefined ? '' : '  <- ' + detail}`);
  }
}

const DEAD = '0x000000000000000000000000000000000000dEaD';
const TOKEN = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

// Every decision-bearing field a rejected result must NOT expose.
const PAYLOAD_FIELDS = ['target', 'recipient', 'amount', 'canonical'];

function payloadIsEmpty(r) {
  for (const f of PAYLOAD_FIELDS) {
    const v = r[f];
    if (v !== null && v !== undefined) return `${f}=${show(v)}`;
  }
  if (r.params && Object.keys(r.params).length > 0) return 'params=' + show(r.params);
  return null;
}

function checkBlank(name, r) {
  const leak = payloadIsEmpty(r);
  check(name, leak === null, leak === null ? undefined : 'LEAKED ' + leak);
}

console.log('\n== 1. ACCEPT: well-formed strict requests survive ==');

const nativeOk = parseStrict(`ethereum:${DEAD}@1?value=1000`);
check('native transfer accepted', nativeOk.ok === true, show(nativeOk.errors));
check('native amount preserved as bigint', nativeOk.amount === 1000n, show(nativeOk.amount));
check('native target preserved', nativeOk.target === DEAD, show(nativeOk.target));
check('accepted result has rejected=null', nativeOk.rejected === null, show(nativeOk.rejected));

const transferOk = parseStrict(`ethereum:${TOKEN}@1/transfer?address=${VITALIK}&uint256=1000`);
check('token transfer accepted', transferOk.ok === true, show(transferOk.errors));
check('transfer recipient preserved', transferOk.recipient === VITALIK, show(transferOk.recipient));
check('transfer amount preserved as bigint', transferOk.amount === 1000n, show(transferOk.amount));
check('isTokenTransfer flagged', transferOk.isTokenTransfer === true, show(transferOk.isTokenTransfer));

console.log('\n== 2. THE GAP: unknown params (base accepts, strict must not) ==');

const ghost = `ethereum:${DEAD}@1?value=1000&foo=bar`;
const baseGhost = baseParse(ghost);
const strictGhost = parseStrict(ghost);
// These two assertions are the whole justification for this module.
check('base parser ACCEPTS unknown param (documents the gap)', baseGhost.ok === true, show(baseGhost.ok));
check('base parser leaks foo into params', baseGhost.params.foo === 'bar', show(baseGhost.params));
check('strict parser REJECTS unknown param', strictGhost.ok === false, show(strictGhost.ok));
check('strict rejection names the offending key', /foo/.test(String(strictGhost.rejected)), show(strictGhost.rejected));
checkBlank('rejected unknown-param request is blanked', strictGhost);

const ghostTransfer = `ethereum:${TOKEN}@1/transfer?address=${VITALIK}&uint256=1000&foo=1`;
check('strict rejects unknown param on transfer too', parseStrict(ghostTransfer).ok === false);

const opted = parseStrict(ghost, { allowUnknownParams: true });
check('allowUnknownParams opt-out restores acceptance', opted.ok === true, show(opted.errors));

const extraOk = parseStrict(`ethereum:${DEAD}@1?value=1000&gas=21000`, { extraAllowedKeys: ['gas'] });
check('extraAllowedKeys permits a named extra key', extraOk.ok === true, show(extraOk.errors));
check('extraAllowedKeys still rejects other unknown keys',
  parseStrict(`ethereum:${DEAD}@1?value=1000&gas=21000&zzz=1`, { extraAllowedKeys: ['gas'] }).ok === false);

console.log('\n== 3. AMBIGUITY: chain id and missing transfer parameters ==');

// A bare address with no @chainId is unambiguous only if you already know the chain.
const noChain = parseStrict(`ethereum:${DEAD}?value=1000`);
check('missing chainId rejected by default', noChain.ok === false, show(noChain.ok));
check('missing chainId names the rule', noChain.rejected === 'chain-id-required', show(noChain.rejected));
checkBlank('missing-chainId result is blanked', noChain);
check('chainId optional when explicitly waived',
  parseStrict(`ethereum:${DEAD}?value=1000`, { requireChainId: false }).ok === true);

// The dangerous one: a transfer with no uint256 is read as open-ended or zero.
const noAmount = parseStrict(`ethereum:${TOKEN}@1/transfer?address=${VITALIK}`);
check('transfer without uint256 rejected', noAmount.ok === false, show(noAmount.ok));
check('transfer without uint256 names the rule', noAmount.rejected === 'amount-required', show(noAmount.rejected));
checkBlank('transfer-without-amount result is blanked', noAmount);

const noRecipient = parseStrict(`ethereum:${TOKEN}@1/transfer?uint256=1000`);
check('transfer without recipient rejected', noRecipient.ok === false, show(noRecipient.ok));
// MEASURED, not assumed: the base parser ALREADY refuses a /transfer? with no
// address=, so the strict recipient-required rule is never reached on this path.
// Asserting base-error here is the honest expectation. The strict rule stays in
// strict.mjs as defence-in-depth for shapes base might accept in future versions.
check('missing recipient is refused before the strict rule is reached',
  noRecipient.rejected === 'base-error', show(noRecipient.rejected));
checkBlank('transfer-without-recipient result is blanked', noRecipient);

console.log('\n== 4. NO FALSE ACCEPT: base errors must never become passes ==');

for (const bad of [
  '',
  'not-a-uri',
  'bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  `ethereum:${DEAD}@1?value=abc`,
  'ethereum:notanaddress@1?value=1',
]) {
  const r = parseStrict(bad);
  check('base error stays an error: ' + (bad === '' ? '<empty>' : bad.slice(0, 42)),
    r.ok === false && r.rejected === 'base-error', show(r.rejected));
  checkBlank('  and is blanked', r);
}

console.log('\n== 5. INVARIANT: strict can never upgrade a base failure ==');

// Exhaustive over the rejection corpus: no options combination may yield ok:true
// for input the base parser itself refused.
const baseFailures = ['', 'nope', `ethereum:${DEAD}@1?value=abc`, 'ethereum:@1?value=1'];
const optionSets = [
  {},
  { requireChainId: false },
  { requireAmount: false, requireRecipient: false },
  { allowUnknownParams: true, requireChainId: false, requireAmount: false, requireRecipient: false },
];
let upgraded = 0;
for (const bad of baseFailures) {
  if (baseParse(bad).ok === true) continue; // only consider inputs base refused
  for (const o of optionSets) {
    if (parseStrict(bad, o).ok === true) upgraded++;
  }
}
check('no option set upgrades a base failure', upgraded === 0, 'upgraded=' + upgraded);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
