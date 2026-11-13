'use strict';
/**
 * split.mjs -- exact allocation of a token amount across payers.
 *
 * The general finding from ignaciogarcia-dev/walty#69: a payment split N ways
 * cannot use equal shares, because base units are indivisible. floor() leaves the
 * collection short, ceil() over-collects, and a request that never sums to its
 * total never reaches a settled state. The fix is a remainder rule, not a rounding
 * mode: every payer pays floor(total/payers), and the LAST (total % payers) payers
 * absorb one extra base unit each.
 *
 * Why the remainder goes to the LAST payers, not the first: the only rule that
 * survives out-of-order or partial payment is "charge from the amount still
 * remaining". That forces the closing payer to pay whatever is left, so the
 * remainder lands last by construction. allocateEvenly() and splitCursor() below
 * deliberately implement the SAME rule -- an earlier version of this file put the
 * extra unit first in allocateEvenly and last in splitCursor; both summed exactly,
 * so nothing looked broken, but quoting from one and charging from the other would
 * bill payer 1 a different amount than quoted. The test file asserts they agree.
 *
 * Everything is bigint. No Number is constructed anywhere, so no double is rounded.
 */

/** Reject anything that is not a non-negative integer amount of base units. */
function asBase(v, label) {
  if (typeof v === 'bigint') {
    if (v < 0n) throw new Error(`${label} must be >= 0, got ${v}n`);
    return v;
  }
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new Error(`${label} must be a non-negative SAFE integer or bigint, got ${v}`);
    }
    return BigInt(v);
  }
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  throw new Error(`${label} must be bigint | safe integer | digit string, got ${typeof v}`);
}

/**
 * Split `total` base units across `payers` slices so the parts sum EXACTLY to total.
 *
 * Rule: every payer gets floor(total/payers); the last (total % payers) payers get
 * one extra base unit each. Consequences, all asserted in the test file:
 *   - sum(parts) === total, always, no accumulation
 *   - max(parts) - min(parts) <= 1, so no payer is unfairly loaded
 *   - a zero remainder yields identical parts
 *   - the result equals splitCursor() for the same inputs
 *
 * @param {bigint|number|string} total  total in base units
 * @param {number} payers               number of slices, integer >= 1
 * @returns {bigint[]}
 */
export function allocateEvenly(total, payers) {
  const t = asBase(total, 'total');
  if (!Number.isInteger(payers) || payers < 1) throw new Error(`payers must be an integer >= 1, got ${payers}`);
  const n = BigInt(payers);
  const each = t / n;
  const extra = t % n;
  const firstExtra = n - extra; // payers at index >= firstExtra absorb one unit each
  return Array.from({ length: payers }, (_, i) =>
    each + (BigInt(i) >= firstExtra ? 1n : 0n));
}

/**
 * What is still owed, as an integer subtraction.
 * Throws rather than returning a negative, because a negative remainder means the
 * caller has double-counted a payment -- a bug that otherwise surfaces as a refund.
 */
export function remaining(total, paid) {
  const t = asBase(total, 'total');
  const p = asBase(paid, 'paid');
  if (p > t) throw new Error(`overpaid by ${p - t}n base units (paid ${p}n > total ${t}n)`);
  return t - p;
}

/**
 * Streaming variant: pay one slice at a time and always compute the next slice from
 * the REMAINING amount, so the last payer closes the request exactly. This is the
 * shape that makes a split request terminate instead of staying pending, and it is
 * the reason the remainder rule sends the extra unit to the last payers.
 *
 * @returns {{next: () => bigint, done: () => boolean, left: () => bigint}}
 */
export function splitCursor(total, payers) {
  let left = asBase(total, 'total');
  let slots = payers;
  if (!Number.isInteger(payers) || payers < 1) throw new Error(`payers must be an integer >= 1, got ${payers}`);
  return {
    next() {
      if (slots < 1) throw new Error('no payers left');
      if (slots === 1) { const v = left; left = 0n; slots = 0; return v; }
      const v = left / BigInt(slots);
      left -= v; slots -= 1;
      return v;
    },
    done: () => slots === 0,
    left: () => left,
  };
}
