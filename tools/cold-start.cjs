'use strict';
/**
 * tools/cold-start.cjs -- download the repo the way a stranger does (GitHub
 * tarball of main: no git, no npm install, no working tree), then verify what
 * that stranger can actually run.
 *
 * WHY THIS EXISTS
 * ---------------
 * Traffic 2026-11-15: clones(14d)=378, uniques=136, but stars=0, forks=0,
 * issues=0. Either nobody engaged after cloning, or the first thing they tried
 * did not work. Every check I ran before this used MY working tree, which holds
 * files the tarball does not. This is the only instrument that sees what a
 * stranger sees.
 *
 * THE CLASSIFIER IS THE POINT, NOT THE DOWNLOADER
 * ----------------------------------------------
 * Four earlier versions of this file each produced a number that measured my
 * criterion instead of the repo:
 *   v1  "0/9 README examples clean" -- six of those exited 0; they were fragments
 *       and I required non-empty stdout.
 *   v2  "derive.mjs MISSING"        -- a filename I guessed.
 *   v3  "exports 1/1"               -- my "improved" walker skipped condition
 *       keys, so it skipped every real target.
 *   v4  "package.json import FAIL"  -- dynamic import() takes attributes as a
 *       second argument; `with {..}` after the specifier is static-only syntax.
 * So the classifier distinguishes, by rule, and the walker descends INTO
 * conditions while skipping only `types`:
 *   PASS          exit 0
 *   SKIP          ReferenceError on a name the fence never declares -> fragment
 *   ILLUSTRATIVE  imports a relative path neither shipped nor claimed in prose
 *   FAIL          a missing module the prose DOES claim, or any uncaught error.
 *
 * Usage:  node tools/cold-start.cjs [--keep] [--json]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OWNER = '469536968-svg';
const REPO = 'eip681-kit';
const BRANCH = 'main';
const NODE = process.execPath;
const KEEP = process.argv.includes('--keep');
const AS_JSON = process.argv.includes('--json');

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'eip681-cold-'));
const report = { exports: [], imports: [], examples: [] };

function untar(buf, dest) {
  const tgz = path.join(WORK, 'src.tar.gz');
  fs.writeFileSync(tgz, buf);
  for (const bin of ['C:/Windows/System32/tar.exe', 'tar']) {
    const r = spawnSync(bin, ['-xzf', tgz, '-C', dest], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return true;
    if (r.error && r.error.code === 'ENOENT') continue;
    return false;
  }
  return false;
}

const fences = (md) => {
  const out = [];
  const re = /```(?:js|javascript|mjs)\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) out.push(m[1]);
  return out;
};

/**
 * Flatten an exports map to { subpath: runtime target }.
 * import/default/require/node are CONDITIONS: descend into them, keep the
 * subpath. `types` carries no runtime target and is skipped.
 */
function exportTargets(exportsField) {
  const out = {};
  const SKIP = new Set(['types']);
  const walk = (sub, val) => {
    if (typeof val === 'string') { out[sub] = val; return; }
    if (val && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) {
        if (SKIP.has(k)) continue;
        if (k.startsWith('.')) walk(k === '.' ? '.' : k, v);
        else walk(sub, v); // condition object: subpath unchanged
      }
    }
  };
  walk('.', exportsField);
  return out;
}

/** Prose = markdown with fences stripped: used only to ask "does the README ever
 *  claim this file exists", outside of an example. */
const proseOnly = (md) => md.replace(/```[\s\S]*?```/g, '\n');

function classify({ status, stderr, code, prose }) {
  if (status === 0) return { verdict: 'PASS', reason: '' };
  const err = stderr || '';

  const ref = err.match(/([A-Za-z_$][\w$]*) is not defined/);
  if (ref) {
    const name = ref[1];
    const declared = new RegExp(`(?:const|let|var|function|class)\\s+${name}\\b`).test(code);
    if (!declared) return { verdict: 'SKIP', reason: `fragment: uses undeclared \`${name}\`` };
  }

  const miss = err.match(/Cannot find (?:module|package) '([^']+)'/)
    || err.match(/'([^']+)' imported from/);
  if (miss) {
    const spec = miss[1];
    const looksRelative = spec.startsWith('.') || spec.includes(os.tmpdir()) || spec.includes('\\') || spec.includes('/');
    if (looksRelative) {
      const base = path.basename(spec);
      const claimed = base && new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(prose);
      return claimed
        ? { verdict: 'FAIL', reason: `prose promises '${base}' but the repo does not ship it` }
        : { verdict: 'ILLUSTRATIVE', reason: `placeholder import '${base}' (never claimed in prose)` };
    }
    return { verdict: 'FAIL', reason: `imports '${spec}' which the repo does not provide` };
  }

  return { verdict: 'FAIL', reason: (err.split('\n').filter(Boolean).pop() || `exit ${status}`).slice(0, 200) };
}

/** Build the probe source for one subpath.
 *  JSON modules need an import attribute, and for DYNAMIC import the attribute
 *  is an options object in the SECOND argument -- not `with {..}` after the
 *  specifier, which is static-import syntax only. */
