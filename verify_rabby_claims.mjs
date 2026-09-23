// Verifies the EXACT claims made in the Rabby #1565 draft before posting them.
// Draft claims:
//  (a) `Ethereum:` (capital E) is seen in the wild -> scheme match must be case-insensitive
//  (b) `ethereum:0xADDR` with NO @chainId is valid ("current chain" by convention)
//  (c) prefix is `ethereum:` not `ethereum://` -> a `//`-tolerant parser mis-handles some generators
//  (d) validate the ADDRESS alone with EIP-55, not the whole URI string
import { parse, toChecksumAddress } from './eip681.mjs';

let pass = 0, fail = 0;
const eq = (n, g, w) => { if (g === w) pass++; else { fail++;
  console.log(`FAIL ${n}\n  got : ${JSON.stringify(g)}\n  want: ${JSON.stringify(w)}`); } };

const A = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'; // canonical EIP-55 vector #2

// (a) case-insensitive scheme
eq('(a) ethereum: lower', parse(`ethereum:${A}`).ok, true);
eq('(a) Ethereum: capital E', parse(`Ethereum:${A}`).scheme?.toLowerCase(), 'ethereum');
eq('(a) ETHEREUM: all caps', parse(`ETHEREUM:${A}`).scheme?.toLowerCase(), 'ethereum');
eq('(a) all variants parse ok',
   ['ethereum','Ethereum','ETHEREUM','EtHeReUm'].every(s => parse(`${s}:${A}`).ok), true);

// (b) no @chainId => chainId must be undefined/null, NOT a guessed 1
{
  const p = parse(`ethereum:${A}`);
  eq('(b) no-chainId ok', p.ok, true);
  eq('(b) no-chainId chainId not guessed', p.chainId === undefined || p.chainId === null, true);
  eq('(b) no-chainId target is the address', p.target, A);
}
eq('(b) explicit @8453 works', parse(`ethereum:${A}@8453`).ok, true);

// (c) `ethereum://` — the spec prefix has no `//`. Document actual behavior.
{
  const p = parse(`ethereum://${A}`);
  console.log(`  [note] ethereum:// -> ok=${p.ok} target=${p.target} errors=${JSON.stringify(p.errors)}`);
}

// (d) address validated alone, not the whole URI
eq('(d) address alone verifies', toChecksumAddress(A), A);
eq('(d) whole-URI-as-address would fail', toChecksumAddress(`ethereum:${A}`) === A, false);
{
  const bad = '0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359'; // wrong-cased vector
  eq('(d) wrong-cased address rejected', parse(`ethereum:${bad}`).ok, false);
  // and the error is about the ADDRESS, not the scheme
  eq('(d) rejection reason is checksum', parse(`ethereum:${bad}`).errors[0]?.code, 'bad-checksum');
  eq('(d) lowercased is accepted (no claim)', parse(`ethereum:${bad.toLowerCase()}`).ok, true);
}

console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail ? 1 : 0);
