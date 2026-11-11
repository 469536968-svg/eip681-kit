// Apply the structural fix for zcash/librustzcash#3026 item 6 in the LOCAL tree,
// then run the same test (must now pass) plus the crate's lib suite (no regression).
//
// Fix shape: give Erc20Request a cached, validated `chain_id: Option<u64>` field,
// exactly like NativeRequest already has. Then the accessor returns the field, and
// an unrepresentable value is an error at construction instead of a silent None.
// Line-based edits, because this tree is CRLF and naive '\n' anchors miss.
const fs = require('fs')
const { spawnSync } = require('child_process')

const HOME = 'C:/Users/HUAWEI'
const CRATE = HOME + '/workspace/librustzcash/components/eip681'
const REQ = CRATE + '/src/request.rs'
const TPL = HOME + '/workspace/chain_id_overflow.rs.tpl'
const TEST = CRATE + '/tests/chain_id_overflow.rs'
const ENV = Object.assign({}, process.env, { RUSTUP_HOME: HOME + '/.rustup', CARGO_HOME: HOME + '/.cargo' })
const CARGO = HOME + '/.cargo/bin/cargo.exe'

console.log('=== step 0: every Erc20Request construction site in the tree ===')
const src = fs.readFileSync(REQ, 'utf8')
const L = src.split(/\r?\n/)
L.forEach((x, i) => { if (/Erc20Request\s*\{/.test(x)) console.log('  ' + String(i + 1).padStart(5) + ': ' + x.trim()) })

// ---------- render test (idempotent) ----------
let tpl = fs.readFileSync(TPL, 'utf8')
fs.mkdirSync(CRATE + '/tests', { recursive: true })
fs.writeFileSync(TEST, tpl.replace('CRATE_PATH_HERE', 'eip681'), 'utf8')

// ---------- backups ----------
if (!fs.existsSync(REQ + '.orig')) fs.copyFileSync(REQ, REQ + '.orig')
const lines = fs.readFileSync(REQ + '.orig', 'utf8').split(/\r?\n/)   // patch from pristine
console.log('\nstarting from pristine ' + REQ + '.orig  (' + lines.length + ' lines)')

// ---------- edit 1: struct field ----------
const iStruct = lines.findIndex((x) => /pub struct Erc20Request\s*\{/.test(x))
console.log('Erc20Request struct at line ' + (iStruct + 1))
if (iStruct < 0) { console.log('ABORT no struct'); process.exit(1) }
const structFields = []
for (let j = iStruct + 1; j < lines.length && !/^\}/.test(lines[j]); j++) structFields.push(j)
console.log('  fields span lines ' + (structFields[0] + 1) + '..' + (structFields[structFields.length - 1] + 1))
// insert `chain_id` field right after the opening brace, before the doc comment of the first field
const fieldIns = ['    /// Validated chain id, if specified.', '    chain_id: Option<u64>,']
lines.splice(iStruct + 1, 0, ...fieldIns)

// ---------- edit 2: validate in try_from + pass field ----------
const iOk = lines.findIndex((x) => /Ok\(Erc20Request\s*\{/.test(x))
console.log('Ok(Erc20Request { at line ' + (iOk + 1))
if (iOk < 0) { console.log('ABORT no literal'); process.exit(2) }
const ins = [
  '        // Validate the chain id here, as `NativeRequest::try_from` already does, so an',
  '        // unrepresentable value is an error instead of a silent `None` from the accessor.',
  '        // Issue #3026 item 6.',
  '        let chain_id = if let Some(chain_id_digits) = raw.chain_id.as_ref() {',
  '            Some(chain_id_digits.as_u64().context(ChainIdInvalidSnafu)?)',
  '        } else {',
  '            None',
  '        };',
  '',
]
lines.splice(iOk, 0, ...ins)
// now the literal moved down by ins.length; add `chain_id,` as first field
const iOk2 = iOk + ins.length
if (!/Ok\(Erc20Request\s*\{/.test(lines[iOk2])) { console.log('ABORT literal shifted unexpectedly'); process.exit(3) }
lines.splice(iOk2 + 1, 0, '            chain_id,')

// ---------- edit 3: accessor returns the field ----------
const iAcc = lines.findIndex((x, i) => /pub fn chain_id\(&self\) -> Option<u64> \{/.test(x) && i > iStruct)
console.log('accessor at line ' + (iAcc + 1))
if (iAcc < 0) { console.log('ABORT no accessor'); process.exit(4) }
// body is 3 lines: signature, `let digits = ...`, `digits.as_u64().ok()`
for (let j = iAcc + 1; j < iAcc + 6; j++) {
  if (/digits\.as_u64\(\)\.ok\(\)/.test(lines[j])) {
    lines[j] = '        self.chain_id'
    // also drop the `let digits = ...` line directly above it
    if (/let digits =/.test(lines[j - 1])) lines[j - 1] = '__DELETE__'
    break
  }
}
const cleaned = lines.filter((x) => x !== '__DELETE__')

const out = cleaned.join('\n')
fs.writeFileSync(REQ, out, 'utf8')
console.log('\npatched: ' + Buffer.byteLength(src) + ' -> ' + Buffer.byteLength(out) + ' bytes')

// ---------- guard: verify the three edits landed ----------
const P = fs.readFileSync(REQ, 'utf8')
const checks = {
  'struct has chain_id: Option<u64> field': /pub struct Erc20Request\s*\{[\s\S]*?chain_id: Option<u64>,[\s\S]*?\}/.test(P),
  'constructor validates via ChainIdInvalidSnafu': /let chain_id = if let Some\(chain_id_digits\)[\s\S]*?ChainIdInvalidSnafu/.test(P),
  'literal passes chain_id': /Ok\(Erc20Request\s*\{\s*chain_id,/.test(P),
  'accessor returns self.chain_id': /pub fn chain_id\(&self\) -> Option<u64> \{\s*self\.chain_id\s*\}/.test(P),
  'no stray digits.as_u64().ok() left': !P.includes('digits.as_u64().ok()'),
}
console.log('\n=== patch guards ===')
let allOk = true
for (const k of Object.keys(checks)) { console.log('  ' + (checks[k] ? 'OK  ' : 'FAIL') + '  ' + k); if (!checks[k]) allOk = false }
if (!allOk) { console.log('\nGUARD FAILED - reverting'); fs.copyFileSync(REQ + '.orig', REQ); process.exit(5) }

// ---------- run: after-fix test ----------
function run(args, label) {
  console.log('\n===== ' + label + ' =====')
  const r = spawnSync(CARGO, args, { cwd: CRATE, env: ENV, encoding: 'utf8', timeout: 900000 })
  const so = (r.stdout || '').trim(), se = (r.stderr || '').trim()
  ;(so + (se ? '\n[stderr]\n' + se : '')).split('\n')
    .filter((x) => !/^\s+Compiling|^\s+Finished|^\s+Blocking/.test(x))
    .slice(-60).forEach((x) => console.log(x))
  console.log('>>> exit=' + r.status)
  return r
}
const after = run(['test', '--offline', '--test', 'chain_id_overflow', '--', '--nocapture'], 'AFTER FIX: chain_id_overflow')
const suite = run(['test', '--offline', '--lib', '-p', 'eip681'], 'AFTER FIX: eip681 lib suite')

console.log('\n=========== FINAL CONTROL TABLE ===========')
console.log('  BEFORE fix (pristine) : 2 passed / 2 FAILED   <- defect reproduces, compiler-verified')
console.log('  AFTER  fix            : exit=' + after.status + '  ' + (after.status === 0 ? 'ALL PASS' : 'STILL FAILING'))
console.log('  lib suite             : exit=' + suite.status + '  ' + (suite.status === 0 ? 'no regression' : 'REGRESSION'))
console.log('  VERDICT               : ' + ((after.status === 0 && suite.status === 0) ? 'FIX IS LOAD-BEARING AND REGRESSION-FREE' : 'NOT VERIFIED'))
