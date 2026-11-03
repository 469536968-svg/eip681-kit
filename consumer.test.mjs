/**
 * consumer-test.mjs — consume eip681-kit the way a STRANGER would, and prove it.
 *
 * HOW THIS FILE WAS BUILT (the finding is in this history, so it is kept):
 *
 *   v1 (5/9)  I assumed parse() returned `null` on failure. It returns
 *             {ok:false, errors:[{code,message}]} — the caller learns WHY.
 *             The library was right; my assumption was wrong.
 *   v3 (6/9)  I assumed `?value=1e18` surfaces as the string "1e18". The parser
 *             normalizes it to atomic units: 1000000000000000000. Again the
 *             library was right; my assertion was wrong.
 *   v4 (9/10) The builder returned {ok:false, errors:[...]} for every shape I
 *             guessed. Its errors named the missing parameter, which is how I
 *             found the real signature: nativeTransfer({to, wei}).
 *   v5        pass/fail as reported below.
 *
 * Every single failure was my assumption about the API, never the API. That is
 * what reading source instead of consuming it will do to you.
 *
 * THE USABILITY FINDING THAT SURVIVES: the real signature is {to, wei} — but a
 * stranger's first three guesses are (addr, amount) and {target|address, value}.
 * All five are rejected. The rejection is *excellent* (each error code names the
 * exact missing field), so the API is discoverable-with-effort, but it is NOT
 * guessable. A one-line README example would eliminate that; nothing in the
 * package does that today.
 */

const KIT = 'file:///C:/Users/HUAWEI/workspace/eip681-kit/index.mjs';

let pass = 0, fail = 0;
const failures = [];
const notes = [];

/** BigInt-safe structural serializer — JSON.stringify throws on BigInt. */
const ser = (v) => {
  if (typeof v === 'bigint') return `${v}n`;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + ser(v[k])).join(',') + '}';
};

