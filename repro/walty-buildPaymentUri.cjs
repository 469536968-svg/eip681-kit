'use strict';
/**
 * Executed test of the buildPaymentUri spec proposed in ignaciogarcia-dev/walty#69.
 *
 * Spec, verbatim from the issue:
 *   ethereum:<tokenAddress>@<chainId>/transfer?address=<merchant>&uint256=<amountToken>
 *   "For split requests it uses the remaining amount."
 *
 * This file exists to find where that spec breaks under real inputs, and to show
 * the minimal version that does not. Everything printed here was executed.
 *
 * Run: node repro/walty-buildPaymentUri.cjs       (exit 1 if any assertion fails)
 */
const kit = require('../index.mjs');

const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // 6 decimals
const WETH_POLYGON = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'; // 18 decimals
const MERCHANT = kit.toChecksumAddress('0x4e83362442b8d1bec28173aceb0df2af0c58e4b1');

const results = [];
function t(name, fn) {
  try { results.push({ name, ok: true, detail: fn() }); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); }
}
const eq = (a, b, m) => {
  if (String(a) !== String(b)) throw new Error(`${m}: got ${a} want ${b}`);
  return String(a);
};

// The spec exactly as written: no conversion, no validation.
function buildPaymentUri({ tokenAddress, chainId, merchant, amountToken }) {
  return `ethereum:${tokenAddress}@${chainId}/transfer?address=${merchant}&uint256=${amountToken}`;
}

