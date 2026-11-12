// probe.mjs — MEASURE the real eip681.mjs behaviour. No assumptions.
// Question: what keys does parse() accept, and what does it record in params?
import * as mod from './eip681.mjs';

const GHOST   = '0x000000000000000000000000000000000000dEaD';
const TOKEN   = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

const cases = [
  `ethereum:${GHOST}@1?value=1000`,
  `ethereum:${GHOST}@1?value=1000&foo=bar`,
  `ethereum:${GHOST}@1?value=1000&gas=21000`,
  `ethereum:${GHOST}@1?value=0x3e8`,
  `ethereum:${TOKEN}@1/transfer?address=${VITALIK}&uint256=1000`,
  `ethereum:${TOKEN}@1/transfer?address=${VITALIK}&uint256=0x3e8`,
  `ethereum:${TOKEN}@1/transfer?address=${VITALIK}&uint256=1000&foo=1`,
];

const lines = [];
lines.push('EXPORTS: ' + Object.keys(mod).sort().join(', '));
lines.push('DEFAULT: ' + (mod.default === undefined ? 'none' : typeof mod.default));
for (const c of cases) {
  const r = mod.parse(c);
  lines.push('');
  lines.push('URI: ' + c);
  lines.push('  ok=' + r.ok + '  isTokenTransfer=' + r.isTokenTransfer);
  lines.push('  target=' + r.target + '  recipient=' + r.recipient);
  lines.push('  amount=' + (typeof r.amount === 'bigint' ? r.amount + 'n' : String(r.amount)));
  lines.push('  params keys=' + JSON.stringify(r.params ? Object.keys(r.params) : null));
  lines.push('  params=' + JSON.stringify(r.params));
  lines.push('  canonical=' + JSON.stringify(r.canonical));
  lines.push('  rejected=' + JSON.stringify(r.rejected));
  lines.push('  errors=' + JSON.stringify(r.errors));
  lines.push('  warnings=' + JSON.stringify(r.warnings));
}
console.log(lines.join('\n'));
