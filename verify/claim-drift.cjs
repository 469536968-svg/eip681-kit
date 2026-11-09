#!/usr/bin/env node
/**
 * claim-drift.cjs — re-verify published claims against current upstream source.
 *
 * WHY: on 2026-11-09 I published a claim about vultisig-sdk's approve arm that the
 * source falsified. The failure mode wasn't "I didn't check" — it was "I checked
 * something, published, and nothing ever re-checked it." A claim is a fact with a
 * timestamp, and facts rot. This tool makes rotting loud.
 *
 * DESIGN RULES (each one exists because of a specific mistake I made):
 *  1. NEVER report PASS when a file could not be fetched. Unreachable => UNKNOWN,
 *     and UNKNOWN counts as a failure of the run. A checker that cannot see the
 *     input must never report success. (This is the exact bug that made my first
 *     eth-url-parser differential report 49/49 "agree" while comparing nothing.)
 *  2. Line anchors are verified by CONTENT, not by trusting the line number. If the
 *     line moved, that is DRIFT and must be reported, not silently re-resolved.
 *  3. Every claim carries WHERE it was published. A drift hit must tell me which URL
 *     now contains a false statement, because that is the thing needing correction.
 *  4. Read-only. No token-mutating calls, no POST. Safe to run on a heartbeat.
 *
 * Exit code: 0 = all HOLD, 1 = any DRIFT, 2 = any UNKNOWN (also nonzero: unknown
 * is not safe, see rule 1).
 */
'use strict'
const https = require('https')

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const RAW = 'https://raw.githubusercontent.com'

// ---------------------------------------------------------------------------
// CLAIMS. Each is something I have published publicly. Verified against the
// exact repo/path/branch, with the published artifact that depends on it.
// ---------------------------------------------------------------------------
const CLAIMS = [
  {
    id: 'vultisig-approve-early-return',
    publishedAt: 'https://github.com/vultisig/vultisig-sdk/issues/2495#issuecomment-6747391483',
    repo: 'vultisig/vultisig-sdk', branch: 'main',
    path: 'packages/core/mpc/keysign/signingInputs/resolvers/evm/index.ts',
    // "the approve branch returns at :77, before getToAddress() is defined at :131"
    anchors: [
      { line: 77, mustContain: 'return [...approveSigningInputs', why: 'approve early-return' },
      { line: 131, mustContain: 'const getToAddress', why: 'helper defined after the return' },
    ],
    ordering: [
      { before: 'return [...approveSigningInputs', after: 'const getToAddress',
        why: 'early return must precede the helper definition, else the claim inverts' },
    ],
    mustContain: ['if (erc20ApprovePayload) {'],
  },
  {
    id: 'vultisig-approve-destination-is-token-contract',
    publishedAt: 'https://github.com/vultisig/vultisig-sdk/issues/2495#issuecomment-6747391483',
    repo: 'vultisig/vultisig-sdk', branch: 'main',
    path: 'packages/core/mpc/keysign/signingInputs/resolvers/evm/erc20.ts',
    anchors: [
      { line: 43, mustContain: 'toAddress: shouldBePresent(keysignPayload.coin).contractAddress',
        why: 'approve destination is the token contract, built outside getToAddress()' },
      { line: 35, mustContain: 'spender,', why: 'approved party travels in spender, not toAddress' },
    ],
    mustContain: ['erc20Approve'],
  },
  {
    id: 'purelua-no-keccak256',
    publishedAt: 'https://github.com/Egor-Skriptunoff/pure_lua_SHA/issues/11#issuecomment-5859759231',
    repo: 'Egor-Skriptunoff/pure_lua_SHA', branch: 'master',
    path: 'sha2.lua',
    // My retraction asserted: the module provides NO keccak256 under any name.
    // If that ever becomes false, the retraction itself is wrong and must be reopened.
    mustContain: ['sha3_256'],
    mustNotContain: ['keccak256', 'keccak_256'],
  },
]

