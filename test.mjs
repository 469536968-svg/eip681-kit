// test.mjs — ground-truth tests for eip681.mjs
// Run: node test.mjs
//
// Ground truth sources:
//  - Keccak-256: EIP-55 canonical vectors + the classic "abc"/"" vectors.
//  - EIP-681 examples: the examples section of EIPS/eip-681.
//  - EIP-55 address vectors: the four canonical vectors from EIPS/eip-55.
// Each assertion below states what it pins down. Nothing is compared against
// this library's own output.

import assert from 'node:assert/strict';
import {
  parse, format, parseAmount, keccak256, toChecksumAddress, isChecksumAddress,
  erc20Transfer, nativeTransfer,
} from './eip681.mjs';

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; failures.push([name, e]); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function hex(u8) { return Buffer.from(u8).toString('hex'); }

console.log('\n# keccak-256 (external vectors)');
t('keccak256("") == c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', () => {
  assert.equal(hex(keccak256(new TextEncoder().encode(''))), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});
t('keccak256("abc") == 4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', () => {
  assert.equal(hex(keccak256(new TextEncoder().encode('abc'))), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
});
t('keccak256(fox sentence) == 4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15', () => {
  const s = 'The quick brown fox jumps over the lazy dog';
  assert.equal(hex(keccak256(new TextEncoder().encode(s))), '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15');
});

console.log('\n# EIP-55 checksums (canonical vectors)');
const V55 = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];
for (const v of V55) {
  t('EIP-55 reproduces ' + v, () => assert.equal(toChecksumAddress(v.toLowerCase()), v));
}
t('all-uppercase and all-lowercase are accepted as "not a bad checksum"', () => {
  assert.equal(isChecksumAddress('0X5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'.replace('0X', '0x').toUpperCase().replace('0X', '0x')), true);
  assert.equal(isChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), true);
});
t('a single flipped case is detected as a bad checksum', () => {
  assert.equal(isChecksumAddress('0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), false);
});

console.log('\n# parseAmount');
t('decimal', () => assert.equal(parseAmount('1000').value, 1000n));
t('scientific 1e18 == 10^18 (EIP-681 permits this form)', () => assert.equal(parseAmount('1e18').value, 10n ** 18n));
t('2.5e3 is rejected (not an integer form)', () => assert.equal(parseAmount('2.5e3').ok, false));
t('hex accepted with a flag by the caller', () => assert.equal(parseAmount('0x2a').value, 42n));
t('negative rejected', () => assert.equal(parseAmount('-1').ok, false));
t('empty rejected', () => assert.equal(parseAmount('').ok, false));
t('big values do not lose precision', () => assert.equal(parseAmount('115792089237316195423570985008687907853269984665640564039457584007913129639935').value, 2n ** 256n - 1n));

console.log('\n# EIP-681: native transfer (spec examples)');
const ETH_MAIN = 1;
t('ethereum:0x...@1?value=1e18 parses to a native transfer of 1 ETH', () => {
  const v = parse('ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@1?value=1e18');
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.chainId, 1);
  assert.equal(v.amount, 10n ** 18n);
  assert.equal(v.isTokenTransfer, false);
});
t('omit @chainId -> warning, not error', () => {
  const v = parse('ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed?value=1');
  assert.ok(v.ok);
  assert.ok(v.warnings.some(w => w.code === 'no-chain-id'));
});
t('bad checksum -> warning, not error (wallets must not silently reject)', () => {
  const v = parse('ethereum:0x5aAeb6053f3e94c9b9a09f33669435e7ef1beaed@1?value=1');
  assert.ok(v.ok);
  assert.ok(v.warnings.some(w => w.code === 'bad-checksum'));
});
t('zero address is a hard error', () => {
  const v = parse('ethereum:0x0000000000000000000000000000000000000000@1?value=1');
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.code === 'zero-address'));
});

