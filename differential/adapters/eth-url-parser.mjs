// adapter: eth-url-parser (Bruno Barbieri) v1.0.4 — a real, published, MIT library.
//
// Repo:   https://github.com/brunobar79/eth-url-parser
// Loaded: dist/index.js (the published CommonJS build), required via absolute path.
//
// This is the second implementation the differential test needs. Without it the
// matrix has one column and comparing a parser to itself proves nothing.
//
// Behaviour discovered by probing, not by reading the docs:
//   - exports: { parse, build }
//   - parse() THROWS on malformed input rather than returning a structured error.
//     That is why the differential runner treats a throw as a finding and this
//     adapter converts it into accept:false rather than letting it escape.
//
// ESM-to-CJS bridge: this file is ESM (the repo is "type":"module"), the library
// is CJS. createRequire gives us a real require() from inside ESM, which avoids
// the "require is not defined" trap and lets us load an absolute Windows path.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const name = 'eth-url-parser';
export const version = '1.0.4';

let lib = null;
let loadErr = null;
try {
  lib = require('C:/Users/HUAWEI/workspace/eth-url-parser/dist/index.js');
} catch (e) {
  loadErr = String(e && e.message ? e.message : e);
}

export function parseUri(uri) {
  if (!lib || typeof lib.parse !== 'function') {
    return { accept: false, reason: 'adapter-load-failed: ' + loadErr };
  }

  let r;
  try {
    r = lib.parse(uri);
  } catch (e) {
    // Observed style: throws. Report the message so the matrix shows WHY it refused.
    const m = String(e && e.message ? e.message : e);
    return { accept: false, reason: m.slice(0, 60) };
  }

  // Defensive: if a future version returns {errors:[...]} instead of throwing,
  // honour that too rather than calling it a rejection or an acceptance blindly.
  if (r && Array.isArray(r.errors) && r.errors.length > 0) {
    return { accept: false, reason: r.errors.map((x) => (x && x.code) || 'error').join(',') };
  }

  // A returned value with no error and no throw is a success by this library's
  // convention (it returns a parsed object such as {target_address, chain_id,...}).
  return { accept: true, reason: null };
}

export default { name, version, parseUri };
