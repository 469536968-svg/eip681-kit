// verify/invariant-control.mjs — a negative control for eip681.mjs's two documented invariants.
//
// Run:  node verify/invariant-control.mjs
// Exit: 0 = invariants hold AND the control proved they are load-bearing.
//
// WHY A NEGATIVE CONTROL
// A passing test tells you the code satisfies the assertion. It does not tell you the *fix*
// is what makes it pass -- the assertion may have held before the change too, or may be
// vacuous. So this script does two things:
//
//   1. Asserts the invariants against the shipped parser.
//   2. Reconstructs the PRE-FIX parser by reversing exactly the two edits, re-runs the same
//      probes, and requires that they FAIL there.
//
// If the pre-fix parser also passes, the invariant is not attributable to the fix and this
// script exits non-zero. It is designed to be able to fail.
//
// THE TWO INVARIANTS
//
//   I1. ok === false implies amount === null.
//       A caller testing `amount !== null` instead of `ok` must never be able to act on a
//       parse this module rejected.
//
//   I2. A recipient making a FAILED EIP-55 claim is an error, not a warning.
//       isChecksumAddress() accepts all-lower and all-upper addresses because they carry no
//       case information and therefore cannot MISclaim. So the checksum branch is reachable
//       only by a mixed-case address whose claim failed -- usually a corrupted or mistyped
//       address. The recipient is where funds land, so it is an error.
//
// ON THE CORPUS (a correction, kept visible)
// My first version of this file asserted that all eight hostile inputs would be rejected.
// Seven were. The eighth -- a plain `/transfer?address=...` with no amount -- is accepted,
// which is defensible: a transfer of zero is not malformed. The assertion was my invention,
// not a documented guarantee, so it is removed. Each case now declares what it expects, and
// only the documented invariant is asserted. Guessing at a specification and then failing my
// own guess is a mistake I have made too often to leave uncorrected here.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, '..', 'eip681.mjs');

const TARGET = '0x1111111111111111111111111111111111111111';
const RCPT = '0x2222222222222222222222222222222222222222';

// Each case states what it expects. `reject: null` means "not specified -- informational",
// and it is excluded from the assertion so the suite cannot fail on my guesswork.
const HOSTILE = [
  { label: 'duplicate uint256 (ambiguous amount)', reject: true,
    uri: `ethereum:${TARGET}@1/transfer?address=${RCPT}&uint256=1e18&uint256=2e18` },
  { label: 'legacy value disagrees with uint256', reject: true,
    uri: `ethereum:${TARGET}@1/transfer?address=${RCPT}&uint256=1e18&value=5` },
  { label: 'unparseable quantity', reject: true,
    uri: `ethereum:${TARGET}@1/transfer?address=${RCPT}&uint256=0xZZ` },
  { label: 'token transfer with no recipient', reject: true,
    uri: `ethereum:${TARGET}@1/transfer?uint256=1e18` },
  { label: 'recipient is the zero address', reject: true,
    uri: `ethereum:${TARGET}@1/transfer?address=0x0000000000000000000000000000000000000000&uint256=1e18` },
  { label: 'duplicate address', reject: true,
    uri: `ethereum:${TARGET}@1/transfer?address=${RCPT}&uint256=1e18&address=0x3333333333333333333333333333333333333333` },
  { label: 'empty quantity', reject: true,
    uri: `ethereum:${TARGET}@1/transfer?address=${RCPT}&uint256=` },
  // Accepted by the parser. A zero-amount transfer is not malformed; recorded so the
  // acceptance is deliberate and visible rather than an unnoticed hole.
  { label: 'transfer with address and no amount', reject: null,
    uri: `ethereum:${TARGET}@1/transfer?address=${RCPT}` },
];

// A canonical EIP-55 vector. It contains LETTERS, so its casing carries real information --
// without letters a "mixed case" address is meaningless and the test would be vacuous.
const VALID_55 = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';

function flipOneLetterCase(addr) {
  const body = addr.slice(2).split('');
  for (let i = 0; i < body.length; i++) {
    if (/[a-fA-F]/.test(body[i])) {
      body[i] = body[i] === body[i].toLowerCase() ? body[i].toUpperCase() : body[i].toLowerCase();
      break;
    }
  }
  return '0x' + body.join('');
}
const CORRUPT_55 = flipOneLetterCase(VALID_55);

const withRecipient = r => `ethereum:${TARGET}@1/transfer?address=${r}&uint256=1e18`;

