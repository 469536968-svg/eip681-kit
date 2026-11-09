#!/usr/bin/env node
/**
 * NEGATIVE CONTROL for claim-drift.cjs.
 *
 * A drift checker that only ever says HOLD is worthless. This copies the REAL
 * claim-drift.cjs source and rewrites only the CLAIMS array with deliberately
 * FALSE claims, then asserts the checker returns DRIFT for each. Reusing the
 * source text (rather than reimplementing the checks) means this tests the
 * actual shipped logic, not a paraphrase of it.
 *
 * It also plants an UNKNOWN case (a file that cannot exist) to prove rule 1:
 * unreadable must never be reported as PASS.
 *
 * SELF-BUG LOG (kept, because it is the point): v1 of this file split the report
 * on '\n[' -- which STRIPS the leading bracket -- and then required the block to
 * start with '['. Every assertion read '(none)' while the report printed 4 DRIFT
 * and 1 UNKNOWN. The checker was right; my assertion parser was broken. That is
 * the same class of error as the eth-url-parser differential that once reported
 * "49/49 agree" while comparing nothing. Fixed by matching without the bracket.
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const SRC = path.join(__dirname, 'claim-drift.cjs')
const OUT = path.join(__dirname, '_drift_selftest.cjs')
const src = fs.readFileSync(SRC, 'utf8')

const poisoned = `
const CLAIMS = [
  {
    id: 'NEG-1-wrong-line-anchor',
    publishedAt: 'selftest://neg-1',
    repo: 'vultisig/vultisig-sdk', branch: 'main',
    path: 'packages/core/mpc/keysign/signingInputs/resolvers/evm/index.ts',
    anchors: [{ line: 77, mustContain: 'THIS STRING DOES NOT EXIST ANYWHERE', why: 'planted' }],
  },
  {
    id: 'NEG-2-line-number-drift',
    publishedAt: 'selftest://neg-2',
    repo: 'vultisig/vultisig-sdk', branch: 'main',
    path: 'packages/core/mpc/keysign/signingInputs/resolvers/evm/index.ts',
    anchors: [{ line: 999, mustContain: 'const getToAddress', why: 'exists but NOT on line 999' }],
  },
  {
    id: 'NEG-3-inverted-ordering',
    publishedAt: 'selftest://neg-3',
    repo: 'vultisig/vultisig-sdk', branch: 'main',
    path: 'packages/core/mpc/keysign/signingInputs/resolvers/evm/index.ts',
    ordering: [{ before: 'const getToAddress', after: 'if (erc20ApprovePayload) {', why: 'planted inversion' }],
  },
  {
    id: 'NEG-4-forbidden-present',
    publishedAt: 'selftest://neg-4',
    repo: 'vultisig/vultisig-sdk', branch: 'main',
    path: 'packages/core/mpc/keysign/signingInputs/resolvers/evm/index.ts',
    mustNotContain: ['getToAddress'],
  },
  {
    id: 'NEG-5-unreadable-must-be-UNKNOWN',
    publishedAt: 'selftest://neg-5',
    repo: 'vultisig/vultisig-sdk', branch: 'main',
    path: 'this/path/does/not/exist/at/all.ts',
    anchors: [{ line: 1, mustContain: 'anything', why: 'unreachable file' }],
  },
]
`

const start = src.indexOf('const CLAIMS = [')
const endMarker = '\n]\n'
const end = src.indexOf(endMarker, start)
if (start === -1 || end === -1) { console.error('SELFTEST_BUILD_FAILED: could not locate CLAIMS array'); process.exit(9) }
const patched = src.slice(0, start) + poisoned.trim() + src.slice(end + endMarker.length - 1)
fs.writeFileSync(OUT, patched)

let out = '', code = 0
try {
  out = execFileSync(process.execPath, [OUT], { encoding: 'utf8', timeout: 180000 })
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '')
  code = e.status === undefined ? -1 : e.status
}
fs.rmSync(OUT, { force: true })

console.log(out)
console.log('--- SELFTEST ASSERTIONS ---')

const expect = [
  ['NEG-1-wrong-line-anchor', 'DRIFT', 'a vanished anchor must be DRIFT'],
  ['NEG-2-line-number-drift', 'DRIFT', 'a moved line must be DRIFT, not silently re-resolved'],
  ['NEG-3-inverted-ordering', 'DRIFT', 'inverted order must be DRIFT'],
  ['NEG-4-forbidden-present', 'DRIFT', 'a forbidden substring must be DRIFT'],
  ['NEG-5-unreadable-must-be-UNKNOWN', 'UNKNOWN', 'unreadable must be UNKNOWN, never HOLD'],
]

// FIXED PARSER: split on the newline before the verdict, keep the bracket.
// Lines look like: "[DRIFT] NEG-1-wrong-line-anchor"
const verdicts = {}
for (const line of out.split('\n')) {
  const m = line.match(/^\[(HOLD|DRIFT|UNKNOWN)\]\s+(\S+)/)
  if (m) verdicts[m[2]] = m[1]
}

let failures = 0
for (const [id, want, why] of expect) {
  const got = verdicts[id] || '(none)'
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}: want ${want}, got ${got}  -- ${why}`)
}

const exitOk = code !== 0
if (!exitOk) failures++
console.log(`${exitOk ? 'PASS' : 'FAIL'}  process exit code = ${code} (must be nonzero)`)

if (/=== \d+ HOLD, 0 DRIFT, 0 UNKNOWN ===/.test(out)) {
  failures++
  console.log('FAIL  checker reported all-clean on poisoned input')
}

console.log(`\n${failures === 0 ? 'NEGATIVE CONTROL PASSED' : 'NEGATIVE CONTROL FAILED'} (${failures} failures)`)
process.exit(failures === 0 ? 0 : 1)
