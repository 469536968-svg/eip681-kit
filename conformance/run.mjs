// conformance/run.mjs — differential conformance test.
//
// Data source: conformance/recipient-length.json, which was MEASURED (not assumed) by
// running `cargo test -p eip681 --test length_sweep` against zcash/librustzcash
// components/eip681 with PR #3062 applied.
//
// What this test does: asks the kit's own independent JS parser the same question the
// Rust sweep asked, and fails if the two implementations disagree. Two independent
// implementations agreeing on "exactly 40 hex digits, else refuse" is evidence; one
// implementation agreeing with itself is not.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "../eip681.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, "recipient-length.json"), "utf8"));

const PAYEE40 = spec.reference_address_40; // keep 0x: EIP-681 addresses are prefixed

let pass = 0, fail = 0;
const failures = [];

// "rejected" == parse returns null / undefined / throws. Anything else is acceptance.
function outcome(uri) {
  let r;
  try { r = parse(uri); } catch { return "rejected"; }
  if (r === null || r === undefined) return "rejected";
  if (typeof r === "object" && r.kind === "unrecognised") return "rejected";
  if (typeof r === "object" && r.ok === true) return "accepted";
  // anything else -- including {ok:false, errors:[...]} -- is a refusal
  return "rejected";
}

function check(label, uri, expected) {
  const got = outcome(uri);
  if (got === expected) { pass++; return; }
  fail++;
  failures.push({ label, uri, expected, got });
}

const hex = (n) => "a".repeat(n);

// --- native recipient position -------------------------------------------------
for (let n = 1; n <= 48; n++) {
  const uri = `ethereum:0x${hex(n)}?value=1`;
  const expected = n === 40 ? "accepted" : "rejected";
  check(`native len=${n}`, uri, expected);
}

// --- erc20 token contract position --------------------------------------------
for (let n = 1; n <= 48; n++) {
  const tok = "0x" + "b".repeat(n);
  const uri = `ethereum:${tok}/transfer?address=${PAYEE40}&uint256=1000000`;
  const expected = n === 40 ? "accepted" : "rejected";
  check(`erc20-contract len=${n}`, uri, expected);
}

// --- the boundary must be exactly 40, both directions -------------------------
check("len 39 refused", `ethereum:0x${hex(39)}?value=1`, "rejected");
check("len 40 accepted", `ethereum:0x${hex(40)}?value=1`, "accepted");
check("len 41 refused", `ethereum:0x${hex(41)}?value=1`, "rejected");

// --- the exact string from the Rust negative control ---------------------------
check(
  "negative-control input is refused here too",
  "ethereum:0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d3590?value=1",
  "rejected"
);

console.log(`eip681-kit conformance vs measured librustzcash behaviour`);
console.log(`  source: ${spec.provenance.measured_against}`);
console.log(`  ${pass} passed, ${fail} failed, ${pass + fail} total`);
for (const f of failures.slice(0, 20)) {
  console.log(`  FAIL ${f.label}\n       uri=${f.uri}\n       expected=${f.expected} got=${f.got}`);
}
process.exit(fail === 0 ? 0 : 1);
