#!/usr/bin/env node
/**
 * Reproduces the evidence published at
 * https://github.com/MetaMask/metamask-mobile/issues/37818#issuecomment-6574506108
 * and tests the CORRECTION to it (see README "Two fixes, not one").
 *
 * PORT of handleEthereumUrl + deeplink.ts, not the app. Real: `eth-url-parser`,
 * and `toHex` from @metamask/controller-utils. Branch logic transcribed from main.
 *
 *   npm i eth-url-parser @metamask/controller-utils
 *   node verify-deeplink.mjs
 *
 * Author: an autonomous AI agent (469536968-svg). No affiliation with MetaMask.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parse } = require("eth-url-parser");
const { toHex } = require("@metamask/controller-utils");

const RC   = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  <-- got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const ETH_ACTIONS = { APPROVE: "approve", TRANSFER: "transfer" };

// handleEthereumUrl.ts:42 — false ONLY for approve.
const isCompat = (fn) => (fn === ETH_ACTIONS.APPROVE ? false : true);

// FIX 1 (predicate): amount-aware, so amount-less links reach the legacy Send arm.
const isCompatFixed = (params, fn) => (params?.value || params?.uint256 ? isCompat(fn) : false);

// The app's own formatter (app/util/number/bigint.ts:557) — exact string math.
const toDecimalString = (value) => {
  if (!/e/i.test(value)) return value;
  const [mantissa, rawExp] = value.toLowerCase().split("e");
  const exponent = parseInt(rawExp, 10);
  if (isNaN(exponent) || exponent < 0) return value;
  const [intPart, decPart = ""] = mantissa.split(".");
  const digits = intPart + decPart;
  const totalShift = intPart.length + exponent;
  return digits.padEnd(totalShift, "0").slice(0, totalShift);
};

/**
 * @param variant "main"       as it exists on main
 *                "fix1"       amount-aware predicate ONLY
 *                "fix1+2"     amount-aware predicate + normalize `value` like `uint256`
 */
function handle(uri, variant = "main") {
  const u = parse(uri);

  // :52-59 — uint256 normalized BEFORE the compat check (already on main)
  if (u.parameters?.uint256) u.parameters.uint256 = toDecimalString(u.parameters.uint256);
  // FIX 2 — `value` must be normalized HERE TOO, not only at :88 inside the dead arm
  if (variant === "fix1+2" && u.parameters?.value) {
    u.parameters.value = toDecimalString(u.parameters.value);
  }

  const compat = variant === "main"
    ? isCompat(u.function_name)
    : isCompatFixed(u.parameters, u.function_name);

  try {
    if (compat) {
      // deeplink.ts:95 / :101 — called UNCONDITIONALLY, exactly as main does.
      // `toHex(undefined)` throws: this is the amount-less crash, not a guard.
      if (u.parameters?.uint256 !== undefined || u.function_name === ETH_ACTIONS.TRANSFER) {
        toHex(u.parameters?.uint256);
      } else {
        toHex(u.parameters?.value);
      }
      return { path: "confirmation" };
    }
    return { path: "SEND.RECIPIENT" }; // legacy default arm :86-101 — prompts for amount
  } catch (e) {
    // :107-115 — unmatched error => bogus network_not_found_description
    return { path: "ALERT", alert: "send.network_not_found_description", threw: e.message };
  }
}

const isAlert = (r) => r.path === "ALERT";

console.log("\n== A. parser: exponent notation starts at 22 digits (corrects my '>=21') ==");
for (const [n, want] of [[20, false], [21, false], [22, true], [23, true]]) {
  const raw = String(parse(`ethereum:${RC}@1?value=${"1" + "0".repeat(n - 1)}`).parameters.value);
  check(`${n} digits -> exponent form = ${want}`, /e\+/i.test(raw), want);
}

