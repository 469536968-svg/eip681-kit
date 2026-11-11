// Verify the parseAmount uint256 bound, with negative controls.
//
// CORRECTION TO MY OWN FIRST ATTEMPT: I had listed 1e77 as a defect case. It is
// not. 2^256-1 ~= 1.1579e77, so 1e77 FITS in uint256 and must be accepted.
// My expectation was wrong, not the code. 1e78 is the first decimal exponent
// that overflows.
import { parse, parseAmount } from './eip681.mjs'

let fail = 0
const A = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const check = (cond, label, detail) => {
  if (!cond) fail++
  console.log('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''))
}

console.log('=== A. DEFECT CASES (must be rejected) ===')
// 1e78 is the first exponent whose 10^e exceeds 2^256-1.
for (const v of ['1e400', '1e78', '1e100', '0x' + 'f'.repeat(70), (2n ** 256n).toString()]) {
  const r = parse('ethereum:' + A + '?value=' + encodeURIComponent(v))
  check(r.ok === false, 'value=' + v.slice(0, 26), 'ok=' + r.ok + ' amount=' + r.amount)
}

console.log('\n=== B. LATENT HANG (must return fast, not compute 10^100000000) ===')
{
  const t0 = Date.now()
  const r = parseAmount('1e100000000')
  const ms = Date.now() - t0
  check(r.ok === false, '1e100000000 rejected', ms + 'ms')
  check(ms < 1000, 'returned without hanging', ms + 'ms')
}

console.log('\n=== C. NEGATIVE CONTROL: valid values must still be exact ===')
const GOOD = [
  ['0', 0n],
  ['1', 1n],
  ['1000', 1000n],
  ['1e18', 10n ** 18n],
  ['2.014e18', 2014n * 10n ** 15n],
  ['1.5e1', 15n],
  ['0x10', 16n],
  ['1e77', 10n ** 77n],                       // fits: below 2^256-1
  [(2n ** 256n - 1n).toString(), 2n ** 256n - 1n], // uint256 max must still fit
]
for (const [v, want] of GOOD) {
  const r = parseAmount(v)
  check(r.ok === true && r.value === want, 'parseAmount(' + v.slice(0, 26) + ')',
    'got=' + String(r.value).slice(0, 30) + ' want=' + String(want).slice(0, 30))
}

console.log('\n=== D. BOUNDARY: max accepted, max+1 rejected ===')
{
  const max = 2n ** 256n - 1n
  const a = parseAmount(max.toString())
  const b = parseAmount((max + 1n).toString())
  check(a.ok === true && a.value === max, 'uint256 max accepted', String(a.value).slice(0, 24))
  check(b.ok === false, 'uint256 max+1 rejected', 'ok=' + b.ok)
}

console.log('\n=== E. whole-URI negative control ===')
{
  const r = parse('ethereum:' + A + '@1?value=2.5e18')
  check(r.ok === true, 'valid URI still parses', 'ok=' + r.ok)
  check(r.amount === 2500000000000000000n, 'amount exact', String(r.amount))
  check(r.chainId === 1, 'chainId 1', String(r.chainId))
}

console.log('\n=== RESULT ===')
console.log('  failures: ' + fail)
process.exit(fail === 0 ? 0 : 1)
