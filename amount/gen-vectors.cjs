'use strict';
/**
 * Generate EIP-681 amount conformance vectors BY RUNNING THE PARSER.
 *
 * Nothing in the output JSON is hand-written: every `expect` block is the actual
 * return value of the shipped implementation. If the implementation is wrong, the
 * vectors are wrong in the same direction and the self-check cannot tell -- so the
 * vectors are only trustworthy because the 52-assertion suite pins the semantics
 * independently first. That ordering is the whole point.
 */
const fs = require('node:fs');
const { parseAmount, formatAmount, decodeParamValue } = require('C:/Users/HUAWEI/workspace/eip681-kit/amount/eip681-amount.mjs');

// Serialize BigInt as a decimal string; JSON has no integer type that survives 2^53.
const ser = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

const amountCases = [];
const addA = (input, decimals, group, why) => {
  amountCases.push({ group, why, input, decimals, expect: ser(parseAmount(input, { decimals })) });
};

// --- group: legal decimal amounts, wei precision (decimals = 0) -------------
addA('1', 0, 'wei-legal', 'bare integer');
addA('0', 0, 'wei-legal', 'zero is legal and must not be treated as falsy');
addA('007', 0, 'wei-legal', 'leading zeros carry no value');
addA('42', 0, 'wei-legal', 'plain integer');
addA('2.014e18', 0, 'wei-legal', 'the canonical EIP-681 example; mantissa x exponent is exact');
addA('1e18', 0, 'wei-legal', 'lowercase exponent');
addA('1E18', 0, 'wei-legal', 'uppercase exponent is equivalent');
addA('1e+18', 0, 'wei-legal', 'explicit plus in exponent is equivalent');
addA('1e40', 0, 'wei-legal', 'exponent beyond Number range must still be exact');
addA('1000000000000000000', 0, 'wei-legal', '18-digit literal');
addA('0.000000000000000001e36', 0, 'wei-legal',
  'CRITICAL: has a fraction part AND an exponent, yet is a whole 1e18 wei. '
  + 'Any guard of the form "reject if it contains a dot" fails here.');
addA('  42  ', 0, 'wei-legal', 'surrounding spaces are tolerated (spec is silent)');
addA('\t42\n', 0, 'wei-legal', 'tabs and newlines are tolerated');

// --- group: legal at a token precision (spec: "wei OR TOKEN UNITS") ---------
addA('1.5', 6, 'token-legal', 'no wei representation, but exactly 1500000 base units of a 6-decimal token');
addA('0.1', 6, 'token-legal', '100000 base units at 6dp');
addA('1', 6, 'token-legal', '1 whole token = 1e6 base units');
addA('0.000001', 6, 'token-legal', 'the smallest 6dp unit is exactly 1');
addA('1.5', 18, 'token-legal', 'same string, different token, different units');
addA('0.1', 18, 'token-legal', '1e17 base units at 18dp');
addA('1.5', 8, 'token-legal', '8dp (BTC-style) = 150000000');

// --- group: refusals, each with its OWN reason ------------------------------
addA('.5', 0, 'refuse', 'fraction of a wei');
addA('0.1', 0, 'refuse', 'fraction of a wei, spelled plainly');
addA('1e-18', 0, 'refuse', 'negative exponent goes below one wei');
addA('0.0000001', 6, 'refuse', '7 decimals exceeds a 6dp token');
addA('-1', 0, 'refuse', 'negative');
addA('-1.5', 6, 'refuse', 'negative at token precision');
addA('0x10', 0, 'refuse', 'hex is not a decimal amount');
addA('-0x10', 0, 'refuse', 'negative hex');
addA('', 0, 'refuse', 'empty string');
addA('   ', 0, 'refuse', 'whitespace only is empty, not zero');
addA('1.2.3', 0, 'refuse', 'two decimal points');
addA('1e', 0, 'refuse', 'dangling exponent');
addA('abc', 0, 'refuse', 'letters');
addA('.', 0, 'refuse', 'dot alone');
addA('+', 0, 'refuse', 'sign with no digits');

