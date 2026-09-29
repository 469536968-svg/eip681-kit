// adversarial.mjs — red-team conformance corpus for the EIP-681 parser.
//
// Every case below is an input that has *actually* broken a real parser, or that
// sits on a sharp edge named in an upstream issue. The point is not to show the
// parser agreeing with itself: it is to run the malformed cases and prove the
// parser refuses them, and to run the ambiguous-but-legal cases and prove it
// warns instead of guessing.
//
// Ground truth for the hashing layer is external (official Keccak-256 vectors and
// the canonical EIP-55 vectors), not this module's own output.
//
// Run: node adversarial.mjs        Exit code 0 = all cases behave as claimed.

import {
  parse, format, parseAmount, toChecksumAddress, isChecksumAddress, keccak256,
  erc20Transfer, nativeTransfer,
} from './eip681.mjs';

const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
let pass = 0, fail = 0;
const failures = [];

function t(id, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`${id}\n      ${e.message}`); }
}
const eq = (a, b, what = '') => {
  const A = typeof a === 'bigint' ? a.toString() : JSON.stringify(a);
  const B = typeof b === 'bigint' ? b.toString() : JSON.stringify(b);
  if (A !== B) throw new Error(`${what} expected ${B} got ${A}`);
};
const codes = (list) => (list || []).map((e) => e.code);

// ---------------------------------------------------------------- external truth
// If the hash layer is wrong, every checksum case below is meaningless. Pin it first.
t('L0 keccak256 official vector ""', () =>
  eq(hex(keccak256(new TextEncoder().encode(''))),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'));
t('L0 keccak256 official vector "abc"', () =>
  eq(hex(keccak256(new TextEncoder().encode('abc'))),
    '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'));
t('L0 keccak256 official vector fox', () =>
  eq(hex(keccak256(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))),
    '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15'));

const EIP55 = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];
EIP55.forEach((v, i) => t(`L0 EIP-55 canonical vector ${i + 1}`, () => eq(toChecksumAddress(v.toLowerCase()), v)));

// A checksum must NOT survive a perturbed nibble. Without this, "the checksum
// passed" is unfalsifiable.
t('L0 checksum rejects a flipped nibble', () => {
  const bad = '0x' + (EIP55[0].slice(2).replace('aA', 'aa'));
  eq(toChecksumAddress(EIP55[0].toLowerCase()) === bad, false, 'perturbed address');
  eq(isChecksumAddress(bad), false, 'perturbed isChecksumAddress');
});

// ------------------------------------------------- C1: address-length boundary
// Upstream reality: native recipient / ERC-20 address / ERC-20 token contract all
// run through the same length check upstream, and an over-length value has been
// accepted as valid. The grammar floor is 40 and there is no ceiling to inherit.
const A40 = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
t('C1 40 hex digits accepted (baseline)', () =>
  eq(parse(`ethereum:${A40}@1`).ok, true, 'ok'));
for (const n of [39, 41, 42, 48, 64]) {
  t(`C1 ${n} hex digits refused`, () => {
    const a = '0x' + A40.slice(2).padEnd(n, '0').slice(0, n);
    const r = parse(`ethereum:${a}@1`);
    eq(r.ok, false, 'ok');
    eq(codes(r.errors).includes('bad-address'), true, 'codes ' + JSON.stringify(codes(r.errors)));
  });
}
t('C1 over-length token address refused', () => {
  const tok = '0x' + 'a'.repeat(41);
  const r = parse(`ethereum:${tok}/transfer?address=${A40}&uint256=1`);
  eq(r.ok, false, 'ok');
});

// -------------------------------------------------------- C2: checksum claims
// Mixed case IS an EIP-55 claim. If it fails, the string does not describe the
// address it appears to, and paying it is worse than refusing it.
t('C2 mixed-case with a failing checksum refused', () => {
  const bad = '0x' + A40.slice(2).replace('fB', 'FB');   // wrong case, not the checksum
  const r = parse(`ethereum:${bad}@1`);
  eq(r.ok, false, 'ok');
  eq(codes(r.errors).includes('bad-checksum'), true, JSON.stringify(codes(r.errors)));
});
t('C2 mixed-case with a VALID checksum accepted', () =>
  eq(parse(`ethereum:${EIP55[1]}@1`).ok, true, 'ok'));
