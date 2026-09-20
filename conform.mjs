// conform.mjs — EIP-681 conformance runner.
//
// Point it at any EIP-681 implementation (including your own) that exposes the
// small adapter interface below, and it will tell you exactly which vectors fail
// and why. This is the piece that turns the vector file from documentation into
// a test suite other projects can actually run.
//
// Adapter interface — an object with one required method:
//
//   parse(uri) -> {
//     ok:            boolean            // does this implementation accept the URI?
//     scheme?:       string
//     target?:       string             // address in the path
//     chainId?:      number | null
//     functionName?: string | null
//     isTokenTransfer?: boolean
//     recipient?:    string | null      // for /transfer: the ?address= payee
//     amount?:       string | null      // base units, decimal string
//     gasLimit?:     string | null
//     gasPrice?:     string | null
//     canonical?:    string
//     errors?:       {code:string}[] | string[]
//     warnings?:     {code:string}[] | string[]
//     checksumValid?: boolean           // true if mixed-case and valid EIP-55
//     checksumAbsent?: boolean          // true if no case information present
//   }
//
// Anything the implementation returns that the vector does not assert is ignored.
// Anything the vector asserts that the implementation does not return is a failure —
// which is the point: an implementation that cannot report `checksumValid` cannot
// be trusted to have checked it.
//
// Usage:
//   node conform.mjs                    # run the bundled eip681-kit against the vectors
//   node conform.mjs ./my-adapter.mjs   # run any adapter module (default export = adapter)
//
// Exit code: 0 all pass, 1 failures.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain } from './explain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS = path.join(__dirname, 'vectors', 'eip681-vectors.json');

const codes = (arr) => (arr || []).map((e) => (typeof e === 'string' ? e : e.code));

// Translate explain()'s output into the adapter shape.
const bundledAdapter = {
  name: 'eip681-kit (bundled)',
  parse(uri) {
    const r = explain(uri);
    return {
      ok: r.ok,
      scheme: r.decoded?.scheme ?? null,
      target: r.decoded?.target ?? null,
      chainId: r.decoded?.chainId ?? null,
      functionName: r.decoded?.functionName ?? null,
      codes: r.codes || [],
      isTokenTransfer: !!(r.decoded?.contract),
      recipient: r.decoded?.recipient ?? null,
      amount: r.decoded?.amountRaw ?? null,
      gasLimit: r.decoded?.gasLimit ?? null,
      gasPrice: r.decoded?.gasPrice ?? null,
      canonical: r.decoded?.canonical ?? null,
      errors: codes(r.errorDetails || r.errors),
      allCodes: (r.codes || []).slice(),
      warnings: codes(r.warnings),
      checksumValid: r.checksum?.valid ?? null,
      checksumAbsent: r.checksum?.absent ?? null,
    };
  },
};

function compare(vector, got) {
  const fails = [];
  const exp = vector.expect || {};

  for (const [key, want] of Object.entries(exp)) {
    let have;
    if (key === 'errorCodes') {
      have = [...new Set([...codes(got.errors), ...(got.allCodes || [])])];
      const missing = want.filter((c) => !have.includes(c));
      if (missing.length) fails.push(`errorCodes: expected ${JSON.stringify(want)}, missing ${JSON.stringify(missing)} (got ${JSON.stringify(have)})`);
      continue;
    }
    if (key === 'warningCodes') {
      have = [...new Set([...codes(got.warnings), ...(got.allCodes || [])])];
      const missing = want.filter((c) => !have.includes(c));
      if (missing.length) fails.push(`warningCodes: expected ${JSON.stringify(want)}, missing ${JSON.stringify(missing)} (got ${JSON.stringify(have)})`);
      continue;
    }
    if (key === 'amountMustBeWeiString') {
      have = got.amount;
      if (have !== want) fails.push(`amountMustBeWeiString: expected ${want}, got ${JSON.stringify(have)}`);
      continue;
    }
    have = got[key];
    if (have === undefined) {
      fails.push(`${key}: implementation did not report this field (expected ${JSON.stringify(want)})`);
    } else if (String(have) !== String(want)) {
      fails.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(have)}`);
    }
  }
  return fails;
}

async function loadAdapter(arg) {
  if (!arg) return bundledAdapter;
  const mod = await import(path.resolve(arg));
  const a = mod.default || mod;
  if (typeof a.parse !== 'function') throw new Error(`${arg} does not export { parse }`);
  return { name: a.name || arg, parse: a.parse };
}

async function main() {
  const adapter = await loadAdapter(process.argv[2]);
  const spec = JSON.parse(fs.readFileSync(VECTORS, 'utf8'));

  let pass = 0;
  const failures = [];

  for (const v of spec.vectors) {
    let got;
    try {
      got = adapter.parse(v.input);
    } catch (err) {
      failures.push({ id: v.id, spec: v.spec, why: v.why, fails: [`threw: ${err.message}`] });
      continue;
    }
    const fails = compare(v, got);
    if (fails.length) failures.push({ id: v.id, spec: v.spec, why: v.why, input: v.input, fails });
    else pass++;
  }

  console.log(`\nEIP-681 conformance — adapter: ${adapter.name}`);
  console.log(`reference: ${spec.reference}\n`);

  for (const f of failures) {
    console.log(`FAIL  ${f.id}${f.spec ? '  [spec]' : ''}`);
    if (f.input) console.log(`      ${f.input.slice(0, 110)}`);
    for (const m of f.fails) console.log(`      - ${m}`);
    if (f.why) console.log(`      why: ${f.why}`);
    console.log('');
  }

  const specTotal = spec.vectors.filter((v) => v.spec).length;
  const specPass = spec.vectors.filter((v) => v.spec).filter((v) => !failures.some((f) => f.id === v.id)).length;

  console.log(`${pass}/${spec.vectors.length} vectors pass`);
  console.log(`spec-derived: ${specPass}/${specTotal}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
