'use strict';
/**
 * Validate the shipped vector file against the shipped parser.
 *
 * This is the consumer side, and it is deliberately a SEPARATE program from the
 * generator: the generator could emit anything and still "pass". This re-reads the
 * JSON from disk and asserts every case independently.
 *
 * Also includes a NEGATIVE CONTROL: a deliberately float-based parser must FAIL a
 * known subset. If the float parser passes everything, the vectors are not
 * discriminating anything and are worthless as evidence.
 */
const fs = require('node:fs');
const { parseAmount, formatAmount, decodeParamValue } = require('./eip681-amount.mjs');

const V = JSON.parse(fs.readFileSync('C:/Users/HUAWEI/workspace/eip681-kit/amount/vectors/eip681-amount-vectors.json', 'utf8'));

let pass = 0, fail = 0;
const failures = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ser = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

for (const c of V.amount) {
  const got = ser(parseAmount(c.input, { decimals: c.decimals }));
  if (eq(got, c.expect)) pass++;
  else { fail++; failures.push(`amount input=${JSON.stringify(c.input)} d=${c.decimals}\n    expect ${JSON.stringify(c.expect)}\n    got    ${JSON.stringify(got)}`); }
}

for (const c of V.format) {
  const got = formatAmount(BigInt(c.units), c.decimals);
  if (got === c.expect) pass++;
  else { fail++; failures.push(`format units=${c.units} d=${c.decimals}\n    expect ${JSON.stringify(c.expect)}\n    got    ${JSON.stringify(got)}`); }
}

for (const c of V.decode) {
  const got = decodeParamValue(c.input);
  if (got === c.expect) pass++;
  else { fail++; failures.push(`decode input=${JSON.stringify(c.input)}\n    expect ${JSON.stringify(c.expect)}\n    got    ${JSON.stringify(got)}`); }
}

console.log(`strict re-check: ${pass} passed, ${fail} failed  (vectors: amount=${V.amount.length} format=${V.format.length} decode=${V.decode.length})`);
for (const f of failures) console.log('  FAIL ' + f);

// ---- negative control: a naive float parser must fail the differential group ----
const naive = (s, decimals) => {
  const n = Number(s); // the exact defect under test
  if (!isFinite(n) || n < 0) return { ok: false };
  const units = Math.round(n * Math.pow(10, decimals));
  if (!isFinite(units)) return { ok: false };
  if (Math.abs(units - n * Math.pow(10, decimals)) > 1e-9) return { ok: false, reason: 'fraction-of-a-unit' };
  return { ok: true, units: BigInt(units).toString() };
};

let naiveCaught = 0;
const naiveMissed = [];
for (const c of V.amount) {
  if (c.group !== 'differential') continue;
  const got = naive(c.input, c.decimals);
  const agrees = c.expect.ok ? (got.ok && got.units === c.expect.units) : !got.ok;
  if (!agrees) naiveCaught++;
  else naiveMissed.push(`${c.input} (naive wrongly agreed: ${JSON.stringify(got)})`);
}
console.log(`negative control: float parser caught on ${naiveCaught} differential case(s), wrongly agreed on ${naiveMissed.length}`);
for (const m of naiveMissed) console.log('  CONTROL-DID-NOT-DISCRIMINATE ' + m);

const ok = fail === 0 && naiveCaught > 0;
console.log(ok ? 'RESULT: PASS (vectors reproduce, and they discriminate against float arithmetic)'
               : 'RESULT: FAIL');
process.exitCode = ok ? 0 : 1;
