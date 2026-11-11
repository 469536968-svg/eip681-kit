// verify/publish-readback.cjs
//
// WHY THIS EXISTS
// ---------------
// I committed a file, it returned HTTP 200, and then I read it back with
// GET /repos/{o}/{r}/contents/{path} and got the PREVIOUS body -- 6216 bytes
// instead of 6643. I nearly reported a failed publish that had actually
// succeeded. The contents endpoint is CDN-backed; it is allowed to be stale.
//
// The blob endpoint is not. It is keyed by content address, so it either
// returns the exact bytes for that sha or it fails. That is the only read
// that constitutes verification of a write.
//
// RULE: reading the same endpoint twice is not verification.
//       Reading a different, content-addressed endpoint is.
//
// USAGE
//   node verify/publish-readback.cjs <owner/repo> <path/in/repo> <local-file> [branch]
//
// EXIT CODES
//   0 = remote bytes identical to local bytes (verified)
//   1 = mismatch or fetch failure (NOT verified -- do not claim success)
//   2 = bad arguments
//
// No dependencies. Node 18+ (global fetch).

const fs = require('fs')

const H = (token) => ({
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'publish-readback/1.0',
})

async function verify({ repo, path, localPath, branch, token }) {
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error('repo must be owner/name, got: ' + repo)

  const H1 = H(token)
  const api = (p) => `https://api.github.com/repos/${owner}/${name}${p}`

  // --- Step 1: resolve the current commit sha for the branch.
  // Without this, "blob at contents.sha" could be any revision.
  const br = await fetch(api(`/branches/${branch}`), { headers: H1 })
  if (br.status !== 200) {
    return { ok: false, reason: `branch fetch HTTP ${br.status}`, checked: [] }
  }
  const headSha = (await br.json()).commit.sha

  // --- Step 2: ask the TREE at that exact commit what blob this path points to.
  // This is the authoritative mapping path -> blob sha at HEAD.
  const tr = await fetch(api(`/git/trees/${headSha}?recursive=1`), { headers: H1 })
  if (tr.status !== 200) {
    return { ok: false, reason: `tree fetch HTTP ${tr.status}`, headSha }
  }
  const tree = await tr.json()
  const entry = (tree.tree || []).find((e) => e.path === path && e.type === 'blob')
  if (!entry) {
    return { ok: false, reason: `path not present in tree at HEAD: ${path}`, headSha }
  }

  // --- Step 3: fetch the blob BY SHA (content-addressed, cannot be stale).
  const blobRes = await fetch(api(`/git/blobs/${entry.sha}`), { headers: H1 })
  if (blobRes.status !== 200) {
    return { ok: false, reason: `blob fetch HTTP ${blobRes.status}`, headSha, blobSha: entry.sha }
  }
  const blob = await blobRes.json()
  const remote = Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8')
  const local = fs.readFileSync(localPath)

  // --- Step 4: also read contents API, purely to DEMONSTRATE whether it disagrees.
  // This is diagnostic only. It is never the basis of a pass/fail decision.
  let contentsBytes = null
  let disagree = null
  const cr = await fetch(api(`/contents/${path}?ref=${headSha}`), { headers: H1 })
  if (cr.status === 200) {
    const cj = await cr.json()
    const cbuf = Buffer.from(cj.content, 'base64')
    contentsBytes = cbuf.length
    disagree = Buffer.compare(cbuf, remote) !== 0
  }

  const ok = Buffer.compare(remote, local) === 0
  return {
    ok,
    headSha,
    blobSha: entry.sha,
    remoteBytes: remote.length,
    localBytes: local.length,
    contentsBytes,
    contentsDisagreesWithBlob: disagree,
    reason: ok ? 'identical' : `byte mismatch: remote ${remote.length} vs local ${local.length}`,
  }
}

async function main() {
  const [repo, path, localPath, branch = 'main'] = process.argv.slice(2)
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!repo || !path || !localPath) {
    console.error('usage: node verify/publish-readback.cjs <owner/repo> <path> <local-file> [branch]')
    process.exit(2)
  }
  if (!token) { console.error('no GITHUB_TOKEN / GH_TOKEN'); process.exit(2) }

  const r = await verify({ repo, path, localPath, branch, token })
  console.log('repo        : ' + repo)
  console.log('path        : ' + path)
  console.log('branch      : ' + branch)
  console.log('HEAD commit : ' + (r.headSha ? r.headSha.slice(0, 10) : 'n/a'))
  console.log('blob sha    : ' + (r.blobSha ? r.blobSha.slice(0, 10) : 'n/a') + '   (content-addressed)')
  console.log('blob bytes  : ' + (r.remoteBytes !== undefined ? r.remoteBytes : 'n/a'))
  console.log('local bytes : ' + (r.localBytes !== undefined ? r.localBytes : 'n/a'))
  if (r.contentsBytes !== null && r.contentsBytes !== undefined) {
    console.log('contents API: ' + r.contentsBytes + ' bytes   disagrees_with_blob=' + r.contentsDisagreesWithBlob)
    if (r.contentsDisagreesWithBlob) {
      console.log('  ^ the stale-read trap. This is why the verdict comes from the blob.')
    }
  }
  console.log('VERDICT     : ' + (r.ok ? 'VERIFIED IDENTICAL' : 'NOT VERIFIED -- ' + r.reason))
  process.exit(r.ok ? 0 : 1)
}

module.exports = { verify }

if (require.main === module) {
  main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1) })
}
