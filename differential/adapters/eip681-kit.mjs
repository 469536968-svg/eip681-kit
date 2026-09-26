// adapter: eip681-kit (this repo's own parser)
//
// A differential test is only meaningful if at least one implementation is the
// one under test. This wraps it into the common {accept, reason} shape.
//
// The contract every adapter must honour:
//   export const name, version
//   export function parse(uri) -> { accept: boolean, reason: string|null }
//
// An adapter must NEVER throw. If the underlying library throws, the adapter
// catches it and reports accept:false with the message — because "the library
// crashed" is itself a finding worth putting in the matrix, not a reason to
// abort the run.

import { parse } from '../../eip681.mjs';

export const name = 'eip681-kit';
export const version = '1.1.0';

export function parseUri(uri) {
  // parse() reports failure in-band: { ok:false, errors:[...] }. It does not throw.
  const r = parse(uri);
  if (r && r.ok === true) return { accept: true, reason: null };
  const errs = (r && r.errors) || [];
  return {
    accept: false,
    reason: errs.length ? errs.map((e) => e.code).join(',') : 'no-ok-flag',
  };
}

export default { name, version, parseUri };
