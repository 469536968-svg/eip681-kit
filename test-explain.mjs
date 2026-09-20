// test-explain.mjs — tests for the explain() decoder.
// Ground truth: EIP-681 spec examples + the documented real-world failure modes.
import { explain } from './explain.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
}
const codes = r => r.warnings.map(w => w.code);

// --- 1. Spec example: native transfer on mainnet with value ---
{
  const r = explain('ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@1?value=1e18');
  check('native ok', r.ok);
  check('native action', r.decoded.action === 'native transfer', r.decoded.action);
  check('native unit wei', r.decoded.amountUnit === 'wei');
  check('native chain name', r.decoded.chainName === 'Ethereum mainnet', r.decoded.chainName);
  check('native no warnings', r.warnings.length === 0, JSON.stringify(codes(r)));
  check('native risk low', r.riskLevel === 'low', r.riskLevel);
}

// --- 2. Spec example: ERC-20 transfer on mainnet ---
{
  const r = explain('ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@1/transfer?address=0x1234567890123456789012345678901234567890&uint256=1e18');
  check('token ok', r.ok);
  check('token action', r.decoded.action === 'transfer', r.decoded.action);
  check('token contract is PATH address', r.decoded.contract === '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', r.decoded.contract);
  check('token recipient is ?address=', r.decoded.recipient === '0x1234567890123456789012345678901234567890', r.decoded.recipient);
  check('token unit base', r.decoded.amountUnit === 'token-base-units');
  check('token path-is-contract note present', r.notes.some(n => n.code === 'TOKEN_PATH_IS_CONTRACT'));
}

// --- 3. The trap: no chainId ---
{
  const r = explain('ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef?value=1e18');
  check('nochain warns', codes(r).includes('NO_CHAIN_ID'), JSON.stringify(codes(r)));
  check('nochain risk medium', r.riskLevel === 'medium', r.riskLevel);
}

// --- 4. The trap: value AND uint256 together ---
{
  const r = explain('ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@1/transfer?address=0x1234567890123456789012345678901234567890&uint256=1&value=2');
  check('both rejected', r.ok === false, JSON.stringify(r).slice(0,80));
  check('both explained', Array.isArray(r.errorDetails) && r.errorDetails.length > 0, JSON.stringify(r).slice(0,120));
}

// --- 5. uint256 with no contract ---
{
  const r = explain('ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@1?uint256=1');
  check('uint-no-contract explained', r.ok === false && /transfer/.test(JSON.stringify(r.errorDetails)), JSON.stringify(r).slice(0,80));
}

// --- 6. No amount => safest form ---
{
  const r = explain('ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@8453');
  check('no-amount note', r.notes.some(n => typeof n === 'object' ? n.code === 'NO_AMOUNT' : /No amount/.test(n)));
  check('no-amount risk low', r.riskLevel === 'low', r.riskLevel);
  check('base named', r.decoded.chainName === 'Base', r.decoded.chainName);
}

// --- 7. Malformed stays malformed (must NOT be silently accepted) ---
{
  const r = explain('not-a-uri');
  check('malformed rejected', r.ok === false, JSON.stringify(r).slice(0,120));
}

// --- 8. Unknown but valid chainId is a note, not a warning ---
{
  const r = explain('ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@999999?value=1');
  check('unknown chain noted', r.notes.some(n => typeof n === 'string' && n.includes('999999')));
  check('unknown chain not warned', !codes(r).includes('NO_CHAIN_ID'));
}

// --- 9. Every spec example that parses must produce a summary ---
{
  const uris = [
    'ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@1?value=1e18',
    'ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@1',
    'ethereum:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef@1/transfer?address=0x1234567890123456789012345678901234567890&uint256=1e18',
  ];
  for (const u of uris) {
    const r = explain(u);
    check('summary non-empty for ' + u.slice(0, 28), r.ok && typeof r.summary === 'string' && r.summary.length > 10);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
