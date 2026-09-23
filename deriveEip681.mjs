// deriveEip681 — invoice -> EIP-681 payment URI (opt-in secondary)
//
// Purpose-built for void-layer/codec#14:
//   deriveEip681(invoice): string | null
//
// Follows the issue's stated contract:
//   - EIP-681 = payment INTENT, invoice = RECORD. Derive one way only.
//   - Returns null (never guesses) when the invoice cannot be expressed.
//   - Always emits @chainId (spec allows omission; interop does not agree on default).
//   - Caller MUST render the "function-call form not universally supported" warning;
//     that is a consumer-side concern and cannot be detected at generation time.
//
// Reuses the zero-dependency parser/validator in ./eip681.mjs.
// NOTE: erc20Transfer/nativeTransfer return { ok, errors, uri } — we unwrap .uri
//       and surface .errors as null (they return null on any error anyway).
// MIT. No payment requested.
//
// FIX (2026-09-23): deriveEip681 previously accepted ANY 0x+40-hex string as a
// payee, while parse() enforces the EIP-55 checksum claim on mixed-case input.
// That asymmetry meant derive could emit a URI its OWN parser rejects, breaking
// the round-trip invariant the tests rely on. Caught by deriveEip681.test.mjs.
// Now derive applies the same rule as parse: a mixed-case address is an explicit
// checksum claim, and a failed claim is refused (null) — we never silently
// re-case it, because the caller may have meant a different address entirely.

import { erc20Transfer, nativeTransfer, SCHEME, isChecksumAddress } from './eip681.mjs';

const isHexAddress = (s) =>
  typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);

// Same rule parse() uses: all-lower/all-upper are treated as "no claim"; mixed
// case is a claim that must verify. Refuse (return false) on a failed claim.
const isUsableAddress = (s) => isHexAddress(s) && isChecksumAddress(s);

export const toBaseUnits = (amount, decimals) => {
  // amount: string|number of whole tokens (e.g. "1.5"), decimals: token decimals.
  // Returns integer base-unit string, or null if it cannot be expressed exactly.
  if (amount === null || amount === undefined) return null;
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) return null; // inexact -> null, never round
  const padded = frac.padEnd(decimals, '0');
  const out = (whole + padded).replace(/^0+(?=\d)/, '');
  return out === '' ? '0' : out;
};

/**
 * Derive an EIP-681 URI from an invoice.
 *
 * invoice:
 *   {
 *     chainId:  8453,                    // positive integer, REQUIRED
 *     asset:    'native' | '0xTOKEN',    // 'native'/undefined => native transfer
 *     payee:    '0x...',                 // recipient, REQUIRED
 *     amount:   '1.5' | null,            // whole-token units (ERC-20)
 *     decimals: 6,                       // REQUIRED for ERC-20
 *     wei:      '10000000000000000' | null // REQUIRED for native
 *   }
 *
 * @returns {string|null}
 */
export function deriveEip681(invoice) {
  if (!invoice || typeof invoice !== 'object') return null;

  const { chainId, payee, asset } = invoice;
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  if (!isUsableAddress(payee)) return null;

  // --- Native currency transfer -------------------------------------------
  if (asset === 'native' || asset === null || asset === undefined) {
    const weiRaw = invoice.wei ?? invoice.value;
    if (typeof weiRaw !== 'string' && typeof weiRaw !== 'bigint') return null;
    const weiStr = String(weiRaw);
    if (!/^\d+$/.test(weiStr) || weiStr === '0') return null;
    const r = nativeTransfer({ chainId, to: payee, wei: weiStr });
    return r && r.ok && r.uri ? r.uri : null;
  }

  // --- ERC-20 transfer -----------------------------------------------------
  if (!isUsableAddress(asset)) return null; // asset must be a token contract address
  const base = toBaseUnits(invoice.amount, invoice.decimals);
  if (base === null || base === '0') return null;
  const r = erc20Transfer({ chainId, token: asset, to: payee, amount: base });
  return r && r.ok && r.uri ? r.uri : null;
}

export default { deriveEip681, toBaseUnits, isHexAddress, isUsableAddress, SCHEME };
