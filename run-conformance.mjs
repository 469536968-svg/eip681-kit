// Conformance runner: reads vectors/eip681.conformance.json and exercises a parser
// against every vector (both accept:true and accept:false).
//
// Usage:
//   node run-conformance.mjs                  # test the bundled parser
//   node run-conformance.mjs ./myparser.mjs   # test YOUR parser
//
// A parser module must export: parse(uri) -> { ok, scheme, target, chainId, value,
//   function, args, errors:[{code,message}], canonical }
// This is the shape of eip681.mjs in this repo; adapt if yours differs.

import { readFileSync } from 'node:fs';

const vectorsPath = new URL('./vectors/eip681.conformance.json', import.meta.url);
const suite = JSON.parse(readFileSync(vectorsPath, 'utf8'));

const target = process.argv[2] || './eip681.mjs';
const mod = await import(new URL(target, import.meta.url).href);
const parse = mod.parse;
if (typeof parse !== 'function') {
  console.error(`Parser module ${target} does not export parse()`);
  process.exit(2);
}

let pass = 0, fail = 0;
const failures = [];

for (const v of suite.vectors) {
  const got = parse(v.uri);
  const problems = [];

  if (v.accept) {
    if (!got.ok) problems.push(`expected ACCEPT, got reject: ${JSON.stringify(got.errors)}`);
    for (const [k, want] of Object.entries(v.expect || {})) {
      const g = got[k];
      const norm = (x) => typeof x === 'bigint' ? x.toString() : x;
      if (k === 'params') {
        for (const [ak, av] of Object.entries(want)) {
          if (norm(g?.[ak]) !== norm(av)) problems.push();
        }
      } else if (k === 'chainId' && want === null) {
        if (g !== null && g !== undefined) problems.push();
      } else if (norm(g) !== norm(want)) {
        problems.push();
      }
    }
  } else {
    if (got.ok) problems.push('expected REJECT, got accept');
    if (v.expect_error) {
      const codes = (got.errors || []).map(e => e.code);
      if (!codes.includes(v.expect_error)) {
        problems.push(`expected error '${v.expect_error}', got ${JSON.stringify(codes)}`);
      }
    }
  }

  if (problems.length === 0) { pass++; continue; }
  fail++;
  failures.push({ id: v.id, problems });
}

console.log(`\nEIP-681 conformance -- ${pass}/${pass + fail} vectors passed  (suite ${suite.version}, parser: ${target})\n`);
for (const f of failures) {
  console.log(`FAIL ${f.id}`);
  for (const p of f.problems) console.log(`     ${p}`);
}
if (fail === 0) console.log('All vectors green.');
process.exit(fail ? 1 : 0);
