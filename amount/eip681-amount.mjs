// Exact EIP-681 `value=` / `uint256=` amount parser.
// Reference implementation for the number rules in punicus#256, using integer
// arithmetic only -- no Number/Double anywhere on the value path.
//
// `decimals` is the token's base-unit exponent:
//   0  -> the value is already in base units (wei). Default.
//   6  -> USDT on Arbitrum / Polygon / Ethereum
//   18 -> USDT on BSC, and ETH itself
// This parameter is load-bearing: "accepted only when the result is a whole
// number of wei or token units" is unenforceable without it. A first version of
// this file omitted it, and the test for `1.5` failed -- correctly.

const MAX_UINT256 = (1n << 256n) - 1n;

const bad = (reason) => ({ ok: false, reason });

/**
 * Parse a payment amount to atomic units.
 * Grammar:  [+-] digits [ '.' digits ] [ ('e'|'E') [+-] digits ]
 * Returns { ok: true, units: BigInt } or { ok: false, reason }.
 */
export function parseAmount(raw, { max = MAX_UINT256, decimals = 0 } = {}) {
  if (typeof raw !== 'string') return bad('not-a-string');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) return bad('bad-decimals');

  const s = raw.trim();
  if (s === '') return bad('empty');

  // Hex is explicitly refused (punicus decision: hex is refused).
  if (/^[+-]?0[xX]/.test(s)) return bad('hex-not-allowed');

  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return bad('syntax');
  const [, sign, intPart = '', fracPart = '', expPart] = m;

  if (intPart === '' && fracPart === '') return bad('syntax');
  if (sign === '-') return bad('negative');

  const digits = intPart + fracPart;
  const mantissa = BigInt(digits);
  // Exponent arithmetic by hand: Number() would lose precision well before 1e18.
  const exp = expPart === undefined ? 0 : parseInt(expPart, 10);
  if (!Number.isSafeInteger(exp)) return bad('exponent-out-of-range');

  // Mantissa * 10^(exp - fracLen) * 10^decimals must land on a whole unit.
  const scale = exp - fracPart.length + decimals;

  let units;
  if (scale >= 0) {
    units = mantissa * 10n ** BigInt(scale);
  } else {
    const div = 10n ** BigInt(-scale);
    if (mantissa % div !== 0n) return bad('fraction-of-a-unit');
    units = mantissa / div;
  }

  if (units > max) return bad('exceeds-uint256');
  return { ok: true, units };
}

/** Render atomic units back to a human decimal string at `decimals`. */
export function formatAmount(units, decimals = 0) {
  const d = 10n ** BigInt(decimals);
  const whole = units / d;
  const frac = units % d;
  if (frac === 0n) return whole.toString();
  return whole + '.' + frac.toString().padStart(decimals, '0').replace(/0+$/, '');
}

/** Percent-decode a single URI query parameter value. */
export function decodeParamValue(raw) {
  try { return decodeURIComponent(raw); } catch { return null; }
}
