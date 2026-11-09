#!/usr/bin/env node
// Conformance harness: point it at ANY published EIP-681 parser and get a verdict.
//
//   npm install <some-parser>
//   node conformance/run-against-parser.cjs <some-parser>
//
// Dependency-free. Reports three classes of disagreement with the corpus in this
// repository, plus a length sweep for silent address truncation.
//
// EXIT CODES are distinct on purpose, because a broken harness must never be readable
// as a strict library:
//   0 = no disagreement found
//   1 = disagreement found (defects)
//   2 = HARNESS/BINDING FAILURE -- the library could not be exercised, or a control
//       failed. The output is meaningless in this case. Do not read it as strictness.
//
// Every check that can report "reject" is paired with a control that must pass first.
'use strict';

const { createRequire } = require('node:module');
const { existsSync, readFileSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');

const LF = String.fromCharCode(10);

// ---------- load corpus ----------
function findCorpus() {
  const here = __dirname;
  const cands = [
    join(here, 'vectors.json'),
    join(here, '..', 'conformance', 'vectors.json'),
    resolve('conformance', 'vectors.json'),
    resolve('vectors.json'),
  ];
  for (const p of cands) if (existsSync(p)) return p;
  return null;
}

function loadCases(p) {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.cases || raw.vectors || []);
  const out = [];
  let undeterminable = 0;
  for (const c of arr) {
    const e = c.expect;
    let ok = null;
    if (e === true) ok = true;
    else if (e === false) ok = false;
    else if (e && typeof e === 'object' && typeof e.ok === 'boolean') ok = e.ok;
    // Refuse to score a case whose expectation cannot be read. Silently treating an
    // unreadable expectation as "agree" is how a comparator reports a false 100%.
    if (ok === null) { undeterminable++; continue; }
    out.push({ id: c.id, uri: c.input, expectOk: ok, why: String(c.why || '').slice(0, 100) });
  }
  return { cases: out, undeterminable };
}

// ---------- bind a parse callable out of an arbitrary module shape ----------
function bind(mod) {
  if (typeof mod === 'function') return mod;
  if (!mod) return null;
  const names = ['parse', 'parseUri', 'parseURL', 'parseUrl', 'decode', 'decodeUri', 'decodeEIP681Uri'];
  for (const k of names) if (typeof mod[k] === 'function') return mod[k];
  if (mod.default) {
    if (typeof mod.default === 'function') return mod.default;
    for (const k of names) if (typeof mod.default[k] === 'function') return mod.default[k];
  }
  const fns = Object.keys(mod).filter(k => typeof mod[k] === 'function');
  return fns.length === 1 ? mod[fns[0]] : null;
}

function callWith(fn, uri) {
  // Some parsers take (uri, chainId). Try the documented single-arg form first.
  try { return { ok: true, val: fn(uri) }; }
  catch (e1) {
    try { return { ok: true, val: fn(uri, 1) }; }
    catch (e2) { return { ok: false, err: String((e1 && e1.message) || e1).slice(0, 120) }; }
  }
}

// A parser may signal rejection by returning an error-shaped object instead of throwing.
function looksRejected(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'object') {
    if (v.error || v.errors || v.ok === false || v.success === false) return true;
    const keys = Object.keys(v);
    if (keys.length === 0) return true;
  }
  return false;
}

function collectHex(o, acc) {
  if (o === null || o === undefined) return acc;
  if (typeof o === 'string') {
    const m = o.match(/0x[0-9a-fA-F]{20,}/g);
    if (m) acc.push(...m);
    return acc;
  }
  if (typeof o === 'object') {
    for (const k of Object.keys(o)) collectHex(o[k], acc);
  }
  return acc;
}

// ---------- main ----------
const target = process.argv[2];
if (!target) {
  console.log('usage: node conformance/run-against-parser.cjs <module-name>');
  console.log('');
  console.log('  <module-name> must already be installed (npm install <module-name>).');
  console.log('  Run this from the directory containing node_modules.');
  process.exit(2);
}

const corpusPath = findCorpus();
if (!corpusPath) {
  console.log('HARNESS FAILURE: vectors.json not found near this script or in ./conformance');
  process.exit(2);
}

// Resolve the target module from the CALLER's directory, not this script's, so that
// `node path/to/run-against-parser.cjs foo` works when foo is installed in cwd.
const req = createRequire(join(process.cwd(), 'noop.js'));
let mod;
try { mod = req(target); }
catch (e) {
  console.log('HARNESS FAILURE: cannot require "' + target + '" from ' + process.cwd());
  console.log('  ' + String(e.message).split(LF)[0]);
  console.log('  Did you run `npm install ' + target + '` in this directory?');
  process.exit(2);
}

const fn = bind(mod);
if (!fn) {
  console.log('HARNESS FAILURE: no parse-like callable found on "' + target + '"');
  console.log('  exported keys: ' + (mod && typeof mod === 'object' ? Object.keys(mod).slice(0, 15).join(', ') : typeof mod));
  console.log('  This is an API-shape problem, NOT evidence that the library is strict.');
  process.exit(2);
}

