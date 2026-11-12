// strict.mjs — an ADDITIVE strict validation layer over eip681.mjs's parse().
// Zero dependencies. Pure ES module. Node >= 18 and browsers.
//
// WHY THIS EXISTS (measured, not assumed):
// eip681.mjs#parse is deliberately permissive. Probing the shipped module shows
// that an unrecognised query key is accepted silently and copied into `params`:
//
//     ethereum:0x...dEaD@1?value=1000&foo=bar
//       -> ok=true, params={"value":"1000","foo":"bar"}, warnings=[]
//
// That is the right default for a *parser* (you must be able to re-encode what
// you were given). It is the wrong default for a *signer*: a request that is
// technically parseable can still be ambiguous about chain, or open-ended about
// amount, or carry an extra parameter that a different wallet may honour.
//
// So this module adds the checks a wallet should make before it builds a
// transaction, and it applies one hard rule: IF VALIDATION FAILS, NOTHING
// DECISION-BEARING SURVIVES. A caller cannot accidentally read `target`,
// `recipient` or `amount` off a rejected request and act on it.
//
// The base parser's own verdict is respected, never overridden. This layer only
// ever turns ok:true into ok:false -- it can never turn a base error into a pass.

import { parse as baseParse } from './eip681.mjs';

// Keys each request shape is permitted to carry. Anything else is a strict error
// unless the caller opts out via extraAllowedKeys / allowUnknownParams.
const ALLOWED_NATIVE = ['value'];
const ALLOWED_TRANSFER = ['address', 'uint256'];

/**
 * Blank a request that failed strict validation.
 *
 * INVARIANT (enforced by the test suite and re-proved by a mutation control):
 * on failure, target / recipient / amount / params / canonical are ALL null or
 * empty, regardless of what the underlying parse() managed to recover.
 *
 * `r` is only referenced by the deliberately-broken mutant used as a negative
 * control; the real implementation must not read it here. That is what makes the
 * control meaningful: removing the blanking must be observable.
 */
function reject(r, errors, warnings, reason) {
  // LEAK_GUARD_BEGIN
  return {
    ok: false,
    scheme: null,
    target: null,
    chainId: null,
    functionName: null,
    params: {},
    isTokenTransfer: false,
    recipient: null,
    amount: null,
    canonical: null,
    errors,
    warnings,
    rejected: reason,
  };
  // LEAK_GUARD_END
}

/**
 * Validate an EIP-681 URI strictly.
 *
 * @param {string} uri
 * @param {object} [opts]
 * @param {boolean} [opts.requireChainId=true]  Reject a request with no @chainId.
 *        Without one, the same contract address means different assets on
 *        different chains, so the request is ambiguous by construction.
 * @param {boolean} [opts.requireAmount=true]   For token transfers, require
 *        uint256. A transfer without it is read by some wallets as an
 *        open-ended request the user completes, and by others as zero.
 * @param {boolean} [opts.requireRecipient=true] For token transfers, require
 *        the `address` parameter.
 * @param {boolean} [opts.allowUnknownParams=false] Permit unrecognised query keys.
 * @param {string[]} [opts.extraAllowedKeys=[]] Additional permitted query keys.
 *
 * @returns {object} same shape as parse(), plus `rejected` naming the first rule
 *          that failed (null on success).
 */
export function parseStrict(uri, opts = {}) {
  const requireChainId = opts.requireChainId !== false;
  const requireAmount = opts.requireAmount !== false;
  const requireRecipient = opts.requireRecipient !== false;
  const allowUnknownParams = opts.allowUnknownParams === true;
  const extraAllowedKeys = Array.isArray(opts.extraAllowedKeys) ? opts.extraAllowedKeys : [];

  // The base parser is the single source of truth for syntax. Never second-guess it.
  const r = baseParse(uri);

  if (!r || r.ok !== true) {
    // Base already refused. Re-blank with its diagnostics so the invariant holds
    // uniformly: a caller cannot tell "base refused" from "strict refused" by
    // inspecting payload fields, because in both cases the payload is empty.
    return reject(r, (r && r.errors) || [], (r && r.warnings) || [], 'base-error');
  }

  const errors = [];
  const warnings = Array.isArray(r.warnings) ? r.warnings.slice() : [];

  if (requireChainId && (r.chainId === null || r.chainId === undefined)) {
    errors.push({
      code: 'chain-id-required',
      message: 'request omits @chainId; the target address is ambiguous across chains',
    });
  }

  if (r.isTokenTransfer) {
    if (requireRecipient && (r.recipient === null || r.recipient === undefined)) {
      errors.push({
        code: 'recipient-required',
        message: 'token transfer omits the recipient (address=) parameter',
      });
    }
    if (requireAmount && (r.amount === null || r.amount === undefined)) {
      errors.push({
        code: 'amount-required',
        message: 'token transfer omits uint256; open-ended transfers are dangerous to sign',
      });
    }
  } else if (requireAmount && (r.amount === null || r.amount === undefined)) {
    // A bare native request with no value is a legitimate "open" request in
    // EIP-681, so this is only an error because amount is required here.
    if (r.params && Object.keys(r.params).includes('value')) {
      // present but unparseable -- base would already have failed, defensive only
      errors.push({ code: 'amount-invalid', message: 'value could not be parsed as an amount' });
    }
  }

  // Unknown keys: the gap this module exists to close.
  if (!allowUnknownParams) {
    const allowed = new Set(
      (r.isTokenTransfer ? ALLOWED_TRANSFER : ALLOWED_NATIVE).concat(extraAllowedKeys),
    );
    for (const key of Object.keys(r.params || {})) {
      if (!allowed.has(key)) {
        errors.push({
          code: 'unknown-param',
          message: `unrecognised parameter "${key}"; a different wallet may act on it`,
        });
      }
    }
  }

  if (errors.length > 0) {
    const reason = errors[0].code === 'unknown-param'
      ? 'unknown-param:' + errors[0].message.split('"')[1]
      : errors[0].code;
    return reject(r, errors, warnings, reason);
  }

  return {
    ok: true,
    scheme: r.scheme,
    target: r.target,
    chainId: r.chainId,
    functionName: r.functionName,
    params: r.params,
    isTokenTransfer: r.isTokenTransfer,
    recipient: r.recipient,
    amount: r.amount,
    canonical: r.canonical,
    errors: [],
    warnings,
    rejected: null,
  };
}

export default { parseStrict };
