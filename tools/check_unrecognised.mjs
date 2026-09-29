#!/usr/bin/env node
// check_unrecognised.mjs — lint Rust code that builds eip681 requests.
//
// TWO RULES, each with the measurement that justifies it (both against
// zcash/librustzcash components/eip681 @ 7a2504de3c, PR #3062 applied):
//
//   R1 UNRECOGNISED-PROPAGATION
//      from_native_request_parts / from_erc20_request_parts end in `Self::parse(&req)`.
//      Measured: 41/64/65/128 hex digits -> Ok(Unrecognised(..)), never Err.
//      A caller using `?` / unwrap / expect therefore gets no failure signal.
//
//   R2 RAW-BYPASS
//      `into_raw()` is public and matches all three variants:
//          NativeRequest(r) => r.inner, Erc20Request(r) => r.inner, Unrecognised(r) => r
//      Measured: the over-length address survives verbatim as
//          into_raw().target_address -> Address(HexDigits { places: "aaa…128…" })
//      So into_raw() discards exactly the variant discrimination that was doing the
//      validation. That is fine IF the caller re-validates, and a silent hazard if not.
//
// HEURISTIC LIMITS — read before trusting the output:
//   * Line/window based, not a parser. A handler far from the call site can be missed.
//   * R1 does NOT flag propagation narrowed by as_native()/as_erc20() — narrowing is handling.
//   * R2 does NOT flag into_raw() followed by an explicit length/validation check.
//   * Exit 1 means "review these", NOT "this is a bug". I cannot prove reachability of a
//     signer from this file, so the tool does not claim to.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CTORS = ["from_native_request_parts", "from_erc20_request_parts"];
const NARROWERS = ["as_native", "as_erc20", "Unrecognised", "into_raw", "as_raw"];
const SIGNAL_LOST = [/\?\s*;?\s*$/m, /\.unwrap\(\)/, /\.expect\(/];
// Markers that the caller re-established the guarantees into_raw() erased.
const VALIDATORS = [
  ".len()", "is_empty", "validate", "try_into", "TryFrom",
  "IncorrectEthAddressLen", "Erc55Validation", "checked_", "assert_",
];
const WINDOW = 18;

function rsFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "target" || e === ".git") continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) rsFiles(p, out);
    else if (e.endsWith(".rs")) out.push(p);
  }
  return out;
}

const stripDefs = (src) =>
  src.replace(/^\s*(pub\s+)?fn\s+from_(native|erc20)_request_parts\s*\(/gm, "// DEF");

function statementAt(lines, i) {
  let stmt = "";
  for (let j = i; j < Math.min(i + 12, lines.length); j++) {
    stmt += lines[j] + "\n";
    if (lines[j].includes(";")) break;
  }
  return stmt;
}

function lintFile(path) {
  const lines = stripDefs(readFileSync(path, "utf8")).split(/\r?\n/);
  const findings = [];
  const windowAt = (i) => lines.slice(i, Math.min(i + WINDOW, lines.length)).join("\n");

  lines.forEach((line, i) => {
    if (/^\s*\/\//.test(line) || /^\s*(pub\s+)?fn\s+/.test(line)) return;

    // --- R1 ---
    if (CTORS.some((c) => line.includes(c))) {
      const stmt = statementAt(lines, i);
      const lost = SIGNAL_LOST.find((re) => re.test(stmt));
      const win = windowAt(i);
      if (lost && !NARROWERS.some((n) => win.includes(n))) {
        findings.push({
          rule: "R1",
          file: path, line: i + 1, code: line.trim(),
          reason: `result consumed by ${/unwrap|expect/.test(String(lost)) ? "unwrap/expect" : "?"} with no Unrecognised/narrowing check within ${WINDOW} lines`,
        });
      }
      return;
    }

    // --- R2 ---
    if (line.includes("into_raw()")) {
      const win = windowAt(i);
      if (!VALIDATORS.some((v) => win.includes(v))) {
        findings.push({
          rule: "R2",
          file: path, line: i + 1, code: line.trim(),
          reason: `raw struct obtained without re-validating the address (no len/validation marker within ${WINDOW} lines); into_raw() erases the Unrecognised discrimination`,
        });
      }
    }
  });
  return findings;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node check_unrecognised.mjs <dir-or-file.rs> [...]");
  process.exit(2);
}

let all = [];
for (const r of roots) {
  const st = statSync(r);
  const files = st.isDirectory() ? rsFiles(r) : [r];
  for (const f of files) all = all.concat(lintFile(f));
}

if (all.length === 0) {
  console.log("clean: no R1/R2 findings");
  process.exit(0);
}
console.log(`review ${all.length} finding(s):\n`);
for (const f of all) {
  console.log(`  [${f.rule}] ${relative(process.cwd(), f.file)}:${f.line}`);
  console.log(`    ${f.code}`);
  console.log(`    -> ${f.reason}\n`);
}
process.exit(1);
