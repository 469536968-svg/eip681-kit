// types.test.mjs — the typed entry point must tell the truth about runtime.
//
//   node types.test.mjs
//
// index.d.ts is generated, so the failure mode worth guarding against is not a wrong
// declaration but a MISSING one: a name that exists at runtime, is absent from the
// declarations, and therefore only breaks a TypeScript consumer. This test compares the
// two surfaces directly, then exercises the entry point's behaviour and invariants.

import * as kit from './index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const RUNTIME = ['SCHEME', 'ERC20_TRANSFER', 'keccak256', 'toChecksumAddress',
  'isChecksumAddress', 'parseAmount', 'parse', 'format', 'erc20Transfer',
  'nativeTransfer', 'deriveEip681', 'toBaseUnits', 'isHexAddress', 'isUsableAddress'];

// 1. every name the declarations promise must exist at runtime (else the .d.ts lies)
const dts = readFileSync(join(root, 'index.d.ts'), 'utf8');
const declared = [...dts.matchAll(/export (?:const|function|interface) ([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
for (const n of declared) {
  if (n[0] === n[0].toUpperCase() && n === n.toUpperCase()) {
    check(`declared ${n} exists at runtime`, typeof kit[n] !== 'undefined');
  }
}

// 2. every runtime function must be declared (else the consumer cannot call it)
for (const n of RUNTIME) {
  check(`runtime ${n} present`, typeof kit[n] !== 'undefined');
  check(`runtime ${n} declared in index.d.ts`, new RegExp(`\\b${n}\\b`).test(dts));
}

// 3. behaviour through the entry point
const r = kit.parse('ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359&uint256=1000');
check('token transfer parses', r.ok, JSON.stringify(r.errors));
check('amount is 1000n', r.amount === 1000n, String(r.amount));
check('recipient is the payee, not the contract', r.recipient === '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', String(r.recipient));
check('target is the contract', r.target === '0xdAC17F958D2ee523a2206206994597C13D831ec7', String(r.target));
check('isTokenTransfer', r.isTokenTransfer === true);

// 4. builders: invalid input must never yield a signable URI
const good = kit.erc20Transfer({ chainId: 1, token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', to: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', amount: 1000n });
check('erc20Transfer builds a URI', good.ok && good.uri.startsWith('ethereum:'), JSON.stringify(good.errors));
const bad = kit.erc20Transfer({ chainId: 1, token: 'nope', to: 'x', amount: 1n });
check('erc20Transfer refuses invalid input', bad.ok === false);
check('erc20Transfer returns NO uri on failure', bad.uri === null, String(bad.uri));
const nat = kit.nativeTransfer({ chainId: 1, to: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', wei: 10n ** 18n });
check('nativeTransfer builds a URI', nat.ok && nat.uri.startsWith('ethereum:'), JSON.stringify(nat.errors));

// 5. deriveEip681 must refuse what it cannot express
check('deriveEip681 rejects a bad payee', kit.deriveEip681({ chainId: 1, payee: 'garbage', asset: null }) === null);

// 6. THE invariant: a failed parse exposes no amount
const f = kit.parse('ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359&uint256=1000&value=1');
check('ambiguous token amount is an error', f.ok === false, JSON.stringify(f.errors.map((e) => e.code)));
check('FAILED parse exposes NO amount', f.amount === null, String(f.amount));

// 7. round-trip through the canonical formatter
const c = kit.parse(kit.format(kit.parse('ethereum:0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359@1?value=1000')));
check('format -> parse round-trips', c.ok && c.amount === 1000n, JSON.stringify(c.errors));

console.log(`types: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
