// verify/publish-readback.selftest.cjs
//
// A checker that cannot fail produces green output that means nothing.
// This proves publish-readback.cjs fails on demand, using REAL process exit codes
// read via spawnSync -- not shell %ERRORLEVEL%, which cmd.exe expands at parse
// time and therefore reports wrongly.
//
// Three cases:
//   A positive  : remote file vs itself            -> expect exit 0, VERIFIED
//   B tampered  : same path, local has extra bytes -> expect exit 1, NOT VERIFIED
//   C missing   : path absent from tree at HEAD    -> expect exit 1, NOT VERIFIED
//
// Exit 0 only if all three behave as specified.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO = process.env.SELFTEST_REPO || '469536968-svg/eip681-kit'
const PATH = process.env.SELFTEST_PATH || 'rust/VERIFIED_3026_item6_chain_id_overflow.md'
const LOCAL = process.env.SELFTEST_LOCAL || PATH
const CHECKER = path.join(__dirname, 'publish-readback.cjs')

function run(args) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const cases = []

// A. positive control
{
  const r = run([REPO, PATH, LOCAL, 'main'])
  cases.push({
    name: 'A positive (remote vs itself)',
    expectCode: 0,
    expectText: 'VERIFIED IDENTICAL',
    got: r,
  })
}

// B. negative control: append bytes to a copy
{
  const tmp = path.join(os.tmpdir(), 'publish-readback-tampered.md')
  fs.writeFileSync(tmp, fs.readFileSync(LOCAL, 'utf8') + '\nTAMPERED-EXTRA-BYTES\n', 'utf8')
  const r = run([REPO, PATH, tmp, 'main'])
  cases.push({
    name: 'B tampered (local has extra bytes)',
    expectCode: 1,
    expectText: 'NOT VERIFIED',
    got: r,
  })
  try { fs.unlinkSync(tmp) } catch {}
}

// C. negative control: path that does not exist at HEAD
{
  const missing = PATH.replace(/[^/]+$/, 'definitely-not-in-tree-9f3a.md')
  const r = run([REPO, missing, LOCAL, 'main'])
  cases.push({
    name: 'C missing path at HEAD',
    expectCode: 1,
    expectText: 'NOT VERIFIED',
    got: r,
  })
}

let allOk = true
for (const c of cases) {
  const codeOk = c.got.code === c.expectCode
  const textOk = c.got.out.includes(c.expectText)
  const pass = codeOk && textOk
  if (!pass) allOk = false
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + c.name)
  console.log('        exit=' + c.got.code + ' (expected ' + c.expectCode + ')' +
              '  contains "' + c.expectText + '"=' + textOk)
  const verdict = (c.got.out.match(/VERDICT\s*:.*/) || [''])[0]
  if (verdict) console.log('        ' + verdict.trim())
}

console.log('')
console.log('checker falsifiable ....... ' + (cases[1].got.code === 1 && cases[2].got.code === 1))
console.log('checker passes positive ... ' + (cases[0].got.code === 0))
console.log('ALL CASES AS SPECIFIED .... ' + allOk)
process.exit(allOk ? 0 : 1)
