#!/usr/bin/env node
// check-rejection-safety.mjs — the invariant, testable against ANY EIP-681 parser.
//
//   node conformance/check-rejection-safety.mjs                 # audit this package
//   node conformance/check-rejection-safety.mjs ./my-adapter.mjs
//
// An adapter exports: parse(uri) -> { ok:boolean, target, recipient, functionName,
// params, amount, chainId, isTokenTransfer, errors }
//
// The point of publishing this as a *check* rather than a claim is that a checker
// can be wrong in the permissive direction and still look green. So this file also
// runs a NEGATIVE CONTROL: an adapter with the leak deliberately restored. If the
// checker reports zero findings on the leaky adapter, the checker itself failed.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse as kitParse } from '../eip681.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEC = JSON.parse(readFileSync(resolve(HERE, 'rejection-safety.json'), 'utf8'))

// Fields a consumer might branch on. If any is truthy on a rejection, the parse
// leaked something a caller could act on.
const DECISION_FIELDS = ['target', 'recipient', 'functionName', 'amount', 'chainId', 'isTokenTransfer']

function paramsPopulated(p) {
  return p && typeof p === 'object' && Object.keys(p).length > 0
}

function leaksOf(result) {
  const out = []
  for (const f of DECISION_FIELDS) {
    const v = result[f]
    // isTokenTransfer=false is the safe default; only true counts as a leak.
    if (f === 'isTokenTransfer') { if (v === true) out.push(f); continue }
    if (v !== null && v !== undefined && v !== '') out.push(f)
  }
  if (paramsPopulated(result.params)) out.push('params')
  return out
}

function audit(adapter, label) {
  const findings = []
  const controlFailures = []

  for (const c of SPEC.cases) {
    let r
    try { r = adapter(c.uri) } catch (e) {
      findings.push({ id: c.id, kind: 'threw', detail: String(e && e.message || e) })
      continue
    }
    if (!r || typeof r !== 'object') { findings.push({ id: c.id, kind: 'no-result' }); continue }
    if (r.ok !== false && c.mustReject) {
      findings.push({ id: c.id, kind: 'accepted-invalid', detail: 'ok=' + r.ok })
      continue
    }
    const leaks = leaksOf(r)
    if (leaks.length) findings.push({ id: c.id, kind: 'leaked-on-rejection', fields: leaks })
  }

  for (const c of SPEC.controlCases) {
    let r
    try { r = adapter(c.uri) } catch (e) {
      controlFailures.push({ id: c.id, kind: 'threw', detail: String(e && e.message || e) })
      continue
    }
    if (!r || r.ok !== true) {
      controlFailures.push({ id: c.id, kind: 'rejected-valid', detail: r && r.errors && JSON.stringify(r.errors) })
    }
  }

  const total = SPEC.cases.length
  console.log(`\n[${label}]`)
  console.log(`  rejection cases : ${total - findings.length}/${total} clean`)
  console.log(`  control cases   : ${SPEC.controlCases.length - controlFailures.length}/${SPEC.controlCases.length} accepted`)
  for (const f of findings) {
    console.log(`  LEAK ${f.id}: ${f.kind}` + (f.fields ? ' fields=' + f.fields.join(',') : '') + (f.detail ? ' (' + f.detail + ')' : ''))
  }
  for (const f of controlFailures) {
    console.log(`  CONTROL-FAIL ${f.id}: ${f.kind}` + (f.detail ? ' ' + f.detail : ''))
  }
  return { findings, controlFailures }
}

// ---------------------------------------------------------------- negative control
// The exact pre-fix behaviour of this package: clear `amount` only, leave the rest.
// If this does not produce findings, the checker is not measuring anything.
function leakyAdapter(uri) {
  const r = kitParse(uri)
  if (r.rejected && !r.ok) {
    return { ...r, ...r.rejected, ok: false, amount: null }
  }
  return r
}

async function main() {
  const target = process.argv[2]
  let adapter = kitParse
  let label = 'eip681-kit (this package)'
  if (target) {
    const mod = await import(new URL(target, 'file://' + process.cwd() + '/').href)
    adapter = mod.parse || (mod.default && mod.default.parse)
    if (typeof adapter !== 'function') {
      console.error('adapter does not export parse(uri)')
      process.exit(2)
    }
    label = target
  }

  const subject = audit(adapter, label)
  const control = audit(leakyAdapter, 'NEGATIVE CONTROL (leak deliberately restored)')

  console.log('\n=== VERDICT ===')
  const subjectClean = subject.findings.length === 0 && subject.controlFailures.length === 0
  const controlDetects = control.findings.length > 0

  console.log(`  subject clean ............ ${subjectClean}`)
  console.log(`  checker detects the leak . ${controlDetects} (${control.findings.length} findings)`)

  if (!controlDetects) {
    console.log('\n  CHECKER FAILURE: the negative control passed, so a green result')
    console.log('  here means nothing. Do not report success from this run.')
    process.exit(1)
  }
  if (!subjectClean) {
    console.log('\n  SUBJECT FAILS the rejection-safety invariant.')
    process.exit(1)
  }
  console.log('\n  PASS: rejected parses expose no decision-bearing field, and the')
  console.log('  checker is proven able to fail.')
}

main()
