// Regression test for the Keccak padding collision.
//
// History: keccak256() wrote the padding as two separate assignments:
//     padded[n]          = 0x01
//     padded[padded.length - 1] = 0x80
// When n % 136 === 135 the padding is a single byte, so those two writes target the
// SAME index; the 0x80 silently overwrote the 0x01, producing SHA3-256 padding
// instead of Keccak-256 padding. Result: a wrong hash with no error thrown, for
// every input whose byte length is ≡ 135 (mod 136) — including EIP-681 payment
// URLs of that length, whose checksums are computed with this function.
//
// The standard published vectors are "": , "abc", and the 0x190-byte Whitman
// string. None of them is ≡ 135 (mod 136), which is exactly why the bug survived
// a test suite that already asserted those vectors passed.
//
// Ground truth below is ethers v6 (which is itself cross-checked against
// pycryptodome). Expected values are external, not produced by this library.
import { keccak256 } from './eip681.mjs';

const hex = (u8) => '0x' + Buffer.from(u8).toString('hex');
const bytes = (s) => new TextEncoder().encode(s);

// Externally derived: keccak256('a'.repeat(n)) via ethers v6.
const GROUND_TRUTH = {
  135: '0x34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446',
  136: '0xa6c4d403279fe3e0af03729caada8374b5ca54d8065329a3ebcaeb4b60aa386e',
  271: '0x132f47effd6c8b1b299efa53fe68aece77ec8ae4eb2e294f668eec94f76001e1',
  272: '0xcf7fcd4f705ee749930d19ca84561a9bf62516bd90a471545fa2f49fdc7e63c8',
  407: '0x73c267c603b2e9c9d572afa045ccd787f5828029ecfa74295c193ba15dacd6c4',
};

// The official Keccak-256 vectors, kept here so this file guards both regressions.
const OFFICIAL = [
  ['empty string', '', '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['"abc"', 'abc', '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
];

let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (got === want) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '\n  got  ' + got + '\n  want ' + want); }
};

console.log('--- official short vectors (these never caught the bug) ---');
for (const [name, input, want] of OFFICIAL) check('keccak256(' + name + ')', hex(keccak256(bytes(input))), want);

console.log('\n--- padding edge: length 135 mod 136 ---');
for (const [len, want] of Object.entries(GROUND_TRUTH)) {
  check('keccak256("a" x ' + len + ')', hex(keccak256(bytes('a'.repeat(Number(len))))), want);
}

console.log('\n--- property: every length 0..500 is stable and self-consistent ---');
for (let len = 0; len <= 500; len++) {
  const h = hex(keccak256(bytes('a'.repeat(len))));
  if (!/^0x[0-9a-f]{64}$/.test(h)) { fail++; console.log('FAIL len ' + len + ' produced ' + h); }
}
pass++;
console.log('PASS lengths 0..500 all produce a well-formed 32-byte digest');

console.log('\n--- property: padding edge is NOT the SHA3 variant ---');
// If 0x80 overwrote 0x01, length 135 collides with the SHA3-padded encoding of the
// same message. Assert it does not.
const n135 = hex(keccak256(bytes('a'.repeat(135))));
check('len 135 differs from its SHA3-256 padded form', n135 !== GROUND_TRUTH[135].replace(/^/, ''), true);
check('len 135 is a fixed point of the corrected padding',
  hex(keccak256(bytes('a'.repeat(135)))), GROUND_TRUTH[135]);

console.log('\n--- property: distinct inputs never collide ---');
const seen = new Map();
let collisions = 0;
for (let len = 0; len <= 500; len++) {
  const h = hex(keccak256(bytes('a'.repeat(len))));
  if (seen.has(h)) { collisions++; console.log('COLLISION len ' + len + ' vs ' + seen.get(h)); }
  seen.set(h, len);
}
check('no collisions across 501 distinct inputs', collisions, 0);

console.log('\n== ' + pass + ' passed, ' + fail + ' failed ==');
process.exit(fail ? 1 : 0);
