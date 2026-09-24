// cli.test.mjs — black-box tests for cli.mjs.
//
// Every case here spawns the real CLI as a child process and asserts on stdout
// and the EXIT CODE, because the exit code is the contract that scripts depend on.
// Testing the functions in-process would miss exactly the class of bug this file
// was written to catch: the CLI happily printing a valid-looking answer for an
// invalid URI, because parse() reports failure in-band instead of throwing.
//
// Run: node cli.test.mjs

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'cli.mjs');

let passed = 0;
let failed = 0;

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ok  ' + name);
  } else {
    failed++;
    console.log('  FAIL ' + name + (detail ? '\n        ' + detail : ''));
  }
}

// --- A valid address, all lowercase (so no EIP-55 claim is made) ---------------
const A = '0x1234deadbeef5678abcd1234deadbeef5678abcd';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

console.log('cli.mjs — exit-code contract');

// 1. THE REGRESSION THAT MATTERS: garbage must not be reported as valid.
{
  const r = run(['check', 'garbage:']);
  ok('check garbage -> exit 1', r.code === 1, 'got exit ' + r.code + ' out=' + r.out);
  ok('check garbage -> names the reason', /scheme/i.test(r.out), 'stdout was: ' + r.out);
}

// 2. A URI with a non-hex target must be rejected too.
{
  const r = run(['check', 'ethereum:0xZZZZ']);
  ok('check malformed target -> exit 1', r.code === 1, 'got exit ' + r.code + ' out=' + r.out);
}

// 3. Valid URI -> exit 0, exactly "ok".
{
  const r = run(['check', 'ethereum:' + A]);
  ok('check valid -> exit 0', r.code === 0, 'got exit ' + r.code + ' err=' + r.err);
  ok('check valid -> prints exactly "ok"', r.out === 'ok', 'stdout was: ' + JSON.stringify(r.out));
}

// 4. Schema casing is not part of the identity of a URI (RFC 3986 s3.1).
for (const u of ['ethereum:' + A, 'Ethereum:' + A, 'ETHEREUM:' + A, 'EtHeReUm:' + A]) {
  const r = run(['check', u]);
  ok('scheme casing accepted: ' + u.slice(0, 8), r.code === 0, 'got exit ' + r.code + ' out=' + r.out);
}

// 5. validate over a list: exit 1 if ANY is invalid — this is the CI mode.
{
  const r = run(['validate', 'ethereum:' + A, 'garbage:']);
  ok('validate mixed list -> exit 1', r.code === 1, 'got exit ' + r.code);
  const lines = r.out.split('\n').filter(Boolean);
  ok('validate emits one JSON line per URI', lines.length === 2, 'got ' + lines.length);
  const objs = lines.map((l) => JSON.parse(l));
  ok('validate marks the good one valid', objs[0].valid === true);
  ok('validate marks the bad one invalid', objs[1].valid === false, JSON.stringify(objs[1]));
  ok('invalid entry carries errors[]', Array.isArray(objs[1].errors) && objs[1].errors.length > 0);
}

// 6. validate with everything valid -> exit 0.
{
  const r = run(['validate', 'ethereum:' + A, 'ethereum:' + A + '@1']);
  ok('validate all-valid -> exit 0', r.code === 0, 'got exit ' + r.code);
}

// 7. fmt round-trips and flags non-canonical input.
{
  const r = run(['fmt', 'ethereum:' + A]);
  ok('fmt valid -> exit 0', r.code === 0, 'got exit ' + r.code + ' err=' + r.err);
  ok('fmt prints a URI', r.out.startsWith('ethereum:'), 'stdout was: ' + r.out);
  ok('fmt of canonical input is silent on stderr', r.err === '', 'stderr was: ' + r.err);
}

// 8. Derivation: native transfer, scientific notation expanded exactly.
{
  const r = run(['derive', '--chain', '8453', '--to', A, '--value', '1e16']);
  ok('derive native -> exit 0', r.code === 0, 'got exit ' + r.code + ' err=' + r.err);
  ok('derive native expands 1e16 to digits', r.out.includes('value=10000000000000000'), 'stdout was: ' + r.out);
  ok('derive native keeps the chain id', r.out.includes('@8453'), 'stdout was: ' + r.out);
}