console.log('\n# EIP-681: ERC-20 transfer (the drainable-parser hazard)');
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TO = '0xb0F4860d56d25a2168a836ae2C34bF657FE3e9f6';
t('token transfer with address+uint256 parses and reads the amount', () => {
  const v = parse(`ethereum:${USDC_BASE}@8453/transfer?address=${TO}&uint256=1000000`);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.isTokenTransfer, true);
  assert.equal(v.chainId, 8453);
  assert.equal(v.recipient, TO);
  assert.equal(v.amount, 1000000n);
});
t('token transfer WITHOUT uint256 warns "open-ended transfer" (the actual hazard)', () => {
  const v = parse(`ethereum:${USDC_BASE}@8453/transfer?address=${TO}`);
  assert.ok(v.ok, 'still grammatically valid');
  assert.ok(v.warnings.some(w => w.code === 'token-no-amount'));
});
t('token transfer WITHOUT address is a hard error', () => {
  const v = parse(`ethereum:${USDC_BASE}@8453/transfer?uint256=1000000`);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.code === 'token-no-recipient'));
});
t('token transfer carrying BOTH value and uint256 is ambiguous -> error', () => {
  const v = parse(`ethereum:${USDC_BASE}@8453/transfer?address=${TO}&uint256=1000000&value=1000000`);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.code === 'token-value-ambiguous'));
});
t('uint256 outside /transfer is rejected', () => {
  const v = parse(`ethereum:${TO}@1?uint256=5`);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.code === 'uint256-without-transfer'));
});
t('partial parser simulation: naive "first param wins" readers of a bare-address URI never see a token', () => {
  // This pins down why the getcash issue says tokens must keep the bare address:
  // a parser that only understands ethereum:<address>?value= silently ignores
  // the /transfer form and can hand the user a transfer of the token contract
  // address itself. We assert the parser *reports* that shape as a token form,
  // so a caller can decide not to emit it.
  const v = parse(`ethereum:${USDC_BASE}@8453/transfer?address=${TO}&uint256=1`);
  assert.equal(v.isTokenTransfer, true);
  assert.notEqual(v.recipient, v.target, 'contract and recipient must be distinguishable');
});

console.log('\n# malformed input: must error, never guess');
const BAD = [
  ['', 'empty'],
  ['http://example.com', 'bad-scheme'],
  ['ethereum:', 'no-target'],
  ['ethereum:0x123', 'bad-address'],
  ['ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@abc', 'bad-chain-id'],
  ['ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@', 'empty-chain-id'],
  ['ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@1/', 'empty-function'],
  ['ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@1/transfer?address=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed&address=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'duplicate-param'],
  ['ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@1?value=abc', 'amount-invalid'],
];
for (const [uri, code] of BAD) {
  t(`rejects ${JSON.stringify(uri.slice(0, 46))} with ${code}`, () => {
    const v = parse(uri);
    assert.equal(v.ok, false, 'expected not ok');
    assert.ok(v.errors.some(e => e.code === code), 'got ' + JSON.stringify(v.errors));
  });
}

console.log('\n# round-trip and builders');
t('parse -> format -> parse is stable, and formatting is deterministic', () => {
  const u = `ethereum:${USDC_BASE}@8453/transfer?address=${TO}&uint256=1000000`;
  const a = parse(u), b = parse(format(a));
  assert.equal(a.canonical, b.canonical);
  assert.equal(b.ok, true);
});
t('erc20Transfer builds a URI that parses back to the same values', () => {
  const r = erc20Transfer({ chainId: 8453, token: USDC_BASE, to: TO, amount: 1_000_000n });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const v = parse(r.uri);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.target, USDC_BASE);
  assert.equal(v.recipient, TO);
  assert.equal(v.amount, 1_000_000n);
});
t('nativeTransfer builds a URI that parses back to the same values', () => {
  const r = nativeTransfer({ chainId: 1, to: TO, wei: 10n ** 16n });
  assert.ok(r.ok);
  const v = parse(r.uri);
  assert.equal(v.amount, 10n ** 16n);
  assert.equal(v.chainId, 1);
});
t('builders refuse bad input instead of emitting a wrong URI', () => {
  assert.equal(erc20Transfer({ chainId: 8453, token: 'nope', to: TO, amount: 1 }).ok, false);
  assert.equal(erc20Transfer({ chainId: 8453, token: USDC_BASE, to: TO, amount: '1.5' }).ok, false);
  assert.equal(nativeTransfer({ chainId: 1, to: '0x0', wei: 1 }).ok, false);
});

console.log('\n# amount safety');
t('float would have been wrong: 0.1+0.2 style sums stay exact', () => {
  const a = parseAmount('100000000000000000').value;
  const b = parseAmount('200000000000000000').value;
  assert.equal(a + b, 300000000000000000n);
});
t('uint256 max accepted, one past it is not representable in 256 bits', () => {
  const max = parseAmount((2n ** 256n - 1n).toString());
  assert.equal(max.ok, true);
  assert.equal(max.value, 2n ** 256n - 1n);
});

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
if (fail) { for (const [n, e] of failures) console.log('- ' + n + ': ' + e.message); process.exit(1); }
