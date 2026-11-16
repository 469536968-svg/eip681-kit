import { parseAmount, formatAmount, decodeParamValue } from './eip681-amount.mjs';

let pass = 0, fail = 0;
const ser = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x));
const eq = (name, got, want) => {
  const g = ser(got), w = ser(want);
  if (g === w) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${g}\n          want ${w}`); }
};

const ok = (name, raw, units, decimals = 0) =>
  eq(`${name}  "${raw}"${decimals ? ' @' + decimals + 'dp' : ''}`, parseAmount(raw, { decimals }), { ok: true, units });
const no = (name, raw, reason, decimals = 0) =>
  eq(`${name}  "${raw}"${decimals ? ' @' + decimals + 'dp' : ''} -> ${reason}`, parseAmount(raw, { decimals }), { ok: false, reason });

console.log('\n== 1. EIP-681 own examples, at wei precision ==');
ok('canonical exponent form', '2.014e18', 2014000000000000000n);
ok('bare integer', '1', 1n);
ok('zero', '0', 0n);
ok('leading zeros', '007', 7n);
ok('18-digit amount', '1000000000000000000', 1000000000000000000n);

console.log('\n== 2. exponent spellings are equivalent ==');
ok('lowercase e', '1e18', 10n ** 18n);
ok('uppercase E', '1E18', 10n ** 18n);
ok('explicit plus', '1e+18', 10n ** 18n);
ok('exponent beyond Number range', '1e40', 10n ** 40n);

console.log('\n== 3. whole-unit rule at wei precision ==');
ok('fraction that IS whole after scaling', '0.000000000000000001e36', 10n ** 18n);
no('fraction of a wei', '.5', 'fraction-of-a-unit');
no('negative exponent below one wei', '1e-18', 'fraction-of-a-unit');
no('explicit fraction of a wei', '0.1', 'fraction-of-a-unit');

console.log('\n== 4. the SAME strings become valid at token precision ==');
// Without `decimals`, a spec-legal "1.5 USDT" request is refused, because 1.5
// has no wei representation. This is why the parameter is not optional.
ok('1.5 USDT at 6dp', '1.5', 1500000n, 6);
ok('0.1 USDT at 6dp', '0.1', 100000n, 6);
ok('1 USDT at 6dp', '1', 1000000n, 6);
ok('1.5 ETH at 18dp', '1.5', 1500000000000000000n, 18);
ok('exactly 6dp is allowed', '0.000001', 1n, 6);
no('7dp is refused', '0.0000001', 'fraction-of-a-unit', 6);

console.log('\n== 5. refusals the spec names ==');
no('negative', '-1', 'negative');
no('negative at token precision', '-1.5', 'negative', 6);
no('hex', '0x10', 'hex-not-allowed');
no('negative hex', '-0x10', 'hex-not-allowed');
no('empty', '', 'empty');
no('whitespace only', '   ', 'empty');
no('two decimal points', '1.2.3', 'syntax');
no('dangling exponent', '1e', 'syntax');
no('letters', 'abc', 'syntax');
no('dot alone', '.', 'syntax');
no('plus with no digits', '+', 'syntax');

console.log('\n== 6. uint256 bound ==');
const maxU = (1n << 256n) - 1n;
no('2^256 is one past the bound', (1n << 256n).toString(), 'exceeds-uint256');
ok('2^256 - 1 is accepted', maxU.toString(), maxU);
no('a 400-digit amount', '9'.repeat(400), 'exceeds-uint256');

console.log('\n== 7. whitespace tolerance (spec silent) ==');
ok('surrounding spaces accepted', '  42  ', 42n);
ok('tabs accepted', '\t42\n', 42n);

console.log('\n== 8. DIFFERENTIAL: exact BigInt vs the naive Number path ==');
const naiveParse = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, reason: 'not-integer' };
  return { ok: true, units: BigInt(n) };
};
const CASES = ['21000000000000000001', '1.000000000000000001e18', '9007199254740993'];
let divergent = 0;
for (const c of CASES) {
  const exact = parseAmount(c), naive = naiveParse(c);
  const differs = exact.ok && naive.ok && exact.units !== naive.units;
  if (differs) divergent++;
  console.log(`  ${differs ? 'DIVERGES' : 'agrees  '}  "${c}"`);
  console.log(`      exact ${exact.ok ? exact.units + 'n' : exact.reason}`);
  console.log(`      naive ${naive.ok ? naive.units + 'n' : naive.reason}`);
}
eq('naive Number path diverges on all three', divergent, 3);

console.log('\n== 9. percent-decoding ==');
eq('  "1%30" decodes to "10"', decodeParamValue('1%30'), '10');
eq('  "2.014e18" needs no decoding', decodeParamValue('2.014e18'), '2.014e18');
eq('  malformed %ZZ is rejected, not silently kept', decodeParamValue('%ZZ'), null);

console.log('\n== 10. round-trip: parse then format is identity ==');
for (const [u, d] of [[1500000n, 6], [1n, 6], [10n ** 18n, 18], [2014000000000000000n, 18], [0n, 0], [123456789n, 6]]) {
  const f = formatAmount(u, d);
  eq(`  ${u}n @${d}dp -> "${f}" -> back`, parseAmount(f, { decimals: d }), { ok: true, units: u });
}

console.log('\n== 11. two DIFFERENT inputs both look like an amount; only one is one ==');
// A URI query value is a DECIMAL amount ("1.5"), while an ERC-20 `uint256`
// argument inside calldata is ALREADY base units ("1500000"). Feeding the
// base-unit integer into this parser with decimals=6 silently multiplies the
// amount by 10^6. It does not error -- it succeeds with the wrong number. That
// silence, not overflow, is the trap. (My earlier assertion expected overflow
// and was simply wrong: 1e18 * 1e6 = 1e24 is well under 2^256.)
const rawBaseUnits = '1500000';           // 1.5 USDT, already atomic
const decimalAmount = '1.5';              // same money, as written in a URI
const asDecimal = parseAmount(decimalAmount, { decimals: 6 }).units;
const misparsed = parseAmount(rawBaseUnits, { decimals: 6 }).units;
eq('the decimal spelling gives the right units', asDecimal, 1500000n);
eq('the base-unit spelling is inflated 10^6x, silently', misparsed, 1500000000000n);
eq('and the inflation factor is exactly 10^6', misparsed / asDecimal, 1000000n);
// Whereas parsing base units with decimals=0 is correct:
eq('base units must be parsed at 0dp', parseAmount(rawBaseUnits).units, 1500000n);

console.log('\n== 12. chain decimals change the money, not just the units ==');
const w6 = parseAmount('1', { decimals: 6 }).units;
const w18 = parseAmount('1', { decimals: 18 }).units;
eq('"1" at 6dp  -> 1e6 base units', w6, 1000000n);
eq('"1" at 18dp -> 1e18 base units', w18, 10n ** 18n);
eq('the ratio is 10^12 (BSC USDT vs Arbitrum USDT)', w18 / w6, 10n ** 12n);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail === 0 ? 0 : 1);