function buildPrefixSource(src) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);

  // reverse edit 2: drop the exit invariant and its leading comment
  let blockRemoved = false;
  const start = lines.findIndex(l => /if \(!out\.ok\) \{/.test(l));
  if (start >= 0) {
    let s = start;
    while (s > 0 && /^\s*\/\//.test(lines[s - 1])) s--;
    let e = start;
    while (e < lines.length && lines[e].trim() !== '}') e++;
    lines.splice(s, e - s + 1);
    blockRemoved = true;
  }

  // reverse edit 1: recipient checksum failure back to a warning
  let warningRestored = false;
  const ci = lines.findIndex(l => l.includes("err('recipient-bad-checksum'"));
  if (ci >= 0) {
    lines[ci] = "        warnings.push(warn('recipient-bad-checksum', `recipient has an invalid EIP-55 checksum: ${to}`));";
    warningRestored = true;
  }

  return { src: lines.join(eol), blockRemoved, warningRestored };
}

const load = (tag) => import(pathToFileURL(MODULE).href + '?t=' + tag + Date.now());

async function probeI1(tag) {
  const m = await load(tag);
  const out = [];
  for (const c of HOSTILE) {
    let r;
    try { r = m.parse(c.uri); } catch { continue; }
    out.push({
      label: c.label, expect: c.reject, ok: r.ok, amount: r.amount,
      codes: (r.errors || []).map(e => e.code).join(','),
    });
  }
  return out;
}

async function probeI2(tag) {
  const m = await load(tag);
  const r = m.parse(withRecipient(CORRUPT_55));
  return { ok: r.ok, codes: (r.errors || []).map(e => e.code).join(',') };
}

const frozen = readFileSync(MODULE, 'utf8');
let failures = 0;
const fail = m => { failures++; console.log('  FAIL  ' + m); };
const pass = m => console.log('  pass  ' + m);

console.log('== I1: ok===false implies amount===null ==');
{
  const rows = await probeI1('a');
  for (const r of rows) {
    const mark = r.expect === true ? 'must-reject' : r.expect === false ? 'must-accept' : 'info';
    console.log(`  [${mark.padEnd(11)}] ${r.label.padEnd(38)} ok=${String(r.ok).padEnd(5)} amount=${r.amount === null || r.amount === undefined ? 'null' : r.amount}`);
  }
  const rejected = rows.filter(r => !r.ok);
  const leaks = rejected.filter(r => r.amount !== null && r.amount !== undefined);
  console.log(`  ${rejected.length}/${rows.length} rejected`);

  for (const r of rows) {
    if (r.expect === true && r.ok) fail('expected rejection but was accepted: ' + r.label);
  }
  // The documented invariant, and the only thing asserted about amounts.
  if (leaks.length === 0) pass('no rejected parse exposes an amount (I1 holds)');
  else { leaks.forEach(l => console.log(`        leak amount=${l.amount} codes=${l.codes}`)); fail(leaks.length + ' rejected parse(s) expose an amount'); }
}

console.log('\n== I2: a failed EIP-55 claim on the recipient is an error ==');
{
  const m = await load('b');
  const valid = m.parse(withRecipient(VALID_55));
  const lower = m.parse(withRecipient(VALID_55.toLowerCase()));
  const upper = m.parse(withRecipient('0x' + VALID_55.slice(2).toUpperCase()));
  const corrupt = m.parse(withRecipient(CORRUPT_55));

  if (valid.ok) pass('canonical EIP-55 address accepted'); else fail('canonical EIP-55 address rejected');
  if (lower.ok) pass('all-lowercase accepted (no case info => no claim)'); else fail('all-lowercase rejected');
  if (upper.ok) pass('all-uppercase accepted (no case info => no claim)'); else fail('all-uppercase rejected');

  const codes = (corrupt.errors || []).map(e => e.code);
  if (corrupt.ok) fail('corrupted mixed-case address was ACCEPTED');
  else if (!codes.includes('recipient-bad-checksum')) fail('rejected, but not for the checksum reason: ' + codes.join(','));
  else pass('corrupted mixed-case address rejected with recipient-bad-checksum');
}

console.log('\n== NEGATIVE CONTROL: rebuild the pre-fix parser, require the probes to fail ==');
let controlWorked = false;
{
  const { src: pre, blockRemoved, warningRestored } = buildPrefixSource(frozen);
  console.log(`  edits reversed: exit-invariant=${blockRemoved} recipient-error->warning=${warningRestored}`);
  if (!blockRemoved || !warningRestored) {
    fail('could not reconstruct the pre-fix source (source shape changed) -- control is void');
  } else {
    writeFileSync(MODULE, pre);
    try {
      const i1 = await probeI1('c');
      const i2 = await probeI2('c');
      const preLeaks = i1.filter(r => !r.ok && r.amount !== null && r.amount !== undefined);
      console.log(`  pre-fix I1: ${i1.filter(r => !r.ok).length}/${i1.length} rejected, ${preLeaks.length} leak(s)`);
      preLeaks.forEach(l => console.log(`        leak amount=${l.amount} codes=${l.codes}`));
      console.log(`  pre-fix I2: corrupted recipient ok=${i2.ok} codes=${i2.codes || '-'}`);

      const i1Fails = preLeaks.length > 0;
      const i2Fails = i2.ok === true;
      if (i1Fails) pass('I1 control: the pre-fix parser DID leak amounts on parses it rejected');
      else fail('I1 control VOID: pre-fix parser did not leak either -- not attributable to the fix');
      if (i2Fails) pass('I2 control: the pre-fix parser DID accept a failed EIP-55 claim');
      else fail('I2 control VOID: pre-fix parser also rejected it -- not attributable to the fix');
      controlWorked = i1Fails && i2Fails;
    } finally {
      writeFileSync(MODULE, frozen);
    }
  }
}

const restored = readFileSync(MODULE, 'utf8') === frozen;
console.log('\n  restore byte-exact: ' + restored);
if (!restored) fail('module was not restored byte-exactly -- inspect eip681.mjs before committing');

console.log('\n' + '='.repeat(58));
if (failures === 0 && controlWorked) console.log('OK: invariants hold, and the control proves they are load-bearing.');
else console.log(`${failures} failure(s); control_worked=${controlWorked}`);
process.exit(failures === 0 && controlWorked ? 0 : 1);
