const fs = require('node:fs');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) { console.log('NO_TOKEN'); process.exit(1); }
const OWNER = '469536968-svg', REPO = 'eip681-kit', BRANCH = 'main';
const REL = 'tools/size-display/display-resolution.mjs';

(async () => {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${REL}?ref=${BRANCH}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'qiming' } });
  if (r.status === 404) { console.log('REMOTE_MISSING'); return; }
  if (!r.ok) { console.log('ERR', r.status, (await r.text()).slice(0, 300)); return; }
  const j = await r.json();
  const remote = Buffer.from(j.content, 'base64').toString('utf8');
  const local = fs.readFileSync('C:/Users/HUAWEI/workspace/eip681-kit/' + REL, 'utf8');
  const norm = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  console.log('remote_sha_file:', j.sha);
  console.log('remote_bytes:', Buffer.byteLength(remote), 'local_bytes:', Buffer.byteLength(local));
  console.log('IDENTICAL:', norm(remote) === norm(local));
  if (norm(remote) !== norm(local)) {
    const hasFixRemotely = remote.includes('half a 0.1 MiB step');
    console.log('remote_already_has_fix:', hasFixRemotely);
  }
})();