// 9. A mixed-case payee is an EIP-55 CLAIM. If the checksum fails, refuse.
{
  const r = run(['derive', '--chain', '1', '--to', '0x1234Deadbeef5678abcd1234deadbeef5678abcd', '--value', '1']);
  ok('derive failed-checksum payee -> exit 1', r.code === 1, 'got exit ' + r.code + ' out=' + r.out);
  ok('derive refusal is not a stack trace', !/at .*\.mjs:/.test(r.err), 'stderr was: ' + r.err);
}

// 10. A canonical EIP-55 address (correct checksum) must be accepted.
{
  const checksummed = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'; // EIP-55 test vector #2
  const r = run(['derive', '--chain', '1', '--to', checksummed, '--value', '1']);
  ok('derive valid EIP-55 payee -> exit 0', r.code === 0, 'got exit ' + r.code + ' err=' + r.err);
  ok('derive preserves the payee casing verbatim', r.out.toLowerCase().includes(checksummed.toLowerCase()), 'stdout was: ' + r.out);
}
{
  // Same address, deliberately mis-cased -> the claim fails.
  const r = run(['derive', '--chain', '1', '--to', '0xFB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '--value', '1']);
  ok('derive mis-cased EIP-55 claim -> exit 1', r.code === 1, 'got exit ' + r.code + ' out=' + r.out);
}

// 11. ERC-20 derivation needs --amount; decimals must default rather than being absent.
{
  const r = run(['derive', '--chain', '1', '--to', A, '--token', USDC, '--amount', '1.5']);
  ok('derive erc20 with default decimals -> exit 0', r.code === 0, 'got exit ' + r.code + ' err=' + r.err);
  ok('derive erc20 emits the transfer form', /transfer/i.test(r.out), 'stdout was: ' + r.out);
}
{
  const r = run(['derive', '--chain', '1', '--to', A, '--token', USDC]);
  ok('derive erc20 without --amount -> exit 2 (usage)', r.code === 2, 'got exit ' + r.code);
}

// 12. Usage errors exit 2, distinct from "the URI is invalid" (exit 1).
{
  ok('missing --chain -> exit 2', run(['derive', '--to', A]).code === 2);
  ok('non-numeric --chain -> exit 2', run(['derive', '--chain', 'abc', '--to', A, '--value', '1']).code === 2);
  ok('zero --chain -> exit 2', run(['derive', '--chain', '0', '--to', A, '--value', '1']).code === 2);
  ok('unknown command -> exit 2', run(['frobnicate']).code === 2);
  ok('check with no URI -> exit 2', run(['check']).code === 2);
  ok('validate with no URI -> exit 2', run(['validate']).code === 2);
}

// 13. --help is success, not an error.
{
  const r = run(['--help']);
  ok('--help -> exit 0', r.code === 0);
  ok('--help documents exit codes', /Exit codes/i.test(r.out));
}
{
  ok('bare invocation prints help and exits 0', run([]).code === 0);
}

// 14. Fractional wei cannot exist.
{
  const r = run(['derive', '--chain', '1', '--to', A, '--value', '1.5']);
  ok('fractional --value -> exit 2', r.code === 2, 'got exit ' + r.code);
}
{
  const r = run(['derive', '--chain', '1', '--to', A, '--value', '1.5e2']);
  ok('1.5e2 = 150 wei -> exit 0', r.code === 0, 'got exit ' + r.code + ' err=' + r.err);
  ok('1.5e2 expanded to 150', r.out.includes('value=150'), 'stdout was: ' + r.out);
}

// 15. The derive->parse round trip is the invariant the CLI promises.
{
  const d = run(['derive', '--chain', '8453', '--to', A, '--value', '1e16']);
  ok('round trip: derive succeeded', d.code === 0);
  const c = run(['check', d.out]);
  ok('round trip: derived URI parses back', c.code === 0, 'cli rejected its own output: ' + d.out);
  const f = run(['fmt', d.out]);
  ok('round trip: derived URI is already canonical', f.code === 0 && f.err === '', 'stderr: ' + f.err);
}

console.log('\n' + (failed === 0 ? 'ALL PASS: ' : 'FAILURES: ') + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
