#!/usr/bin/env node
// Executed proof that eth-url-parser@1.0.4 silently truncates over-length addresses.
// Contains a NEGATIVE CONTROL: length 40 must round-trip byte-identical. If the control
// fails, the harness is wrong and the rest of the output must be ignored.
//
//   mkdir -p /tmp/trunc && cd /tmp/trunc && npm init -y >/dev/null
//   npm install eth-url-parser@1.0.4
//   node /path/to/this/script.cjs
const parser = require('eth-url-parser');
const parse = parser.default?.parse || parser.parse || parser;

const BASE = 'fB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'; // 40 hex digits, valid EIP-55 casing
const rows = [];

for (let n = 40; n <= 64; n++) {
  const addr = '0x' + BASE + '0'.repeat(n - 40);
  const uri = 'ethereum:' + addr + '@1';
  const row = { len: n };
  try {
    const r = parse(uri);
    row.returned = r.target_address;
    row.outLen = r.target_address.replace(/^0x/, '').length;
    row.identical = r.target_address === addr;
    row.chain = r.chain_id;
  } catch (e) {
    row.threw = String(e && e.message || e).slice(0, 80);
  }
  rows.push(row);
}

console.log('len | behavior | outLen | identical | chain_id reported');
for (const r of rows) {
  console.log(
    String(r.len).padStart(3) + ' | ' +
    (r.threw ? 'threw' : 'returned').padEnd(8) + ' | ' +
    String(r.outLen ?? '-').padStart(6) + ' | ' +
    String(r.identical ?? '-').padStart(9) + ' | ' +
    (r.threw ? '-' : JSON.stringify(r.chain))
  );
}

const control = rows.find(r => r.len === 40);
const over = rows.filter(r => r.len > 40);
const truncated = over.filter(r => !r.threw && !r.identical);
const chainShifted = over.filter(r => !r.threw && r.chain !== '1');

console.log('');
console.log('negative control (len 40 identical): ' + (control && control.identical ? 'PASS' : 'FAIL - HARNESS SUSPECT'));
console.log('over-length uris accepted:          ' + (over.length - over.filter(r => r.threw).length) + '/' + over.length);
console.log('of those, address truncated:        ' + truncated.length);
console.log('of those, chain_id is NOT "1":      ' + chainShifted.length);

if (!(control && control.identical)) process.exit(2);
if (truncated.length > 0) {
  console.log('');
  console.log('CONFIRMED: over-length addresses are silently converted to a different address.');
  process.exit(1);
}
console.log('');
console.log('Not reproduced: over-length addresses are rejected. Library may be fixed.');
