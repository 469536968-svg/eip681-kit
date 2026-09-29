#!/usr/bin/env node
// check_unrecognised.mjs — lint Rust call sites of eip681's *request_parts constructors.
//
// WHY THIS EXISTS (measured, not hypothesised):
//   zcash/librustzcash components/eip681 @ 7a2504de3c
//     from_native_request_parts / from_erc20_request_parts both end in `Self::parse(&req)`.
//     Measured: 41/64/65/128 hex-digit addresses -> Ok(Unrecognised(..)), never Err.
//   So a caller writing `let r = ..._request_parts(..)?;` gets no failure signal for an
//   address no chain can sign. The damage is bounded (as_native()/as_erc20() are both None
//   on Unrecognised), so this is an API-shape lint, NOT a soundness proof.
//
// HEURISTIC LIMITS — read before trusting output:
//   * Line/window based, not a parser. A match arm far from the call site can be missed.
//   * We deliberately do NOT flag propagation that narrows via as_native()/as_erc20(),
//     because narrowing *is* handling the variant.
//   * Exit code 1 means "review these", not "this is a bug".

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CTORS = ["from_native_request_parts", "from_erc20_request_parts"];
const NARROWERS = ["as_native", "as_erc20", "Unrecognised", "into_raw", "as_raw"];
const SIGNAL_LOST = [/\?;?\s*$/m, /\.unwrap\(\)/, /\.expect\(/];

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

function stripDefs(src) {
  // Drop `pub fn from_*_request_parts(` definition lines so we only see call sites.
  return src.replace(/^\s*(pub\s+)?fn\s+from_(native|erc20)_request_parts\s*\(/gm, "// DEF");
}

function lintFile(path) {
  const src = stripDefs(readFileSync(path, "utf8"));
  const lines = src.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, i) => {
    if (!CTORS.some((c) => line.includes(c))) return;
    if (/^\s*\/\//.test(line) || /^\s*(pub\s+)?fn\s+/.test(line)) return;

    // Collect the statement: from the call site forward until the first `;`.
    let stmt = "";
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      stmt += lines[j] + "\n";
      if (lines[j].includes(";")) break;
    }
    // Window after the statement, where handling usually appears.
    const window = lines.slice(i, Math.min(i + 18, lines.length)).join("\n");

    const lostOn = SIGNAL_LOST.find((re) => re.test(stmt));
    const handled = NARROWERS.some((n) => window.includes(n));
    if (!lostOn || handled) return;

    findings.push({
      file: path,
      line: i + 1,
      code: line.trim(),
      reason: `result consumed by ${String(lostOn).includes("unwrap") || String(lostOn).includes("expect") ? "unwrap/expect" : "?"} with no Unrecognised/narrowing check within 18 lines`,
    });
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
  console.log("clean: no un-narrowed from_*_request_parts call sites found");
  process.exit(0);
}
console.log(`review ${all.length} call site(s):\n`);
for (const f of all) {
  console.log(`  ${relative(process.cwd(), f.file)}:${f.line}`);
  console.log(`    ${f.code}`);
  console.log(`    -> ${f.reason}\n`);
}
process.exit(1);