// Integer-only decimal -> base units. No Number is ever constructed, so no
// double is ever rounded. Throws rather than silently rounding sub-unit dust.
function toBaseUnits(decimalString, decimals) {
  const s = String(decimalString).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('not a plain non-negative decimal: ' + s);
  const [i, f = ''] = s.split('.');
  if (f.length > decimals) throw new Error(`precision exceeds token decimals: ${s} (${decimals}dp)`);
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/* ---------------------------------------------------------------- 1. shape */
t('1. parser accepts a well-formed ERC-20 transfer', () => {
  const p = kit.parse(buildPaymentUri({
    tokenAddress: USDC_POLYGON, chainId: 137, merchant: MERCHANT, amountToken: '12345678',
  }));
  if (!p.ok) throw new Error('rejected: ' + JSON.stringify(p.errors));
  return { chainId: p.chainId, chainIdType: typeof p.chainId, recipient: p.recipient, amount: String(p.amount) };
});

/* ------------------------------------------- 2. the amount unit is the trap */
t('2. uint256=<decimal> instead of base units is REJECTED by a strict parser', () => {
  const p = kit.parse(buildPaymentUri({
    tokenAddress: USDC_POLYGON, chainId: 137, merchant: MERCHANT,
    amountToken: '12.345678', // what a UI actually holds
  }));
  if (p.ok) throw new Error('a decimal amount was accepted as base units -- silent 1e6x error');
  return { ok: p.ok, amount: String(p.amount), errors: p.errors.map((e) => e.code) };
});

t('3. NEGATIVE CONTROL: a builder that forgets decimals IS caught', () => {
  const p = kit.parse(buildPaymentUri({
    tokenAddress: WETH_POLYGON, chainId: 137, merchant: MERCHANT, amountToken: '1.5', // 1.5 WETH
  }));
  const caught = !p.ok || String(p.amount) !== '1500000000000000000';
  if (!caught) throw new Error('suite would pass a builder that sends 1.5 wei instead of 1.5 WETH');
  return { detected: caught, parsedAmount: String(p.amount) };
});

/* --------------------------------- 4. why floats are fine at 6dp, fatal at 18dp
 *
 * Columns are deliberately independent: `literal` is the decimal the user typed,
 * `viaFloat` is Number arithmetic, `viaString` parses the literal string with
 * BigInt only. Comparing viaFloat against a value derived from the SAME float
 * (e.g. v.toFixed(18)) proves nothing -- that is how a null result gets mistaken
 * for a measurement.
 */
t('4a. 6dp: float math happens to survive for typical amounts', () => {
  const cases = [
    { literal: '11.10', v: 11.10 },
    { literal: '12.345678', v: 12.345678 },
    { literal: '0.30', v: 0.1 + 0.2 },
  ];
  return cases.map(({ literal, v }) => {
    const viaFloat = String(Math.round(v * 1e6));
    const viaString = toBaseUnits(literal, 6).toString();
    return { literal, viaFloat, viaString, agree: viaFloat === viaString };
  });
});

t('4b. 18dp: float math is WRONG against the literal the user typed', () => {
  const cases = [
    { literal: '1.5', v: 1.5 },
    { literal: '0.1', v: 0.1 },
    { literal: '2.014', v: 2.014 },
    { literal: '11.10', v: 11.10 },
  ];
  const rows = cases.map(({ literal, v }) => {
    const viaFloat = BigInt(Math.round(v * 1e18));
    const viaString = toBaseUnits(literal, 18);
    return {
      literal, viaFloat: viaFloat.toString(), viaString: viaString.toString(),
      agree: viaFloat === viaString, deltaWei: (viaFloat - viaString).toString(),
    };
  });
  const wrong = rows.filter((r) => !r.agree);
  if (!wrong.length) throw new Error('no discrepancy found -- the float path was expected to be inexact at 18dp');
  return rows;
});

t('5. 2.014 WETH: float path is SHORT by 256 wei', () => {
  const viaFloat = BigInt(Math.round(2.014 * 1e18));
  const viaString = toBaseUnits('2.014', 18);
  eq(viaString, 2014000000000000000n, 'string path');
  const delta = (viaString - viaFloat).toString();
  return { viaFloat: viaFloat.toString(), viaString: viaString.toString(), viaStringIsShort: delta };
});

t('6. rejects more precision than the token has instead of rounding', () => {
  let threw = false;
  try { toBaseUnits('1.1234567', 6); } catch { threw = true; }
  if (!threw) throw new Error('silently rounded 7dp on a 6dp token -> sub-cent value destroyed without notice');
  return 'rejected';
});

/* ------------------------------------------------- 7. the split-amount trap */
t('7. "remaining amount", integer path vs float path at 6dp', () => {
  const total = toBaseUnits('10.00', 6);
  const paid = toBaseUnits('3.333333', 6);
  const exactRemaining = total - paid;
  const floatRemaining = Math.round((10.0 - 3.333333) * 1e6);
  return {
    exactRemaining: exactRemaining.toString(), floatRemaining: String(floatRemaining),
    agree: exactRemaining.toString() === String(floatRemaining),
    note: 'these agree at 6dp; do not generalize the result to 18dp',
  };
});

t('8. three equal thirds of 10.00 do NOT sum to 10.00 (rounding choice matters)', () => {
  const per = 10_000_000 / 3;
  const floor = Math.floor(per), ceil = Math.ceil(per);
  return {
    floorPerPayer: floor, floorTimes3: floor * 3, shortBy: 10_000_000 - floor * 3,
    ceilPerPayer: ceil, ceilTimes3: ceil * 3, overBy: ceil * 3 - 10_000_000,
    note: 'last payer must absorb the remainder, not pay a rounded share',
  };
});

/* --------------------------------------------- 8. chainId must be present */
t('9. a missing chainId yields a URI a strict parser refuses', () => {
  const p = kit.parse(buildPaymentUri({
    tokenAddress: USDC_POLYGON, chainId: undefined, merchant: MERCHANT, amountToken: '1000000',
  }));
  if (p.ok) throw new Error('chainId=undefined produced a valid URI -- wrong-network payment risk');
  return { ok: p.ok, errors: p.errors.map((e) => e.code) };
});

t('10. chainId 0 is not a valid network id here', () => {
  const p = kit.parse(buildPaymentUri({
    tokenAddress: USDC_POLYGON, chainId: 0, merchant: MERCHANT, amountToken: '1000000',
  }));
  if (p.ok) throw new Error('chainId 0 accepted');
  return { ok: p.ok, chainId: p.chainId, errors: p.errors.map((e) => e.code) };
});

t('11. a non-checksummed mixed-case address is refused (this caught MY fixture bug)', () => {
  const bad = '0x4e83362442B8d1beC28173AcEb0dF2af0c58e4b1'; // invented casing
  const p = kit.parse(buildPaymentUri({
    tokenAddress: USDC_POLYGON, chainId: 137, merchant: bad, amountToken: '1000000',
  }));
  if (p.ok) throw new Error('invalid EIP-55 casing accepted');
  return { ok: p.ok, errors: p.errors.map((e) => e.code) };
});

t('12. the all-lowercase form is accepted and recipient is derived', () => {
  const lower = '0x4e83362442b8d1bec28173aceb0df2af0c58e4b1';
  const p = kit.parse(buildPaymentUri({
    tokenAddress: USDC_POLYGON, chainId: 137, merchant: lower, amountToken: '1000000',
  }));
  if (!p.ok) throw new Error('all-lowercase address rejected');
  eq(p.recipient.toLowerCase(), lower, 'recipient');
  return { chainId: p.chainId, chainIdType: typeof p.chainId, recipient: p.recipient, isTokenTransfer: p.isTokenTransfer };
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