function probeSource(spec, isJson) {
  return isJson
    ? `const m = await import('${spec}', { with: { type: 'json' } });\nconst v = m.default ?? m;\nconsole.log('json ok: ' + Object.keys(v).sort().join(','));\n`
    : `const m = await import('${spec}');\nconsole.log(Object.keys(m).sort().join(','));\n`;
}

(async () => {
  const url = `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/heads/${BRANCH}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'qiming-coldstart/5.0' } });
  if (!res.ok) { console.log(`download -> HTTP ${res.status}`); process.exitCode = 1; return; }
  const buf = Buffer.from(await res.arrayBuffer());

  const dest = path.join(WORK, 'x');
  fs.mkdirSync(dest, { recursive: true });
  if (!untar(buf, dest)) { console.log('extract failed'); process.exitCode = 1; return; }

  const root = fs.readdirSync(dest).map((n) => path.join(dest, n)).find((p) => fs.statSync(p).isDirectory());
  const entries = fs.readdirSync(root).sort();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  if (!AS_JSON) {
    console.log(`cold start ${new Date().toISOString()}`);
    console.log(`tarball ${buf.length}B, ${entries.length} top-level entries, version ${pkg.version}`);
  }

  // 1. every declared export target must exist in the tarball
  const targets = exportTargets(pkg.exports || {});
  let badExports = 0;
  for (const [sub, rel] of Object.entries(targets)) {
    const exists = fs.existsSync(path.join(root, rel.replace(/^\.\//, '')));
    report.exports.push({ subpath: sub, target: rel, exists });
    if (!exists) badExports++;
  }
  if (!AS_JSON) {
    console.log('\n[exports] subpath -> runtime target present in tarball');
    for (const e of report.exports) console.log(`  ${e.exists ? 'PASS   ' : 'MISSING'} ${e.subpath.padEnd(15)} -> ${e.target}`);
  }

  // 2. resolve each subpath through Node's own resolver, from inside the tree
  for (const sub of Object.keys(targets)) {
    const spec = sub === '.' ? pkg.name : `${pkg.name}${sub.slice(1)}`;
    const isJson = spec.endsWith('.json');
    const f = path.join(root, `_imp_${Buffer.from(sub).toString('hex')}.mjs`);
    fs.writeFileSync(f, probeSource(spec, isJson), 'utf8');
    const r = spawnSync(NODE, [f], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    const ok = r.status === 0;
    report.imports.push({
      spec, ok,
      keys: (r.stdout || '').trim().slice(0, 150),
      error: ok ? '' : ((r.stderr || '').split('\n').filter(Boolean).pop() || '').slice(0, 160),
    });
  }
  if (!AS_JSON) {
    console.log('\n[imports] resolved by Node from inside the extracted tarball');
    for (const i of report.imports) {
      console.log(`  ${i.ok ? 'PASS' : 'FAIL'}  ${i.spec}`);
      if (i.ok && i.keys) console.log(`        ${i.keys}`);
      if (!i.ok && i.error) console.log(`        ${i.error}`);
    }
  }

  // 3. classify every README js fence
  const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const prose = proseOnly(md);
  const blocks = fences(md);
  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i];
    const f = path.join(root, `_readme_${i}.mjs`);
    fs.writeFileSync(f, code, 'utf8');
    const x = spawnSync(NODE, [f], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    const c = classify({ status: x.status, stderr: x.stderr || '', code, prose });
    const first = (code.split('\n').find((l) => l.trim() && !l.trim().startsWith('//')) || '').trim();
    report.examples.push({ index: i, ...c, first: first.slice(0, 66) });
  }
  if (!AS_JSON) {
    console.log(`\n[readme] ${blocks.length} js fences`);
    for (const e of report.examples) {
      console.log(`  ${e.verdict.padEnd(13)}#${e.index} ${e.first}`);
      if (e.reason) console.log(`               ${e.reason}`);
    }
  }

  const count = (v) => report.examples.filter((e) => e.verdict === v).length;
  const badImports = report.imports.filter((i) => !i.ok).length;
  const real = badExports + badImports + count('FAIL');

  if (AS_JSON) {
    console.log(JSON.stringify({ pkgVersion: pkg.version, entries, ...report, defects: real }, null, 2));
  } else {
    console.log('\n' + '-'.repeat(78));
    console.log(`exports    ${Object.keys(targets).length - badExports}/${Object.keys(targets).length} targets exist`);
    console.log(`imports    ${report.imports.length - badImports}/${report.imports.length} resolve`);
    console.log(`readme     ${count('PASS')} runnable, ${count('SKIP')} fragment, ${count('ILLUSTRATIVE')} illustrative, ${count('FAIL')} BROKEN`);
    console.log(real === 0
      ? 'COLD START CLEAN -- a stranger can download this, import every subpath, and run the documented code'
      : `COLD START HAS ${real} REAL DEFECT(S)`);
  }

  if (KEEP) console.log('kept: ' + WORK);
  else fs.rmSync(WORK, { recursive: true, force: true });
  process.exitCode = real === 0 ? 0 : 1;
})();