function check(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
const eq = (a, b, msg) => {
  const A = ser(a), B = ser(b);
  if (A !== B) throw new Error(`${msg || 'mismatch'}: got ${A}, want ${B}`);
};
const rejected = (r, code, msg) => {
  ok(r && typeof r === 'object', `${msg}: expected a result object`);
  if (r.ok !== false) throw new Error(`${msg}: expected ok===false, got ok=${ser(r.ok)}`);
  if (!Array.isArray(r.errors) || r.errors.length === 0) throw new Error(`${msg}: rejected with no errors[]`);
  if (code && !r.errors.some((e) => e.code === code))
    throw new Error(`${msg}: expected code "${code}", got ${ser(r.errors.map((e) => e.code))}`);
};
const accepted = (r, msg) => {
  ok(r && typeof r === 'object', `${msg}: expected a result object`);
  if (r.ok !== true)
    throw new Error(`${msg}: expected ok===true, got ${ser(r.ok)} errors=${ser((r.errors || []).map((e) => e.code))}`);
};

const mod = await import(KIT);

const ADDR_LOWER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const ADDR_CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDR_BAD_SUM = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD';
const WEI = 1000000000000000000n; // 1 ETH

// =====================================================================
// 1. Parser contract
// =====================================================================
check('parse: plain native transfer accepted', () => {
  const r = mod.parse(`ethereum:${ADDR_LOWER}@1?value=1e18`);
  accepted(r, 'plain transfer');
  eq(r.scheme, 'ethereum', 'scheme');
  eq(r.target, ADDR_LOWER, 'target');
  eq(String(r.chainId), '1', 'chainId');
});

check('parse: "1e18" normalizes to atomic units — parser does the arithmetic', () => {
  const r = mod.parse(`ethereum:${ADDR_LOWER}@1?value=1e18`);
  eq(String(r.amount), '1000000000000000000', 'amount must be atomic units');
});

check('parse: over-length address rejected (librustzcash #3061 defect class)', () => {
  rejected(mod.parse(`ethereum:0x${'a'.repeat(41)}@1`), 'bad-address', 'over-length 41');
});

check('parse: 40 hex accepted — boundary has no off-by-one', () => {
  accepted(mod.parse(`ethereum:0x${'a'.repeat(40)}@1`), 'exactly 40');
});

check('parse: failed EIP-55 checksum claim rejected with a reason', () => {
  rejected(mod.parse(`ethereum:${ADDR_BAD_SUM}@1`), 'bad-checksum', 'bad checksum');
});

check('parse: canonical EIP-55 accepted', () => {
  accepted(mod.parse(`ethereum:${ADDR_CHECKSUMMED}@1`), 'canonical checksum');
});

check('parse: rejection never yields a trusted canonical output', () => {
  const r = mod.parse(`ethereum:${ADDR_BAD_SUM}@1`);
  ok(r.ok === false, 'should be rejected');
  if (r.canonical !== null && r.canonical !== undefined)
    throw new Error(`rejected parse produced canonical=${ser(r.canonical)}`);
});

// =====================================================================
// 2. Builder — real signature is {to, wei}; verified, not guessed
// =====================================================================
check('nativeTransfer: accepts {to, wei} and returns ok with a URI', () => {
  const r = mod.nativeTransfer({ to: ADDR_LOWER, wei: WEI });
  accepted(r, 'nativeTransfer({to,wei})');
  ok(typeof r.uri === 'string' && r.uri.startsWith('ethereum:'), `uri was ${ser(r.uri)}`);
  notes.push(`nativeTransfer({to, wei}) -> ${r.uri}`);
});

check('nativeTransfer: round-trips through its own parser', () => {
  const r = mod.nativeTransfer({ to: ADDR_LOWER, wei: WEI });
  accepted(r, 'build');
  const back = mod.parse(r.uri);
  accepted(back, `round-trip of ${r.uri}`);
  eq(back.target, ADDR_LOWER, 'round-trip target');
  eq(String(back.amount), String(WEI), 'round-trip amount must survive as wei');
});

check('nativeTransfer: refuses a bad checksum claim rather than silently re-casing', () => {
  let r;
  try { r = mod.nativeTransfer({ to: ADDR_BAD_SUM, wei: WEI }); } catch { return; }
  if (!r || r.ok !== false) {
    // If it built something, it must not claim a false checksum and re-parse clean.
    if (r && r.uri) {
      const p = mod.parse(r.uri);
      if (p.ok === true) throw new Error(`built with bad checksum and re-parsed ok: ${r.uri}`);
    } else {
      throw new Error('expected ok===false for a bad checksum claim');
    }
  }
});

check('nativeTransfer: names the exact missing field on bad input (discoverability)', () => {
  // This is the reason the wrong-signature guess was recoverable at all.
  const r = mod.nativeTransfer({ to: ADDR_LOWER }); // no wei
  rejected(r, 'wei', 'missing wei must be named, not generic');
});

// The usability finding, asserted so it cannot silently regress into a mystery:
check('USABILITY: (addr, amount) positional form is NOT supported — document it', () => {
  const r = mod.nativeTransfer(ADDR_LOWER, WEI);
  ok(r && r.ok === false, 'positional form unexpectedly worked; update this test AND the docs');
  notes.push('FINDING: nativeTransfer(A, amt) and {target|address,value} all fail; only {to, wei} works.');
});

// =====================================================================
// 3. Hostile input must never throw
// =====================================================================
const hostile = [null, undefined, '', 'ethereum:', 'ethereum:0x', 'not a uri', 'ethereum:zzz@1',
  42, {}, [], 'ethereum:0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed@'];
check('parse: never throws on hostile input', () => {
  for (const h of hostile) {
    try { mod.parse(h); } catch (e) { throw new Error(`parse threw on ${ser(h)}: ${e.message}`); }
  }
});
check('nativeTransfer: never throws on hostile input', () => {
  for (const h of [...hostile, { to: ADDR_LOWER }, { wei: WEI }, { to: 42, wei: 'x' }]) {
    try { mod.nativeTransfer(h); } catch (e) { throw new Error(`nativeTransfer threw on ${ser(h)}: ${e.message}`); }
  }
});

// =====================================================================
// 4. Determinism (BigInt-safe compare)
// =====================================================================
check('parse: deterministic across repeated calls', () => {
  const u = `ethereum:${ADDR_CHECKSUMMED}@1?value=1e18`;
  eq(mod.parse(u), mod.parse(u), 'non-deterministic parse');
});
check('nativeTransfer: deterministic across repeated calls', () => {
  eq(mod.nativeTransfer({ to: ADDR_LOWER, wei: WEI }), mod.nativeTransfer({ to: ADDR_LOWER, wei: WEI }), 'non-deterministic build');
});

console.log('\n--- notes ---');
for (const n of notes) console.log('  ' + n);
console.log(`\npass ${pass} / fail ${fail}`);
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('CONSUMER CHECKS PASSED');
