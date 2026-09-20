// explain.mjs — human-readable decoder + risk analysis for EIP-681 payment URIs.
// Zero dependencies. Built on the verified parser in eip681.mjs.
//
// Why this exists: the two most common support questions about EIP-681 are
// "what will my wallet actually do with this string?" and "why did my QR
// send the wrong thing?". Both are answerable statically, before any signing.
//
// Aligned to the actual output shape of eip681.mjs parse():
//   { ok, scheme, target, chainId, functionName, params, isTokenTransfer,
//     recipient, amount (BigInt|null), errors[], warnings[], canonical }

import { parse, isChecksumAddress, toChecksumAddress } from './eip681.mjs';

const CHAINS = {
  1: 'Ethereum mainnet', 10: 'OP Mainnet', 56: 'BNB Chain', 100: 'Gnosis',
  137: 'Polygon', 8453: 'Base', 42161: 'Arbitrum One', 43114: 'Avalanche C-Chain',
  11155111: 'Sepolia (testnet)', 84532: 'Base Sepolia (testnet)',
};

const s = v => (v === undefined || v === null) ? null : String(v);

export function explain(uri) {
  let p;
  try {
    p = parse(uri);
  } catch (e) {
    return { ok: false, uri, error: e.message, errors: [], warnings: [], notes: [],
             summary: null, decoded: null, riskLevel: 'unknown' };
  }

  const warnings = [];
  const notes = [];
  const errs = (p.errors || []).slice();

  // Invalid URIs are invalid — never dress them up as payable.
  // But still EXPLAIN the rejection: "why did my QR not work?" is the #1 support question.
  if (!p.ok) {
    const explainError = (e) => {
      const m = {
        'uint256-without-transfer': 'uint256= was used without /transfer. There is no contract call to carry the amount, so the URI is not payable as written. Use /transfer?address=<token>&uint256=<amount>, or use value= for a native transfer.',
        'value-and-uint256': 'value= and uint256= are both present. EIP-681 makes these mutually exclusive: value= is for the native coin, uint256= is for a token transfer. Wallets disagree on which wins, so this is rejected rather than guessed.',
        'no-scheme': 'The string has no "ethereum:" scheme, so it is not an EIP-681 payment URI at all.',
      };
      return m[e.code] || e.message;
    };
    return {
      ok: false,
      uri,
      summary: null,
      errorDetails: (p.errors || []).map(e => ({ code: e.code, why: explainError(e) })),
      decoded: {
        scheme: s(p.scheme), chainId: p.chainId ?? null, target: s(p.target),
        functionName: p.functionName ?? null, params: p.params || {}, amount: s(p.amount),
      },
      errors: (p.errors || []).slice(),
      warnings: [],
      notes: [],
      riskLevel: 'invalid',
    };
  }

  if (false) {
    return {
      ok: false,
      uri,
      summary: null,
      decoded: {
        scheme: s(p.scheme), chainId: p.chainId ?? null, target: s(p.target),
        functionName: p.functionName ?? null, params: p.params || {}, amount: s(p.amount),
      },
      errors: errs,
      warnings: [],
      notes: [],
      riskLevel: 'invalid',
    };
  }

  const params = p.params || {};
  const isToken = !!p.isTokenTransfer;

  // --- chainId ---
  if (p.chainId === undefined || p.chainId === null) {
    warnings.push({
      code: 'NO_CHAIN_ID', severity: 'medium',
      message: 'No @chainId. The wallet picks the network itself — usually whatever is '
        + 'currently selected. The same QR can therefore pay on the wrong chain.',
      fix: 'Append @8453 (Base), @1 (Ethereum), etc. to pin the network.',
    });
  } else if (!CHAINS[p.chainId]) {
    notes.push(`chainId ${p.chainId} is not in the local name table — still valid, just unfamiliar.`);
  }

  // --- payee / target checksum ---
  const target = p.target || null;
  if (target) {
    if (/[A-F]/.test(target) && /[a-z]/.test(target)) {
      if (isChecksumAddress(target) === false) {
        let fixed = null;
        try { fixed = toChecksumAddress(target); } catch { /* ignore */ }
        warnings.push({
          code: 'BAD_CHECKSUM', severity: 'high',
          message: 'The address has mixed case that FAILS the EIP-55 checksum. A strict wallet '
            + 'will refuse it; a lax one will pay a possibly-wrong address.',
          fix: fixed ? `Use ${fixed}` : 'Re-derive the address from its source.',
        });
      }
    } else if (target === target.toLowerCase()) {
      notes.push('Address is all-lowercase: valid, but carries no typo protection. '
        + 'Checksummed form is safer to publish.');
    }
  }

  // --- the classic token-deposit trap ---
  if (isToken) {
    const contract = target;              // EIP-681: path address IS the token contract
    const payee = params.address || null; // EIP-681: ?address= IS the recipient
    if (!contract) {
      warnings.push({
        code: 'TOKEN_NO_CONTRACT', severity: 'high',
        message: 'A token transfer whose URI has no contract address in the path. There is nothing '
          + 'to call.',
        fix: 'The path address must be the token contract: ethereum:<token>@<chain>/transfer?address=<payee>&uint256=<amount>',
      });
    }
    if (!payee) {
      warnings.push({
        code: 'TOKEN_NO_PAYEE', severity: 'high',
        message: 'A token transfer with no ?address= parameter, so there is no recipient.',
        fix: 'Add address=<recipient> as the first query parameter.',
      });
    }
    if (!p.recipient && !target) {
      warnings.push({
        code: 'TOKEN_NO_PAYEE', severity: 'high',
        message: 'A token transfer with no recipient.',
        fix: 'Add the recipient address before the ?.',
      });
    }
    if (target && payee && target.toLowerCase() === payee.toLowerCase()) {
      warnings.push({
        code: 'CONTRACT_EQUALS_RECIPIENT', severity: 'high',
        message: 'The token contract and the recipient are the SAME address. In an EIP-681 token '
          + 'transfer the path address must be the TOKEN CONTRACT and ?address= must be the '
          + 'RECIPIENT. Setting them equal means the recipient can never be reached — the intended '
          + 'payee is almost certainly missing.',
        fix: 'Set the path address to the token contract and ?address= to the payee.',
      });
    }
    if (target) {
      notes.push({
        code: 'TOKEN_PATH_IS_CONTRACT',
        message: `In this token transfer the path address (${target}) is the TOKEN CONTRACT and `
          + `?address=${payee} is the RECIPIENT — that is the correct EIP-681 layout. `
          + `Know the hazard: a partial parser that ignores query parameters reads ${target} as the `
          + `payee of a NATIVE transfer, so it tries to send the native coin TO A CONTRACT instead of `
          + `calling the token. This is why a token deposit QR should show the bare recipient address, `
          + `not the /transfer form.`,
      });
    }
  }

  // --- mutually-exclusive amount fields ---
  const hasValue = params.value !== undefined;
  const hasUint = params.uint256 !== undefined;
  if (hasValue && hasUint) {
    warnings.push({
      code: 'VALUE_AND_UINT256', severity: 'high',
      message: 'Both value= and uint256= are present. Per EIP-681 these are mutually exclusive; '
        + 'wallets disagree on which one wins. Never publish both.',
      fix: 'For a token transfer use only uint256=. For a native transfer use only value=.',
    });
  }
  if (hasUint && !isToken) {
    warnings.push({
      code: 'UINT256_WITHOUT_TRANSFER', severity: 'high',
      message: 'uint256= appears without a /transfer function, so there is no contract call to carry it.',
      fix: 'Use /transfer?address=<token>&uint256=<amount>, or use value= for a native transfer.',
    });
  }

  // --- amount presence ---
  if (!hasValue && !hasUint) {
    notes.push({
      code: 'NO_AMOUNT',
      message: 'No amount specified: the wallet opens pre-filled with the recipient and lets the '
        + 'payer type the amount. This is the safest form to publish publicly.',
    });
  }

  // --- assemble ---
  const what = isToken
    ? `Call ${p.functionName || 'transfer'}(...) on token contract ${params.address || '(MISSING)'}`
    : 'Send the native coin (ETH/MATIC/…)';

  const to = isToken ? (p.recipient || target || '(none)') : (target || '(none)');

  const amount = hasValue
    ? `${params.value} wei (native)`
    : hasUint
      ? `${params.uint256} base units (token — divide by the token decimals to read it)`
      : 'not specified by the URI';

  const riskLevel = warnings.some(w => w.severity === 'high') ? 'high'
    : warnings.length ? 'medium' : 'low';

  return {
    ok: true,
    uri,
    summary: `${what} → ${to}`
      + (p.chainId ? ` on ${CHAINS[p.chainId] || 'chain ' + p.chainId}` : ' (chain unspecified)'),
    decoded: {
      scheme: s(p.scheme),
      chainId: p.chainId ?? null,
      chainName: p.chainId ? (CHAINS[p.chainId] || null) : null,
      recipient: isToken ? (params.address || p.recipient || null) : (to === '(none)' ? null : to),
      target: s(target),
      action: isToken ? (p.functionName || 'transfer') : 'native transfer',
      contract: isToken ? (target || null) : null,
      amount,
      rawAmount: s(p.amount),
      amountUnit: hasValue ? 'wei' : hasUint ? 'token-base-units' : null,
      gasLimit: params.gas ?? null,
      gasPrice: params.gasPrice ?? null,
      canonical: p.canonical ?? null,
    },
    errors: errs,
    warnings,
    notes,
    riskLevel,
  };
}

// ---------- CLI (Node only; browser-safe because the import is dynamic) ----------
if (typeof process !== 'undefined' && process.argv && process.argv[1]) {
  const { basename } = await import('node:path');
  const self = basename(new URL(import.meta.url).pathname);
  if (basename(process.argv[1]) === self) {
    const input = process.argv[2];
    if (!input) {
      console.error('usage: node explain.mjs "<ethereum:...>"');
      process.exit(2);
    }
    const r = explain(input);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? (r.riskLevel === 'high' ? 1 : 0) : 3);
  }
}

export default { explain };
