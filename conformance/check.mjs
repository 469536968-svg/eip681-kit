// conformance/check.mjs — run the 49-vector EIP-681 corpus against ANY parser.
//
//   node conformance/check.mjs <path-to-adapter.mjs>
//
// This is the artifact that makes the corpus adoptable: a maintainer writes one small
// adapter file that maps their parser's output onto a normalized shape, and gets a
// conformance report naming exactly which vectors disagree.
//
// ADAPTER CONTRACT
//   export default function adapt(uri) -> Normalized   (or throw if the parser throws)
//
//   Normalized = {
//     ok: boolean,                    // true iff the parser accepted the URI outright
//     errors:   [{ code }] or [string]  // error codes; empty/omitted when ok
//     warnings: [{ code }] or [string]  // warnings; these do NOT make ok false
//     chainId?: number | null,
//     target?: string | null,           // token contract, lowercase hex with 0x
//     recipient?: string | null,        // payee, lowercase hex with 0x
//     amount?: string | bigint | null,  // base-unit integer. MUST be exact, never a float.
//     isTokenTransfer?: boolean
//   }
//
// Rules the harness enforces (see conformance/HOWTO.md for the prose version):
//   1. ok must match the vector's expectation exactly.
//   2. when ok is false, every expected error code must be present.
//   3. every expected warning code must be present.
//   4. when ok is true, each expected field must match (amount as an exact decimal string).
//   5. when ok is false, NO amount may be exposed — a caller testing `amount !== null`
//      instead of `ok` must not be able to pay a silently chosen number. (vector T-05)

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, 'vectors.json'), 'utf8'));

const adapterPath = process.argv[2];
if (!adapterPath) {
  console.error('usage: node conformance/check.mjs <adapter.mjs>');
  console.error('       node conformance/check.mjs conformance/adapters/kit.mjs');
  process.exit(2);
}

let adapt;
try {
  const mod = await import(pathToFileURL(resolve(adapterPath)).href);
  adapt = mod.default || mod.adapt;
} catch (e) {
  console.error(`could not load adapter ${adapterPath}: ${e.message}`);
  process.exit(2);
}
if (typeof adapt !== 'function') {
  console.error(`adapter ${adapterPath} does not export a function (default or \`adapt\`)`);
  process.exit(2);
}

const codeOf = (x) => (typeof x === 'string' ? x : x && x.code);
const normAmount = (a) => (a === null || a === undefined ? null : String(a));
const low = (s) => (typeof s === 'string' ? s.toLowerCase() : s);

function check(v) {
  const problems = [];
  let r;
  try {
    r = adapt(v.input);
  } catch (e) {
    // A throwing parser is allowed to count as "rejected" only when the vector is a
    // rejection; if the vector expects acceptance, an exception is a mismatch.
    if (v.expect.ok) return [`parser threw on a URI expected to be accepted: ${e.message}`];
    r = { ok: false, errors: [] };
  }
  if (!r || typeof r !== 'object') return ['adapter returned a non-object'];

  if (!!r.ok !== !!v.expect.ok) {
    const have = (r.errors || []).map(codeOf).join(',') || 'none';
    problems.push(`ok: expected ${v.expect.ok} got ${!!r.ok} [errors: ${have}]`);
  }

  const haveErrors = (r.errors || []).map(codeOf);
  for (const c of v.expect.error_codes || []) {
    if (!haveErrors.includes(c)) {
      problems.push(`missing error code "${c}" (have: ${haveErrors.join(',') || 'none'})`);
    }
  }
  const haveWarnings = (r.warnings || []).map(codeOf);
  for (const c of v.expect.warning_codes || []) {
    if (!haveWarnings.includes(c)) {
      problems.push(`missing warning code "${c}" (have: ${haveWarnings.join(',') || 'none'})`);
    }
  }

  const f = v.expect.fields;
  if (v.expect.ok && f) {
    if ('chainId' in f && r.chainId !== f.chainId) problems.push(`chainId: expected ${f.chainId} got ${r.chainId}`);
    if ('amount' in f && normAmount(r.amount) !== f.amount) problems.push(`amount: expected ${f.amount} got ${normAmount(r.amount)}`);
    if ('recipient' in f && low(r.recipient) !== f.recipient) problems.push(`recipient: expected ${f.recipient} got ${low(r.recipient)}`);
    if ('target' in f && low(r.target) !== f.target) problems.push(`target: expected ${f.target} got ${low(r.target)}`);
    if ('isTokenTransfer' in f && !!r.isTokenTransfer !== f.isTokenTransfer) {
      problems.push(`isTokenTransfer: expected ${f.isTokenTransfer} got ${!!r.isTokenTransfer}`);
    }
  }
  // Rule 5: a failed parse must not carry an amount decisively.
  if (!v.expect.ok && f && 'amount' in f && normAmount(r.amount) !== null) {
    problems.push(`amount on a FAILED parse: expected null got ${normAmount(r.amount)}`);
  }
  return problems;
}

console.log(`EIP-681 conformance — adapter: ${adapterPath}`);
let pass = 0;
const failed = [];
for (const v of suite.vectors) {
  const problems = check(v);
  if (problems.length === 0) { pass++; continue; }
  failed.push({ id: v.id, input: v.input, problems });
  console.log(`\n  ${v.id}  ${v.input}`);
  for (const p of problems) console.log(`    - ${p}`);
}

const total = suite.vectors.length;
console.log(`\n${pass}/${total} vectors satisfied${failed.length ? ` — ${failed.length} mismatch(es)` : ''}`);
if (failed.length) {
  console.log(`\nfailing ids: ${failed.map((f) => f.id).join(' ')}`);
  process.exit(1);
}