// ---------- SMOKE CONTROL ----------
// Must parse a canonical valid URI. Without this, a wrong binding throws on everything
// and looks exactly like a strict validator -- the single easiest way to publish a lie.
const SMOKE = 'ethereum:0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359@1';
const smoke = callWith(fn, SMOKE);
if (!smoke.ok || looksRejected(smoke.val)) {
  console.log('HARNESS FAILURE: smoke control failed -- cannot parse a canonical valid URI:');
  console.log('  ' + SMOKE);
  console.log('  result: ' + (smoke.ok ? JSON.stringify(smoke.val).slice(0, 200) : 'threw: ' + smoke.err));
  console.log('  The library was not exercised properly. All later numbers would be fiction.');
  process.exit(2);
}
console.log('smoke control: PASS  (' + JSON.stringify(smoke.val).slice(0, 100) + ')');

const { cases, undeterminable } = loadCases(corpusPath);
if (cases.length === 0) {
  console.log('HARNESS FAILURE: corpus yielded 0 scorable cases -- expectation format changed?');
  process.exit(2);
}
console.log('corpus: ' + cases.length + ' scorable, ' + undeterminable + ' undeterminable (not scored)');
console.log('target: ' + target);
console.log('');

// ---------- corpus run ----------
const acceptedInvalid = [];
const rejectedValid = [];
let agree = 0;

for (const c of cases) {
  const r = callWith(fn, c.uri);
  const accepted = r.ok && !looksRejected(r.val);
  const matches = (accepted === c.expectOk);
  if (matches) { agree++; continue; }
  const rec = { ...c, accepted, err: r.err, got: r.ok ? JSON.stringify(r.val).slice(0, 150) : null };
  if (c.expectOk === false) acceptedInvalid.push(rec);
  else rejectedValid.push(rec);
}

console.log('== corpus ==');
console.log('  agree:                    ' + agree + '/' + cases.length);
console.log('  accepted-invalid:         ' + acceptedInvalid.length);
console.log('  rejected-valid:           ' + rejectedValid.length);

if (acceptedInvalid.length) {
  console.log('');
  console.log('  -- corpus says REJECT, library ACCEPTED --');
  for (const r of acceptedInvalid) {
    console.log('   [' + r.id + '] ' + String(r.uri).slice(0, 88));
    console.log('        why: ' + r.why);
    console.log('        got: ' + r.got);
  }
}
if (rejectedValid.length) {
  console.log('');
  console.log('  -- corpus says ACCEPT, library REJECTED --');
  for (const r of rejectedValid) {
    console.log('   [' + r.id + '] ' + String(r.uri).slice(0, 88));
    console.log('        why: ' + r.why);
    console.log('        err: ' + (r.err || 'returned a rejection-shaped value'));
  }
}

// ---------- length sweep (silent truncation) ----------
// Independent of any validation policy: dropping a hex digit maps address X to a
// DIFFERENT account Y, so a displayed address can differ from the scanned one.
const BASE = 'fB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
const sweep = [];
for (let n = 40; n <= 64; n++) {
  const addr = '0x' + BASE + '0'.repeat(n - 40);
  const r = callWith(fn, 'ethereum:' + addr + '@1');
  const accepted = r.ok && !looksRejected(r.val);
  const hexes = accepted ? collectHex(r.val, []) : [];
  const preserved = hexes.some(h => h.toLowerCase() === addr.toLowerCase());
  const truncated = accepted && !preserved &&
    hexes.some(h => h.length === 42 && addr.toLowerCase().startsWith(h.toLowerCase()));
  sweep.push({ n, accepted, preserved, truncated });
}

const control = sweep.find(s => s.n === 40);
const over = sweep.filter(s => s.n > 40);
const controlOk = control && control.accepted && control.preserved;

console.log('');
console.log('== length sweep (silent truncation) ==');
if (!controlOk) {
  console.log('  NEGATIVE CONTROL len=40: FAIL -- a valid address did not round-trip.');
  console.log('  Timings and results above cannot be trusted; reporting harness failure.');
  process.exit(2);
}
console.log('  NEGATIVE CONTROL len=40: PASS (valid address round-trips byte-identical)');

const truncations = over.filter(s => s.truncated);
const acceptCount = over.filter(s => s.accepted).length;
console.log('  over-length accepted:    ' + acceptCount + '/' + over.length);
console.log('  of those, TRUNCATED:     ' + truncations.length);
if (truncations.length) {
  console.log('  lengths affected:        ' + truncations[0].n + '..' + truncations[truncations.length - 1].n);
}

// ---------- verdict ----------
console.log('');
const defects = acceptedInvalid.length + rejectedValid.length + truncations.length;
if (truncations.length > 0) {
  console.log('VERDICT: silent address truncation reproduced. This is not a policy question:');
  console.log('         the returned address is a different account than the input.');
}
if (defects === 0) {
  console.log('VERDICT: no disagreement found against this corpus.');
  process.exit(0);
}
console.log('VERDICT: ' + defects + ' disagreement(s) found.');
process.exit(1);
