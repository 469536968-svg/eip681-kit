// Conformance runner: reads vectors/eip681.conformance.json and exercises a parser
// against every vector (both accept:true and accept:false).
//
// Usage:
//   node run-conformance.mjs                        # test the bundled parser
//   node run-conformance.mjs ./myparser.mjs         # test YOUR parser
//   node run-conformance.mjs ./myparser.mjs --vectors ./vectors.json
//   node run-conformance.mjs ./myparser.mjs --json  # machine-readable summary
//
// A parser module must export: parse(uri) -> { ok, scheme, target, chainId, value,
//   function, args, errors:[{code,message}], canonical }
// This is the shape of eip681.mjs in this repo; adapt if yours differs.
//
// Exit codes: 0 = all green, 1 = vector failures, 2 = runner/setup error.

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SCRIPT_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function parseArgs(argv) {
  const out = { parser: null, vectors: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--vectors') out.vectors = argv[++i];
    else if (!out.parser) out.parser = a;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// Resolve a user-supplied path against CWD first (so it works from the repo
// being tested, i.e. inside a GitHub Action), then against this script's dir
// (so the bundled defaults keep working when run in place).
function resolveInput(p) {
  if (!p) return null;
  const candidates = [
    resolve(process.cwd(), p),
    resolve(SCRIPT_DIR, p),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const vectorsArg = args.vectors || resolve(SCRIPT_DIR, 'vectors/eip681.conformance.json');
const vectorsPath = resolveInput(vectorsArg) || vectorsArg;
if (!existsSync(vectorsPath)) {
  console.error(`Vectors file not found: ${vectorsArg}`);
  process.exit(2);
}
const suite = JSON.parse(readFileSync(vectorsPath, 'utf8'));

const targetArg = args.parser || resolve(SCRIPT_DIR, 'eip681.mjs');
const targetPath = resolveInput(targetArg) || targetArg;
if (!existsSync(targetPath)) {
  console.error(`Parser module not found: ${targetArg}`);
  console.error('Pass the path to a JS module exporting parse(uri).');
  process.exit(2);
}

const mod = await import(pathToFileURL(targetPath).href);
const parse = mod.parse;
if (typeof parse !== 'function') {
  console.error(`Parser module ${targetArg} does not export parse()`);
  process.exit(2);
}

const norm = (x) => (typeof x === 'bigint' ? x.toString() : x);
const show = (x) => (typeof x === 'undefined' ? '<undefined>' : JSON.stringify(norm(x)));

let pass = 0, fail = 0;
const failures = [];

for (const v of suite.vectors) {
  const got = parse(v.uri) || {};
  const problems = [];

  if (v.accept) {
    if (!got.ok) {
      problems.push(`expected ACCEPT, got reject: ${JSON.stringify(got.errors || [])}`);
    } else {
      for (const [k, want] of Object.entries(v.expect || {})) {
        if (k === 'params') {
          for (const [ak, av] of Object.entries(want)) {
            const gv = got.params ? got.params[ak] : undefined;
            if (norm(gv) !== norm(av)) {
              // NOTE: this used to be a bare problems.push() -- failures
              // printed as "FAIL <id>" with no diagnosis at all.
              problems.push(`params.${ak}: expected ${show(av)}, got ${show(gv)}`);
            }
          }
        } else if (k === 'chainId' && want === null) {
          if (got.chainId !== null && typeof got.chainId !== 'undefined') {
            problems.push(`chainId: expected null (no @chainId), got ${show(got.chainId)}`);
          }
        } else {
          const gv = got[k];
          if (norm(gv) !== norm(want)) {
            problems.push(`${k}: expected ${show(want)}, got ${show(gv)}`);
          }
        }
      }
    }
  } else {
    if (got.ok) {
      problems.push(`expected REJECT, got accept -> ${JSON.stringify(got)}`);
    }
    if (v.expect_error) {
      const codes = (got.errors || []).map((e) => e.code);
      if (!codes.includes(v.expect_error)) {
        problems.push(`expected error '${v.expect_error}', got ${JSON.stringify(codes)}`);
      }
    }
  }

  if (problems.length === 0) { pass++; continue; }
  fail++;
  failures.push({ id: v.id, uri: v.uri, problems });
}

if (args.json) {
  console.log(JSON.stringify({
    suite: suite.version,
    parser: targetArg,
    passed: pass,
    failed: fail,
    total: pass + fail,
    failures,
  }, null, 2));
} else {
  console.log(`\nEIP-681 conformance -- ${pass}/${pass + fail} vectors passed  (suite ${suite.version}, parser: ${targetArg})\n`);
  for (const f of failures) {
    console.log(`FAIL ${f.id}`);
    console.log(`     uri: ${f.uri}`);
    for (const p of f.problems) console.log(`     ${p}`);
  }
  if (fail === 0) console.log('All vectors green.');
}
process.exit(fail ? 1 : 0);