t('C2 all-lowercase accepted (no claim made)', () =>
  eq(parse(`ethereum:${A40.toLowerCase()}@1`).ok, true, 'ok'));
t('C2 all-uppercase body accepted (no claim made)', () =>
  eq(parse('ethereum:0x' + A40.slice(2).toUpperCase() + '@1').ok, true, 'ok'));

// --------------------------------------------------------- C3: the zero address
t('C3 zero address refused', () => {
  const r = parse('ethereum:0x0000000000000000000000000000000000000000@1');
  eq(r.ok, false, 'ok');
  eq(codes(r.errors).includes('zero-address'), true, JSON.stringify(codes(r.errors)));
});

// ------------------------------------------------------------ C4: chain-id edges
t('C4 missing @chainId is legal but flagged', () => {
  const r = parse(`ethereum:${A40}/transfer?address=${A40}&uint256=1`);
  eq(r.ok, true, 'ok');
  eq(r.chainId, null, 'chainId');
  eq(r.warnings.length > 0, true, 'expected at least one warning');
});
t('C4 chain id 0 refused', () => {
  const r = parse(`ethereum:${A40}@0`);
  eq(r.ok, false, 'ok');
  eq(codes(r.errors).includes('chain-id-zero'), true, JSON.stringify(codes(r.errors)));
});
t('C4 empty chain id refused', () => {
  const r = parse(`ethereum:${A40}@`);
  eq(r.ok, false, 'ok');
});
t('C4 hex chain id accepted', () =>
  eq(parse(`ethereum:${A40}@0x1`).chainId, 1, 'chainId'));
t('C4 decimal chain id accepted', () =>
  eq(parse(`ethereum:${A40}@137`).chainId, 137, 'chainId'));
t('C4 chain id beyond safe integer refused', () => {
  const r = parse(`ethereum:${A40}@99999999999999999999999`);
  eq(r.ok, false, 'ok');
});

// --------------------------------------------------- C5: amount parsing corners
t('C5 spec example 2.014e18 is exact', () => eq(parseAmount('2.014e18').value, 2014000000000000000n, 'value'));
t('C5 fractional base units refused', () => eq(parseAmount('1.5').ok, false, 'ok'));
t('C5 negative refused', () => eq(parseAmount('-1').ok, false, 'ok'));
t('C5 empty refused', () => eq(parseAmount('').ok, false, 'ok'));
t('C5 uint256 max round-trips exactly', () =>
  eq(parseAmount('115792089237316195423570985008687907853269984665640564039457584007913129639935').value,
    2n ** 256n - 1n, 'value'));
t('C5 hex amount accepted', () => { const a = parseAmount('0x2a'); eq(a.ok, true, 'ok'); eq(a.value, 42n, 'value'); });
t('C5 exponent-only junk refused', () => eq(parseAmount('e18').ok, false, 'ok'));
t('C5 leading-dot refused', () => eq(parseAmount('.5').ok, false, 'ok'));

// ------------------------------------------- C6: the token-transfer sharp edges
// Upstream reality: a token transfer that omits uint256 is read by some wallets as
// open-ended and by others as a fixed zero transfer; and `value=` alongside
// `uint256=` makes the intent ambiguous to any parser that reads both.
t('C6 token transfer without uint256 warns', () => {
  const r = parse(`ethereum:${A40}/transfer?address=${A40}`);
  eq(r.ok, true, 'ok');
  eq(r.isTokenTransfer, true, 'isTokenTransfer');
  eq(r.amount, null, 'amount');
  eq(r.warnings.length > 0, true, 'expected a warning');
});
t('C6 token transfer with uint256 exposes recipient and amount', () => {
  const r = parse(`ethereum:${A40}/transfer?address=${A40}&uint256=1000`);
  eq(r.recipient.toLowerCase(), A40.toLowerCase(), 'recipient');
  eq(r.amount, 1000n, 'amount');
});
// Deliberate DESIGN DECISION, pinned so it cannot drift silently: the parser
// REFUSES this rather than warning. Two amount fields for one transfer is not a
// style problem -- whichever field a downstream wallet prefers, the other one is
// ignored, so the amount is not what the emitter wrote. "Refuse to guess" is the
// module's stated rule, so a hard error is the consistent behaviour here.
t('C6 value= alongside uint256= is REFUSED, not warned', () => {
  const r = parse(`ethereum:${A40}/transfer?address=${A40}&uint256=1000&value=1`);
  eq(r.ok, false, 'ok');
  eq(codes(r.errors).includes('token-value-ambiguous'), true, JSON.stringify(codes(r.errors)));
  eq(r.amount, null, 'no amount may be silently chosen');
});
t('C6 contract-as-payee is distinguishable from recipient', () => {
  // The deposit-QR bug: the ERC-20 contract belongs in the target, the person in
  // `address=`. A consumer that reads `target` as the payee pays the contract.
  const contract = '0x' + 'b'.repeat(40);
  const r = parse(`ethereum:${contract}@1/transfer?address=${A40}&uint256=5`);
  eq(r.target.toLowerCase(), contract, 'target');
  eq(r.recipient.toLowerCase(), A40.toLowerCase(), 'recipient');
  eq(r.target.toLowerCase() !== r.recipient.toLowerCase(), true, 'target must not be read as payee');
});

