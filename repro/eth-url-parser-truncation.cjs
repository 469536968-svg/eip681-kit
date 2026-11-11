#!/usr/bin/env node
/**
 * repro/eth-url-parser-truncation.cjs
 *
 * Reproduces the defect reported in brunobar79/eth-url-parser#20:
 * a hex address longer than 40 digits is ACCEPTED and silently TRUNCATED
 * to its first 40 digits, with the leftover digits shifted into chain_id.
 *
 *   npm install eth-url-parser@1.0.4
 *   node repro/eth-url-parser-truncation.cjs
 *
 * Exit 1 when the defect reproduces (i.e. when the bug is present).
 *
 * NEGATIVE CONTROL: a 40-digit address must round-trip byte-identical and must
 * report the chain id that was actually requested. Without that control a
 * harness bug could masquerade as a library bug.
 */

'use strict'

const ADDR = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359' // 40 hex digits, EIP-55 valid
if (ADDR.length !== 42) throw new Error('bad fixture: expected 42 chars incl 0x, got ' + ADDR.length)

let parse
try {
  parse = require('eth-url-parser').parse
} catch (e) {
  console.error('eth-url-parser is not installed.')
  console.error('  npm install eth-url-parser@1.0.4')
  console.error('  (' + e.message + ')')
  process.exit(2)
}

let failures = 0
function report(ok, label, detail) {
  if (!ok) failures++
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''))
}

// ---------------------------------------------------------------- negative control
console.log('# negative control: length 40 must be exact')
{
  const r = parse(`ethereum:${ADDR}@1`)
  const got = r && r.target_address
  report(
    got === ADDR,
    'len 40 round-trips byte-identical',
    `got=${got}`
  )
  report(
    String(r && r.chain_id) === '1',
    'len 40 reports requested chain_id',
    `got=${r && r.chain_id}`
  )
}

// ---------------------------------------------------------------- the defect sweep
console.log('\n# over-length sweep 41..64 (each must be REJECTED)')
console.log('  len | returned  | outLen | identical | chain_id')

const rows = []
for (let len = 41; len <= 64; len++) {
  // Extra digits appended to a valid address, ending in a hex-safe digit.
  const extra = '0'.repeat(len - 40)
  const uri = `ethereum:${ADDR}${extra}@1`
  let r
  try {
    r = parse(uri)
  } catch (e) {
    rows.push({ len, rejected: true })
    console.log(`  ${String(len).padStart(3)} | rejected  |      - |         - | -`)
    continue
  }
  const got = r && r.target_address
  const outLen = got ? got.replace(/^0x/, '').length : 0
  const identical = got === `${ADDR}${extra}`
  rows.push({ len, rejected: false, got, outLen, identical, chainId: r && r.chain_id })
  console.log(
    `  ${String(len).padStart(3)} | returned  | ${String(outLen).padStart(6)} | ` +
    `${String(identical).padStart(9)} | ${JSON.stringify(r && r.chain_id)}`
  )
}

const accepted = rows.filter((r) => !r.rejected)
const truncated = accepted.filter((r) => !r.identical && r.outLen === 40)
const chainCorrupted = accepted.filter((r) => String(r.chainId) !== '1')

console.log('\n# result')
console.log(`  over-length inputs accepted : ${accepted.length}/${rows.length}`)
console.log(`  silently truncated to 40    : ${truncated.length}/${rows.length}`)
console.log(`  chain_id corrupted          : ${chainCorrupted.length}/${rows.length}`)

// The claim in the issue is: ALL over-length inputs are accepted, ALL truncated,
// ALL with a chain id other than the requested 1.
const claimHolds =
  accepted.length === rows.length &&
  truncated.length === rows.length &&
  chainCorrupted.length === rows.length

const controlHeld = failures === 0

console.log('\n# verdict')
if (!controlHeld) {
  console.log('  HARNESS CONTROL FAILED -- a 40-digit address did not round-trip.')
  console.log('  Do not trust the sweep above; fix the harness first.')
  process.exit(3)
}
if (claimHolds) {
  console.log('  DEFECT REPRODUCES: all over-length addresses accepted and truncated,')
  console.log('  and the leaked digit is shifted into the field that selects the network.')
  process.exit(1)
}
console.log('  Defect did NOT reproduce at this version. The sweep above shows what changed.')
process.exit(0)
