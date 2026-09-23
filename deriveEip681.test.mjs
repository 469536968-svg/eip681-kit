// Tests for deriveEip681. Ground truth = round-trip through the verified parser,
// plus the canonical EIP-55 vectors for any address that carries a checksum claim.
// Field names verified against eip681.mjs: parse() -> { scheme, target, chainId,
// functionName, params, ok, errors, canonical }. format() consumes the same shape.
// Run: node deriveEip681.test.mjs
//
// NOTE (2026-09-23): this file previously used PAYEE2 with WRONG CASING
// (0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359). That string is the canonical
// EIP-55 vector #2 (0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359) with the `f` and
// `b` lowercased. Because it is *mixed* case, it is an explicit EIP-55 claim, and
// the claim is false — so the parser correctly refused it (bad-checksum) and the
// native round-trip failed. The parser was right; the fixture was wrong.
// That real-world footgun is now locked in as a regression test below.

import { deriveEip681, toBaseUnits } from './deriveEip681.mjs';
import { parse, toChecksumAddress } from './eip681.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}\n  got : ${got}\n  want: ${want}`); }
};

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // canonical EIP-55
const PAYEE     = '0x54235780057CC828C92aA40e3b02053881990153'; // canonical EIP-55
const PAYEE2    = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'; // canonical EIP-55 vector #2
const PAYEE2_WRONGCASE = '0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359'; // the old bad fixture

// --- toBaseUnits ----------------------------------------------------------
eq('base 1.5 @6',        toBaseUnits('1.5', 6),  '1500000');
eq('base 1 @6',          toBaseUnits('1', 6),    '1000000');
eq('base 0.000001 @6',   toBaseUnits('0.000001', 6), '1');
eq('base 10 @0',         toBaseUnits('10', 0),   '10');
eq('too many decimals -> null', toBaseUnits('1.0000001', 6), null);
eq('negative -> null',   toBaseUnits('-1', 6),   null);
eq('empty -> null',      toBaseUnits('', 6),     null);
eq('big exact',          toBaseUnits('123456789.123456', 6), '123456789123456');

// --- native transfer (round-trip) ----------------------------------------
const native = deriveEip681({
  chainId: 8453, asset: 'native', payee: PAYEE2, wei: '10000000000000000',
});
eq('native shape', native,
   `ethereum:${PAYEE2}@8453?value=10000000000000000`);
{
  const p = parse(native);
  eq('native ok',        p.ok, true);
  eq('native scheme',    p.scheme, 'ethereum');
  eq('native chainId',   p.chainId, 8453);
  eq('native target',    p.target, PAYEE2);
  eq('native value',     p.params.value, '10000000000000000');
  eq('native canonical', p.canonical, native);
}

// --- ERC-20 transfer (round-trip) ----------------------------------------
const erc20 = deriveEip681({
  chainId: 8453, asset: USDC_BASE, payee: PAYEE, amount: '1.5', decimals: 6,
});
eq('erc20 shape', erc20,
   `ethereum:${USDC_BASE}@8453/transfer?address=${PAYEE}&uint256=1500000`);
{
  const p = parse(erc20);
  eq('erc20 ok',          p.ok, true);
  eq('erc20 functionName', p.functionName, 'transfer');
  eq('erc20 target=token', p.target, USDC_BASE);   // pre-/ segment is the TOKEN
  eq('erc20 payee param',  p.params.address, PAYEE);
  eq('erc20 uint256',      p.params.uint256, '1500000');
  eq('erc20 canonical',    p.canonical, erc20);
}

// --- the dangerous inversion: token contract must never be the payee -----
eq('target is token, address param is payee',
   parse(erc20).target === PAYEE ? 'PAYEE' : 'TOKEN', 'TOKEN');

// --- REGRESSION: canonical EIP-55 vectors carry a real checksum claim ------
// The examples in EIP-55 and EIP-681 are mixed-case. Copy them with the wrong
// casing and you have silently changed which address the string claims to be.
eq('EIP-55 vector #2 is self-consistent',
   toChecksumAddress(PAYEE2), PAYEE2);
eq('wrong-cased EIP-55 vector is rejected by parse()',
   parse(`ethereum:${PAYEE2_WRONGCASE}@8453?value=1`).errors.some(e => e.code === 'bad-checksum'),
   true);
eq('deriveEip681 REFUSES to emit a wrong-cased checksummed payee (null)',
   deriveEip681({ chainId: 8453, asset: 'native', payee: PAYEE2_WRONGCASE, wei: '1' }),
   null);
eq('all-lowercase address has no checksum claim, so it is accepted',
   parse(`ethereum:${PAYEE2.toLowerCase()}@8453?value=1`).ok, true);

// --- null cases: never guess ---------------------------------------------
eq('null: no chainId',   deriveEip681({ asset:'native', payee: PAYEE2, wei:'1' }), null);
eq('null: bad payee',    deriveEip681({ chainId:1, asset:'native', payee:'0x1234', wei:'1' }), null);
eq('null: zero wei',     deriveEip681({ chainId:1, asset:'native', payee: PAYEE2, wei:'0' }), null);
eq('null: no decimals',  deriveEip681({ chainId:1, asset:USDC_BASE, payee:PAYEE, amount:'1' }), null);
eq('null: inexact dec',  deriveEip681({ chainId:1, asset:USDC_BASE, payee:PAYEE, amount:'1.0000001', decimals:6 }), null);
eq('null: negative cid', deriveEip681({ chainId:-1, asset:'native', payee: PAYEE2, wei:'1' }), null);
eq('null: not object',   deriveEip681(null), null);
eq('null: string asset', deriveEip681({ chainId:1, asset:'USDC', payee:PAYEE, amount:'1', decimals:6 }), null);

console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail ? 1 : 0);
