// conformance/adapters/naive.mjs — a DELIBERATELY non-conforming parser.
//
// Its only job is to prove the harness can fail. If `check.mjs` runs against this
// adapter and reports 49/49, the harness is broken, not the parser.
//
// It reproduces, in miniature, the defect classes the corpus was written to catch:
//   - address length checked as a MINIMUM, so over-length addresses fall through to a
//     checksum complaint (the real librustzcash bug class)
//   - the amount exposed even on a failed parse (the T-05 hazard)
//   - uint256 parsed through Number, losing precision above 2^53
//   - the token contract conflated with the recipient
//   - an approval treated as a token transfer

const HEX40 = /^0x[0-9a-fA-F]{40,}$/;   // min-40: no ceiling. This is the bug.
const HEXANY = /^0x[0-9a-fA-F]+$/;

export default function adapt(uri) {
  const errors = [];
  const warnings = [];
  const out = {
    ok: false, errors, warnings,
    chainId: null, target: null, recipient: null,
    amount: null, isTokenTransfer: false,
  };

  let rest = uri;
  if (rest.startsWith('ethereum:')) rest = rest.slice('ethereum:'.length);
  else { errors.push({ code: 'bad-scheme' }); return out; }

  // strip @chainId
  const at = rest.indexOf('@');
  if (at >= 0) {
    const after = rest.slice(at + 1);
    const end = after.search(/[/?]/);
    const cs = end >= 0 ? after.slice(0, end) : after;
    out.chainId = Number(cs);
    rest = rest.slice(0, at) + (end >= 0 ? after.slice(end) : '');
  }

  // split function / query
  let path = rest, query = '';
  const q = rest.indexOf('?');
  if (q >= 0) { path = rest.slice(0, q); query = rest.slice(q + 1); }

  let fn = '';
  if (path.endsWith('/transfer')) { fn = 'transfer'; out.isTokenTransfer = true; }
  else if (path.endsWith('/approve')) { fn = 'approve'; out.isTokenTransfer = true; } // BUG: approval is not a payment
  else if (path.startsWith('0x')) { out.recipient = path; }
  else if (path) { fn = path.split('/').pop(); }

  if (path.startsWith('0x')) {
    // BUG: min-40 first, then a checksum complaint — the wrong diagnosis.
    if (!HEX40.test(path)) errors.push({ code: 'bad-checksum' });
    if (errors.length === 0) out.recipient = path;
  } else if (path) {
    // token form: <contract>/<fn>
    const contract = path.slice(0, path.indexOf('/') < 0 ? undefined : path.indexOf('/'));
    if (!HEX40.test(contract)) errors.push({ code: 'bad-checksum' });
    out.target = contract;
    out.recipient = contract;   // BUG: contract conflated with recipient
  }

  for (const kv of query ? query.split('&') : []) {
    if (!kv) continue;
    const [k, vRaw] = kv.split('=');
    const v = decodeURIComponent(vRaw ?? '');
    if (k === 'address') {
      if (!HEX40.test(v)) { errors.push({ code: 'bad-address' }); continue; }
      out.recipient = v;
    } else if (k === 'uint256' || k === 'value') {
      // BUG: Number() — precision loss above 2^53.
      out.amount = String(Number(v));
    }
  }

  if (fn === 'transfer' && out.amount !== null) out.amount = out.amount; // BUG: amount kept even on failure
  out.ok = errors.length === 0;
  // BUG: do not null the amount on failure.
  return out;
}