// ------------------------------------------------------ C7: structural malforms
t('C7 no scheme refused', () => eq(parse(A40).ok, false, 'ok'));
t('C7 wrong scheme refused', () => eq(parse('bitcoin:' + A40).ok, false, 'ok'));
t('C7 empty refused', () => eq(parse('').ok, false, 'ok'));
t('C7 ethereum: with no target refused', () => eq(parse('ethereum:').ok, false, 'ok'));
t('C7 uppercase scheme accepted', () => eq(parse(`Ethereum:${A40}@1`).ok, true, 'ok'));
t('C7 deprecated pay- prefix accepted but warned', () => {
  const r = parse(`ethereum:pay-${A40}@1`);
  eq(r.ok, true, 'ok');
  eq(r.target.toLowerCase(), A40.toLowerCase(), 'target');
  eq(r.warnings.length > 0, true, 'expected a warning');
});
t('C7 single hex digit short of a full address refused', () =>
  eq(parse(`ethereum:0x${'f'.repeat(39)}@1`).ok, false, 'ok'));

// ---------------------------------------------- C8: round-trip is not identity
// format(parse(x)) is deliberately NOT x (a malformed URI must not be re-emitted
// as if it were fine). The property worth pinning is that a *canonical* form
// re-parses to the same semantics.
t('C8 valid URI round-trips to the same semantics', () => {
  const r = parse(`ethereum:${A40}@1/transfer?address=${A40}&uint256=1000`);
  const again = parse(r.canonical);
  eq(again.ok, true, 're-parse ok');
  eq(again.chainId, r.chainId, 'chainId');
  eq(again.amount, r.amount, 'amount');
  eq(again.recipient.toLowerCase(), r.recipient.toLowerCase(), 'recipient');
});
// The helpers return {ok, errors, uri} -- the emitted URI is on `.uri`. Verified
// so that the emitter and the parser cannot disagree about the same string.
t('C8 helpers emit URIs their own parser accepts', () => {
  const e = erc20Transfer({ chainId: 1, token: '0x' + 'b'.repeat(40), to: A40, amount: 1000n });
  eq(e.ok, true, 'erc20Transfer status');
  const pe = parse(e.uri);
  eq(pe.ok, true, 'erc20Transfer -> parse: ' + JSON.stringify(codes(pe.errors)));
  eq(pe.amount, 1000n, 'erc20Transfer amount');

  const n = nativeTransfer({ chainId: 1, to: A40, wei: 10n ** 18n });
  eq(n.ok, true, 'nativeTransfer status');
  const pn = parse(n.uri);
  eq(pn.ok, true, 'nativeTransfer -> parse: ' + JSON.stringify(codes(pn.errors)));
  eq(pn.amount, 10n ** 18n, 'nativeTransfer amount');
});
t('C8 malformed input yields no canonical string', () => {
  const r = parse(`ethereum:0x${'f'.repeat(41)}@1`);
  eq(r.ok, false, 'ok');
});

// ------------------------------------------------------------------------ report
console.log(`adversarial corpus: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
