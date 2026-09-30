// conformance/adapters/kit.mjs — adapter for this repo's reference parser.
// Also the worked example a maintainer copies when writing their own adapter.
//
//   node conformance/check.mjs conformance/adapters/kit.mjs

import { parse } from '../../eip681.mjs';

export default function adapt(uri) {
  const r = parse(uri);
  return {
    ok: r.ok,
    errors: r.errors,
    warnings: r.warnings,
    chainId: r.chainId,
    target: r.target,
    recipient: r.recipient,
    // Deliberately stringified at the boundary: JSON/JS numbers lose precision above
    // 2^53 and uint256 does not fit, so the harness compares decimal strings.
    amount: r.amount === null || r.amount === undefined ? null : r.amount.toString(),
    isTokenTransfer: r.isTokenTransfer,
  };
}