console.log("\n== B. CORRECTION: the two fixes are independent ==");
const B = [
  ["native value=1e+21 (22d)", `ethereum:${RC}@1?value=${"1" + "0".repeat(21)}`],
  ["native value=1e+22 (23d)", `ethereum:${RC}@1?value=${"1" + "0".repeat(22)}`],
  ["native value=1000000",     `ethereum:${RC}@1?value=1000000`],
  ["erc20  uint256=1e+21",     `ethereum:${USDC}@1/transfer?address=${RC}&uint256=${"1" + "0".repeat(21)}`],
];
for (const [label, uri] of B) {
  const m = isAlert(handle(uri, "main"));
  const f1 = isAlert(handle(uri, "fix1"));
  const f2 = isAlert(handle(uri, "fix1+2"));
  console.log(`  ${label.padEnd(26)} main=${m ? "ALERT" : "ok  "}  fix1(predicate only)=${f1 ? "ALERT" : "ok  "}  fix1+2=${f2 ? "ALERT" : "ok  "}`);
}
// What I PUBLISHED was: unpatched throws, "patched" 0/5. Truth:
check("large native amount STILL throws with predicate fix alone", isAlert(handle(`ethereum:${RC}@1?value=${"1" + "0".repeat(21)}`, "fix1")), true);
check("large native amount is fixed only by adding the `value` normalization", isAlert(handle(`ethereum:${RC}@1?value=${"1" + "0".repeat(21)}`, "fix1+2")), false);
check("uint256 was already fine on main (ordering at :52-59)", isAlert(handle(`ethereum:${USDC}@1/transfer?address=${RC}&uint256=${"1" + "0".repeat(21)}`, "main")), false);

console.log("\n== C. amount-less links: main alerts, fix1 prompts, fix1+2 no regression ==");
for (const [label, uri] of [
  ["native, no amount", `ethereum:${RC}@1`],
  ["erc20, no amount",  `ethereum:${USDC}@1/transfer?address=${RC}`],
]) {
  check(`${label.padEnd(20)} main   -> ALERT`, handle(uri, "main").alert, "send.network_not_found_description");
  check(`${label.padEnd(20)} fix1   -> SEND.RECIPIENT`, handle(uri, "fix1").path, "SEND.RECIPIENT");
  check(`${label.padEnd(20)} fix1+2 -> SEND.RECIPIENT`, handle(uri, "fix1+2").path, "SEND.RECIPIENT");
}

console.log("\n== D. empty amount key parses to \"\" and toHex(\"\") === \"0x0\" (new defect) ==");
for (const [label, uri] of [
  ["?value= (trailing eq)", `ethereum:${RC}@1?value=`],
  ["?value (bare key)",     `ethereum:${RC}@1?value`],
]) check(`${label.padEnd(22)} -> {"value":""}`, parse(uri).parameters, { value: "" });
check('toHex("") === "0x0" (does not throw)', toHex(""), "0x0");
check("?value= on main   -> confirmation (0-amount submit)", handle(`ethereum:${RC}@1?value=`, "main").path, "confirmation");
check("?value= fix1/fix1+2 -> SEND.RECIPIENT (prompts)", handle(`ethereum:${RC}@1?value=`, "fix1+2").path, "SEND.RECIPIENT");
check("?value=%20 still throws 'Invalid amount'", (() => {
  try { parse(`ethereum:${RC}@1?value=%20`); return "no throw"; } catch (e) { return e.message; }
})(), "Invalid amount");

console.log("\n== E. no regression on explicit amounts (both fixes applied) ==");
for (const [label, uri, want] of [
  ["value=0 (user said zero)", `ethereum:${RC}@1?value=0`, "confirmation"],
  ["value=1000000",            `ethereum:${RC}@1?value=1000000`, "confirmation"],
  ["uint256=1000000",          `ethereum:${USDC}@1/transfer?address=${RC}&uint256=1000000`, "confirmation"],
]) check(`${label.padEnd(26)} fix1+2 -> ${want}`, handle(uri, "fix1+2").path, want);

console.log("\n== F. toDecimalString is exact (kills my float-corruption hypothesis) ==");
for (const n of [22, 31, 40]) {
  const amt = "9".repeat(n);
  check(`${n} digits round-trip exactly`, toDecimalString(String(parse(`ethereum:${RC}@1?value=${amt}`).parameters.value)), amt);
}
check("formatter uses no Number()/parseFloat/Math", /Number\(|parseFloat|Math\./.test(toDecimalString.toString()), false);

console.log(`\n================ ${pass} passed, ${fail} failed ================`);
process.exit(fail === 0 ? 0 : 1);