// --- group: uint256 boundary ------------------------------------------------
const MAXU = (1n << 256n) - 1n;
addA(MAXU.toString(), 0, 'uint256', '2^256-1 is the largest legal amount');
addA((1n << 256n).toString(), 0, 'uint256', '2^256 is one past the bound and must be refused');
addA('9'.repeat(400), 0, 'uint256', 'a 400-digit amount cannot fit');

// --- group: differential -- these are the ones a double-based parser fails --
addA('9007199254740993', 0, 'differential', '2^53+1: the first integer a double cannot represent');
addA('21000000000000000001', 0, 'differential', 'low digits lost by a 53-bit mantissa');
addA('1.000000000000000001e18', 0, 'differential', 'fraction that only survives exact arithmetic');

// --- group: the base-units trap, stated as behavior -------------------------
addA('1500000', 6, 'trap', 'WRONG-ON-PURPOSE: base units parsed as a decimal amount are inflated 1e6x, silently');
addA('1500000', 0, 'trap', 'base units parsed at 0dp are correct');

const formatCases = [];
for (const [units, decimals, why] of [
  [1500000n, 6, '1.5 USDT'],
  [1n, 6, 'smallest 6dp unit'],
  [10n ** 18n, 18, 'one whole 18dp token'],
  [2014000000000000000n, 18, 'the canonical EIP-681 example'],
  [0n, 0, 'zero must format as "0", not ""'],
  [123456789n, 6, 'mixed precision'],
  [10n ** 24n, 6, 'amount far above 2^53 must format exactly'],
]) {
  formatCases.push({ why, units: units.toString(), decimals, expect: formatAmount(units, decimals) });
}

const decodeCases = [];
for (const [input, why] of [
  ['1%30', 'percent-encoded digit'],
  ['2.014e18', 'no encoding needed'],
  ['%ZZ', 'malformed escape must be refused, not passed through'],
  ['1e18', 'plain'],
  ['1%2E5', 'encoded dot'],
]) {
  decodeCases.push({ why, input, expect: decodeParamValue(input) });
}

const out = {
  spec: 'EIP-681 amount / uint256 conformance vectors',
  version: 1,
  generatedAt: new Date().toISOString(),
  generator: 'eip681-kit amount/gen-vectors.cjs',
  method:
    'Every expect block is the actual return value of eip681-amount.mjs, obtained by running it. '
    + 'No expectation is hand-written. The semantics are pinned independently by '
    + 'amount/eip681-amount.test.mjs (52 assertions), which is what makes these vectors '
    + 'evidence rather than a tautology.',
  schema: {
    amount: '{ input: string, decimals: integer, expect: {ok:true,units:string} | {ok:false,reason:string} }',
    format: '{ units: string (base units, decimal), decimals: integer, expect: string }',
    decode: '{ input: string, expect: string | null }',
    note: 'units are decimal STRINGS because 2^256 exceeds JSON number precision',
  },
  refusalReasons: ['empty', 'syntax', 'negative', 'hex-not-allowed', 'fraction-of-a-unit', 'exceeds-uint256'],
  counts: { amount: amountCases.length, format: formatCases.length, decode: decodeCases.length },
  amount: amountCases,
  format: formatCases,
  decode: decodeCases,
};

fs.mkdirSync('C:/Users/HUAWEI/workspace/eip681-kit/amount/vectors',{recursive:true});fs.writeFileSync('C:/Users/HUAWEI/workspace/eip681-kit/amount/vectors/eip681-amount-vectors.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote amount/vectors/eip681-amount-vectors.json  amount=${amountCases.length} format=${formatCases.length} decode=${decodeCases.length}`);
const byGroup = {};
for (const c of amountCases) byGroup[c.group] = (byGroup[c.group] || 0) + 1;
console.log('groups: ' + JSON.stringify(byGroup));
const reasons = {};
for (const c of amountCases) if (!c.expect.ok) reasons[c.expect.reason] = (reasons[c.expect.reason] || 0) + 1;
console.log('refusal reasons covered: ' + JSON.stringify(reasons));
