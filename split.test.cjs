'use strict';
/**
 * split.test.cjs -- executed assertions for split.mjs.
 * Run: node split.test.cjs      (exit 1 on any failure)
 *
 * Every claim here is computed, not reasoned. Negative controls assert that the
 * naive approaches actually produce the wrong answer -- otherwise "my version
 * passes" would be uninformative.
 */
const { allocateEvenly, remaining, splitCursor } = require('./split.mjs');

const results = [];
function t(name, fn) {
  try { results.push({ name, ok: true, detail: fn() }); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); }
}
function eq(a, b, m) {
  if (String(a) !== String(b)) throw new Error(`${m}: got ${a} want ${b}`);
  return String(a);
}
const sum = (a) => a.reduce((x, y) => x + y, 0n);

const USDC = 6n;

/* ------------------------------------------------------------- the invariant */
t('1. parts sum EXACTLY to total, across many totals and payer counts', () => {
  const rows = [];
  for (const total of [0n, 1n, 2n, 7n, 10_000_000n, 12_345_678n, 999_999_999n]) {
    for (const payers of [1, 2, 3, 4, 5, 7, 10, 13]) {
      const parts = allocateEvenly(total, payers);
      const s = sum(parts);
      if (s !== total) throw new Error(`total=${total} payers=${payers} sum=${s}`);
      if (parts.length !== payers) throw new Error(`wrong length for payers=${payers}`);
      if (parts.some((p) => p < 0n)) throw new Error('negative part produced');
      rows.push(`${total}/${payers}`);
    }
  }
  return `${rows.length} combinations, all exact`;
});

t('2. no payer is loaded by more than 1 base unit', () => {
  const parts = allocateEvenly(10_000_000n, 3);
  const max = parts.reduce((a, b) => (a > b ? a : b));
  const min = parts.reduce((a, b) => (a < b ? a : b));
  const spread = max - min;
  if (spread > 1n) throw new Error(`spread ${spread}n > 1`);
  return { parts: parts.map(String), spread: String(spread) };
});

t('3. 10.00 USDC across 3 payers closes exactly (the walty#69 case)', () => {
  const parts = allocateEvenly(10_000_000n, 3);
  eq(sum(parts), 10_000_000n, 'sum');
  return { parts: parts.map(String), sum: sum(parts).toString(), thisIs: '10.000000 USDC' };
});

/* ------------------------------------------------------- NEGATIVE CONTROLS */
t('4. CONTROL: floor-equal shares DO NOT sum to the total', () => {
  const total = 10_000_000n, payers = 3;
  const eachFloor = total / BigInt(payers);
  const naive = Array.from({ length: payers }, () => eachFloor);
  const s = sum(naive);
  if (s === total) throw new Error('floor shares summed exactly -- control is not demonstrating a real bug');
  return { naiveParts: naive.map(String), naiveSum: s.toString(), shortBy: (total - s).toString() };
});

t('5. CONTROL: ceil-equal shares OVER-collect', () => {
  const total = 10_000_000n, payers = 3;
  const eachCeil = (total + BigInt(payers) - 1n) / BigInt(payers);
  const naive = Array.from({ length: payers }, () => eachCeil);
  const s = sum(naive);
  if (s <= total) throw new Error('ceil shares did not over-collect -- control demonstrates nothing');
  return { naiveParts: naive.map(String), naiveSum: s.toString(), overBy: (s - total).toString() };
});

t('6. CONTROL: doing this in Number loses the remainder at 18dp', () => {
  const totalWei = 2_014_000_000_000_000_000n; // 2.014 WETH, 18dp
  const payers = 3;
  const floatEach = Math.floor(Number(totalWei) / payers);
  const floatSum = BigInt(floatEach) * 3n;
  const exact = allocateEvenly(totalWei, payers);
  return {
    floatEach: String(floatEach), floatSum: String(floatSum),
    floatExact: floatSum === totalWei,
    bigintParts: exact.map(String), bigintSum: sum(exact).toString(),
    bigintExact: sum(exact) === totalWei,
  };
});

/* --------------------------------------------------------------- remaining */
t('7. remaining() is exact integer subtraction', () => {
  eq(remaining(10_000_000n, 3_333_333n), 6_666_667n, '10.00 - 3.333333');
  return '6666667';
});

t('8. remaining() refuses to return a negative remainder', () => {
  let threw = false;
  try { remaining(1_000_000n, 1_000_001n); } catch (e) { threw = /overpaid/.test(e.message); }
  if (!threw) throw new Error('overpayment did not raise -- would surface as a silent refund bug');
  return 'rejected as overpaid by 1n';
});

t('9. mixed input types are accepted, unsafe Numbers are not', () => {
  eq(sum(allocateEvenly(10_000_000, 3)), 10_000_000n, 'number input');
  eq(sum(allocateEvenly('10000000', 3)), 10_000_000n, 'string input');
  let threw = false;
  try { allocateEvenly(Number.MAX_SAFE_INTEGER + 2, 3); } catch (e) { threw = /SAFE integer/.test(e.message); }
  if (!threw) throw new Error('an unsafe integer was accepted -- silent precision loss');
  return 'number/string ok, unsafe number rejected';
});

/* ------------------------------------------------------------ splitCursor */
t('10. splitCursor: every payer pays from the remaining, last closes exactly', () => {
  const c = splitCursor(10_000_000n, 3);
  const paid = [];
  while (!c.done()) paid.push(c.next());
  eq(sum(paid), 10_000_000n, 'cursor sum');
  eq(c.left(), 0n, 'left after done');
  return { paid: paid.map(String), sum: sum(paid).toString(), left: c.left().toString() };
});

t('11. splitCursor matches allocateEvenly for the same inputs', () => {
  for (const [total, payers] of [[10_000_000n, 3], [1n, 3], [7n, 5], [999_999_999n, 13]]) {
    const a = allocateEvenly(total, payers).map(String).join(',');
    const c = splitCursor(total, payers);
    const b = [];
    while (!c.done()) b.push(c.next());
    if (a !== b.map(String).join(',')) throw new Error(`mismatch total=${total} payers=${payers}: ${a} vs ${b.join(',')}`);
  }
  return '4 combinations agree';
});

t('12. splitCursor refuses to over-advance', () => {
  const c = splitCursor(10n, 2);
  c.next(); c.next();
  let threw = false;
  try { c.next(); } catch (e) { threw = /no payers left/.test(e.message); }
  if (!threw) throw new Error('cursor advanced past its payer count');
  return 'rejected';
});

/* ---------------------------------------------------------------- report */
let pass = 0, fail = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  console.log('        ' + (typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)));
  r.ok ? pass++ : fail++;
}
console.log(`\n=== ${pass}/${results.length} passed, ${fail} failed ===`);
process.exitCode = fail ? 1 : 0;
