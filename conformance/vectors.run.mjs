// conformance/run.mjs — run eip681-kit against the language-agnostic conformance
// vectors in vectors.json.
//
// This is a DIFFERENTIAL: the expectations were authored from the EIP-681 spec text
// and from defects observed in real parsers, NOT generated from this parser's output.
// If the expectations had been derived from the implementation, the suite would be a
// tautology and would prove nothing.
//
// Fully offline. No network, no dependencies.
//
// Run: node conformance/run.mjs        Exit 1 on any mismatch.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from '../eip681.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, 'vectors.json'), 'utf8'));

const codes = (list) => (list || []).map((e) => e.code);
let pass = 0;
const failures = [];

for (const v of suite.vectors) {
  const problems = [];
  const r = parse(v.input);

  if (r.ok !== v.expect.ok) {
    problems.push(`ok: expected ${v.expect.ok} got ${r.ok}` +
      (codes(r.errors).length ? ` [errors: ${codes(r.errors).join(',')}]` : '') +
      (codes(r.warnings).length ? ` [warnings: ${codes(r.warnings).join(',')}]` : ''));
  }

  const haveErrors = codes(r.errors);
  for (const c of v.expect.error_codes || []) {
    if (!haveErrors.includes(c)) problems.push(`missing error code "${c}" (have: ${haveErrors.join(',') || 'none'})`);
  }

  const haveWarnings = codes(r.warnings);
  for (const c of v.expect.warning_codes || []) {
    if (!haveWarnings.includes(c)) problems.push(`missing warning code "${c}" (have: ${haveWarnings.join(',') || 'none'})`);
  }

  // Semantic fields are only meaningful when the parse succeeded. Checking them on
  // a failed parse would reward a parser that leaks values out of invalid input.
  if (v.expect.ok && v.expect.fields) {
    const f = v.expect.fields;
    const low = (x) => (typeof x === 'string' ? x.toLowerCase() : x);
    if ('chainId' in f && r.chainId !== f.chainId) problems.push(`chainId: expected ${f.chainId} got ${r.chainId}`);
    if ('amount' in f) {
      const got = r.amount === null || r.amount === undefined ? null : r.amount.toString();
      if (got !== f.amount) problems.push(`amount: expected ${f.amount} got ${got}`);
    }
    if ('recipient' in f && low(r.recipient) !== f.recipient) problems.push(`recipient: expected ${f.recipient} got ${low(r.recipient)}`);
    if ('target' in f && low(r.target) !== f.target) problems.push(`target: expected ${f.target} got ${low(r.target)}`);
    if ('isTokenTransfer' in f && r.isTokenTransfer !== f.isTokenTransfer) {
      problems.push(`isTokenTransfer: expected ${f.isTokenTransfer} got ${r.isTokenTransfer}`);
    }
  }

  // T-05 style: when the expectation says the parse fails, no amount may be exposed.
  if (!v.expect.ok && v.expect.fields && 'amount' in v.expect.fields) {
    const got = r.amount === null || r.amount === undefined ? null : r.amount.toString();
    if (got !== v.expect.fields.amount) problems.push(`amount on a FAILED parse: expected ${v.expect.fields.amount} got ${got}`);
  }

  if (problems.length) failures.push({ id: v.id, input: v.input, why: v.why, problems });
  else pass++;
}

console.log(`EIP-681 conformance: ${pass}/${suite.vectors.length} vectors passed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) {
    console.log(`\n  ${f.id}  ${f.input}`);
    console.log(`    why it matters: ${f.why}`);
    for (const p of f.problems) console.log(`    - ${p}`);
  }
  process.exit(1);
}