// ---------------------------------------------------------------------------
const fetchRaw = (repo, branch, path) => new Promise((resolve) => {
  const url = `${RAW}/${repo}/${branch}/${path}`
  const r = https.request(url, { method: 'GET', headers: { 'User-Agent': 'qiming-drift/1.0' } }, (res) => {
    let b = ''
    res.on('data', (c) => (b += c))
    res.on('end', () => resolve({ status: res.statusCode, body: b, url }))
  })
  r.on('error', (e) => resolve({ status: 0, body: '', err: String(e && e.message), url }))
  r.setTimeout(25000, () => { r.destroy(); resolve({ status: 0, body: '', err: 'timeout', url }) })
  r.end()
})

const lineOf = (text, needle) => {
  const ls = text.split('\n')
  for (let i = 0; i < ls.length; i++) if (ls[i].includes(needle)) return i + 1
  return -1
}

;(async () => {
  const results = []

  for (const c of CLAIMS) {
    const r = await fetchRaw(c.repo, c.branch, c.path)

    // RULE 1: unreadable is UNKNOWN, never PASS.
    if (r.status !== 200) {
      results.push({ id: c.id, verdict: 'UNKNOWN',
        detail: `fetch ${r.status || r.err || 'no status'} for ${r.url}`, publishedAt: c.publishedAt })
      continue
    }

    const body = r.body
    const problems = []
    const notes = []

    for (const a of c.anchors || []) {
      const actual = lineOf(body, a.mustContain)
      if (actual === -1) {
        problems.push(`anchor text vanished: "${a.mustContain.slice(0, 60)}" (${a.why})`)
      } else if (actual !== a.line) {
        // RULE 2: moved line = drift in what I published, report it.
        problems.push(`line drifted ${a.line} -> ${actual} for "${a.mustContain.slice(0, 50)}" (${a.why})`)
      } else {
        notes.push(`:${a.line} ok (${a.why})`)
      }
    }

    for (const mc of c.mustContain || []) {
      if (!body.includes(mc)) problems.push(`required substring absent: "${mc.slice(0, 60)}"`)
    }
    for (const mnc of c.mustNotContain || []) {
      const at = lineOf(body, mnc)
      if (at !== -1) problems.push(`FORBIDDEN substring present at line ${at}: "${mnc}"`)
    }

    for (const o of c.ordering || []) {
      const a = lineOf(body, o.before)
      const b = lineOf(body, o.after)
      if (a === -1 || b === -1) problems.push(`ordering check unreadable (${o.why})`)
      else if (a > b) problems.push(`ORDER INVERTED: "${o.before.slice(0, 40)}" now AFTER "${o.after.slice(0, 40)}" (${o.why})`)
      else notes.push(`order ok ${a} < ${b} (${o.why})`)
    }

    results.push({
      id: c.id, verdict: problems.length ? 'DRIFT' : 'HOLD',
      detail: problems.length ? problems.join(' | ') : notes.join('; '),
      publishedAt: c.publishedAt, url: r.url,
    })
  }

  console.log('=== CLAIM DRIFT REPORT ' + new Date().toISOString() + ' ===')
  for (const r of results) {
    console.log(`\n[${r.verdict}] ${r.id}`)
    console.log('  ' + r.detail)
    console.log('  published in: ' + r.publishedAt)
  }

  const drift = results.filter((r) => r.verdict === 'DRIFT')
  const unknown = results.filter((r) => r.verdict === 'UNKNOWN')
  const hold = results.filter((r) => r.verdict === 'HOLD')
  console.log(`\n=== ${hold.length} HOLD, ${drift.length} DRIFT, ${unknown.length} UNKNOWN ===`)
  if (drift.length) console.log('ACTION REQUIRED: a URL above now contains a statement the source no longer supports.')
  if (unknown.length) console.log('NOTE: UNKNOWN is a failure, not a pass (rule 1). Re-run when reachable.')
  process.exit(drift.length ? 1 : unknown.length ? 2 : 0)
})()
