// conformance/stranger-install.mjs
//
// WHAT THIS IS
// ------------
// A consumer's test, not the author's. It consumes ONLY an installed copy of the
// package (from a packed tarball), through the package's own declared entry point,
// and asserts the documented contract. If this fails, the package is not shippable
// no matter how many of the author's own tests pass.
//
// WHY IT EXISTS
// -------------
// I had shipped 13 artifacts and never once verified that the package INSTALLS and
// WORKS for someone who is not me. Running code in a git tree is not distribution.
//
// What it found on first real runs, in order:
//   1. 4 failures caused by a STALE TARBALL -- an earlier `npm pack` expanded an
//      empty shell variable and produced nothing, so the "fresh" install was
//      actually a prior artifact. Fix: purge tarballs, repack, assert file list.
//   2. 3 failures that were MY TEST's bugs, not the package's:
//        - `rejected` is an OBJECT mirror, not an array (asserted Array.isArray).
//        - nativeTransfer takes {to, wei, chainId} -- the field is `wei`, not
//          valueWei/value/amount; the URI comes back as `.uri`.
//   3. 1 failure that was again my test: ParseResult declares `amount: bigint|null`.
//      There is NO top-level `value` field. A test that asserts one is wrong.
//
// Every one of those was found by running the thing, not by reading it. That is the
// whole point of this file, so the comments below name the declared contract.
//
// USAGE (from a directory containing the .tgz)
//   npm install ./eip681-kit-<version>.tgz
//   node conformance/stranger-install.mjs ./node_modules/eip681-kit
//
// EXIT 0 = contract honoured. EXIT 1 = ship-blocking defect.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] || './node_modules/eip681-kit')
let pass = 0
let fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')) }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
console.log('package: ' + pkg.name + '@' + pkg.version + '  main=' + pkg.main + '  types=' + (pkg.types || 'none'))

// 0. The ESM entry point must import. If this throws, nobody can use the package.
const kit = await import('file://' + ROOT.replace(/\\/g, '/') + '/' + pkg.main)
check('ESM entry imports cleanly', true)
check('parse() exported', typeof kit.parse === 'function')
check('nativeTransfer() exported', typeof kit.nativeTransfer === 'function')

const TO = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

// 1. Documented happy path.
const p1 = kit.parse('ethereum:' + TO + '@1?value=1e18')
check('native URI parses ok', p1.ok === true, 'ok=' + p1.ok)
check('chainId === 1', Number(p1.chainId) === 1, 'chainId=' + p1.chainId)
check('target preserved', p1.target === TO, 'target=' + p1.target)

// 2. Failure is structured, never thrown.
let threw = null
let p2 = null
try { p2 = kit.parse('ethereum:0xZZZ@1') } catch (e) { threw = e }
check('invalid input does NOT throw', threw === null, threw ? 'threw: ' + threw.message : 'clean')
check('invalid input -> ok:false', p2.ok === false)
check('rejected is an object mirror', p2.rejected !== null && typeof p2.rejected === 'object')
check('rejected.target is null for a bad address', p2.rejected.target === null, 'rejected.target=' + JSON.stringify(p2.rejected.target))
check('errors[] carries a code', Array.isArray(p2.errors) && p2.errors.length > 0 && typeof p2.errors[0].code === 'string',
      p2.errors && p2.errors[0] ? 'code=' + p2.errors[0].code : 'no errors')
check('top-level target is null on failure', p2.target === null, 'target=' + JSON.stringify(p2.target))

// 2b. The trap the README warns about: a wrong key must reject with that field named,
// and the offending value must be quarantined in `rejected`, never actioned at top level.
const pAmt = kit.parse('ethereum:' + TO + '@1?value=abc')
check('bad amount -> ok:false', pAmt.ok === false)
check('bad amount names the code', pAmt.errors[0] && pAmt.errors[0].code === 'amount-invalid', 'code=' + (pAmt.errors[0] || {}).code)
check('bad amount keeps target in mirror', pAmt.rejected && pAmt.rejected.target === TO, 'rejected.target=' + (pAmt.rejected || {}).target)
check('bad amount leaves top-level amount null', pAmt.amount === null, 'amount=' + JSON.stringify(pAmt.amount))

// 3. Generator uses the documented field name `wei` and returns `.uri`.
const g = kit.nativeTransfer({ to: TO, wei: '1000000000000000000', chainId: 1 })
check('nativeTransfer({to,wei,chainId}) ok', g.ok === true, g.errors && g.errors[0] ? 'error=' + g.errors[0].code : '')
check('returns .uri string', typeof g.uri === 'string' && g.uri.startsWith('ethereum:'), g.uri ? g.uri.slice(0, 70) : 'none')

if (typeof g.uri === 'string') {
  const back = kit.parse(g.uri)
  // DECLARED CONTRACT (index.d.ts): ParseResult.amount is `bigint | null`.
  // There is NO top-level `value` field. Asserting one is a test bug, not a
  // package bug -- that mistake is exactly why this check reads `amount`.
  check('round-trip preserves wei', back.ok === true && back.amount === 1000000000000000000n,
        'amount=' + String(back.amount) + ' type=' + typeof back.amount)
  check('amount is a bigint, per index.d.ts', typeof back.amount === 'bigint', 'type=' + typeof back.amount)
  check('canonical re-renders', typeof back.canonical === 'string' && back.canonical.startsWith('ethereum:'),
        back.canonical ? back.canonical.slice(0, 70) : 'none')
}

// 3b. Wrong amount key must fail loudly with the field named -- never silently
// emit a zero-value transfer, which is the failure mode that loses money.
const gBad = kit.nativeTransfer({ to: TO, valueWei: '1000000000000000000', chainId: 1 })
check('wrong amount key is rejected, not coerced', gBad.ok === false && gBad.errors[0].code === 'wei', 'code=' + (gBad.errors[0] || {}).code)

// 3c. null config must return a diagnosable rejection, not throw (a regression I fixed earlier).
let nulThrew = null
try { kit.nativeTransfer(null) } catch (e) { nulThrew = e }
check('nativeTransfer(null) returns, does not throw', nulThrew === null, nulThrew ? 'threw: ' + nulThrew.message : 'clean')

// 4. Types ship and describe the fields this test just exercised.
const typesPath = path.join(ROOT, pkg.types || 'index.d.ts')
const typesExist = fs.existsSync(typesPath)
check('index.d.ts shipped', typesExist, typesExist ? fs.statSync(typesPath).size + ' B' : 'missing')
if (typesExist) {
  const d = fs.readFileSync(typesPath, 'utf8')
  check('d.ts declares rejected', /rejected\s*:/.test(d))
  check('d.ts declares nativeTransfer', /nativeTransfer/.test(d))
  check('d.ts declares wei on the request', /\bwei\b/.test(d))
  check('d.ts declares amount on ParseResult', /amount\s*:\s*bigint\s*\|\s*null/.test(d))
}

// 5. The conformance harness must travel with the package, or consumers cannot self-check.
const ck = path.join(ROOT, 'conformance', 'check-rejection-safety.mjs')
check('rejection-safety checker shipped', fs.existsSync(ck), fs.existsSync(ck) ? fs.statSync(ck).size + ' B' : 'missing')

console.log('')
console.log('  pass=' + pass + '  fail=' + fail)
console.log('  VERDICT: ' + (fail === 0 ? 'INSTALLABLE AND CONTRACT-CORRECT' : 'NOT SHIPPABLE'))
process.exit(fail === 0 ? 0 : 1)
