'use strict';
/**
 * tools/npm-cold-start.cjs -- the check this wake was opened to do.
 *
 * Last wake proved a stranger can download the GIT tarball and run every
 * documented subpath. This proves the same for what `npm publish` produces.
 * They are different artifacts:
 *
 *   git  -> every tracked file
 *   npm  -> only what `files` allows
 *
 * Method: run a REAL `npm pack` (not --dry-run) into a temp dir, extract the
 * .tgz, then import every export subpath through Node's own resolver from
 * INSIDE the extracted tree. No reliance on the working directory, no symlinks,
 * no node_modules -- exactly the bytes a consumer receives.
 *
 * A subtlety that makes naive versions lie: importing `/<tmp>/x.mjs` by absolute
 * path resolves its bare imports against the temp dir, not the package, so a
 * broken package can still report success. We therefore import the package by
 * its *name* from a parent dir that contains only the extracted package, which
 * forces Node's normal package resolution.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function findNpm() {
  const nodeDir = path.dirname(process.execPath);
  const c = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return c.find((x) => fs.existsSync(x)) || null;
}

/** Minimal tar.gz extractor is unnecessary: `tar` exists on Win10+ as tar.exe. */
function extract(tgz, dest) {
  const r = spawnSync('tar', ['-xzf', tgz, '-C', dest], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return { ok: false, err: (r.stderr || r.stdout || 'tar failed').slice(0, 300) };
  return { ok: true };
}

(async () => {
  console.log(`npm cold start ${new Date().toISOString()}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const npmCli = findNpm();
  if (!npmCli) { console.log('npm-cli.js not found'); process.exitCode = 2; return; }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'eip681-npmcold-'));
  const packDir = path.join(stage, 'pack');
  const appDir = path.join(stage, 'app');
  fs.mkdirSync(packDir); fs.mkdirSync(appDir);

  // Real pack. --pack-destination keeps the tarball out of the repo.
  const pk = spawnSync(process.execPath,
    [npmCli, 'pack', '--ignore-scripts', '--pack-destination', packDir],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  const tarball = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  if (!tarball) {
    console.log('npm pack produced no tarball (exit ' + pk.status + ')');
    console.log((pk.stderr || pk.stdout || '').slice(0, 600));
    process.exitCode = 2; return;
  }
  const tgz = path.join(packDir, tarball);
  console.log(`packed ${tarball} (${fs.statSync(tgz).size}B)`);

  // Extract into a dir named exactly the package name, so bare `import('eip681-kit')`
  // from appDir/ resolves to the extracted tree via node_modules-style lookup.
  const ex = extract(tgz, appDir);
  if (!ex.ok) { console.log('extract failed: ' + ex.err); process.exitCode = 2; return; }
  const extracted = path.join(appDir, 'package');
  if (!fs.existsSync(extracted)) { console.log('tarball did not contain package/'); process.exitCode = 2; return; }

  const nm = path.join(appDir, 'node_modules');
  fs.mkdirSync(nm);
  fs.cpSync(extracted, path.join(nm, pkg.name), { recursive: true });

  // Enumerate export subpaths, stripping the "types" condition (not runnable).
  const subs = Object.keys(pkg.exports || {});
  let fail = 0, pass = 0;
  console.log(`\n[import from extracted tree] ${subs.length} subpaths`);
  for (const sub of subs) {
    const spec = sub === '.' ? pkg.name : pkg.name + sub.slice(1);
    const script = path.join(appDir, `probe-${sub.replace(/[^a-z0-9]/gi, '_')}.mjs`);
    // JSON export cannot be imported with assert; read it instead.
    if (sub === './package.json') {
      const p = path.join(nm, pkg.name, 'package.json');
      const ok = fs.existsSync(p) && JSON.parse(fs.readFileSync(p, 'utf8')).name === pkg.name;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${spec.padEnd(22)} (read as file)`);
      ok ? pass++ : fail++;
      continue;
    }
    fs.writeFileSync(script, `const m = await import(${JSON.stringify(spec)});\n`
      + `const k = Object.keys(m);\n`
      + `console.log(JSON.stringify({ n: k.length, k: k.slice(0, 8) }));\n`, 'utf8');
    const r = spawnSync(process.execPath, [script], { cwd: appDir, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    if (r.status === 0) {
      let info = { n: 0, k: [] };
      try { info = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch {}
      const ok = info.n > 0;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${spec.padEnd(22)} exports=${info.n} [${info.k.slice(0, 4).join(',')}]`);
      ok ? pass++ : fail++;
    } else {
      console.log(`  FAIL  ${spec.padEnd(22)} ${(r.stderr || '').trim().split('\n')[0].slice(0, 110)}`);
      fail++;
    }
  }

  // The CLI declared in `bin` must actually execute.
  const binRel = Object.values(pkg.bin || {})[0];
  if (binRel) {
    const binAbs = path.join(nm, pkg.name, binRel);
    const r = spawnSync(process.execPath, [binAbs, '--help'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    const ok = r.status === 0 && (r.stdout || '').length > 20;
    console.log(`\n[bin] ${binRel} --help -> ${ok ? 'PASS' : 'FAIL'} (exit ${r.status}, ${(r.stdout || '').length}B out)`);
    ok ? pass++ : fail++;
  }

  // Negative control: a subpath that must NOT resolve proves the harness can fail.
  const badScript = path.join(appDir, 'probe-negative.mjs');
  fs.writeFileSync(badScript, `try { await import('${pkg.name}/does-not-exist'); console.log('RESOLVED'); }`
    + ` catch (e) { console.log(e.code || 'ERR'); }\n`, 'utf8');
  const nr = spawnSync(process.execPath, [badScript], { cwd: appDir, encoding: 'utf8', windowsHide: true });
  const ctrlOk = (nr.stdout || '').includes('ERR_PACKAGE_PATH_NOT_EXPORTED') || (nr.stdout || '').includes('ERR_MODULE_NOT_FOUND');
  console.log(`[control] bogus subpath rejected -> ${ctrlOk ? 'PASS' : 'FAIL'} (${(nr.stdout || '').trim()})`);
  if (!ctrlOk) fail++;

  fs.rmSync(stage, { recursive: true, force: true });

  console.log('\n' + '-'.repeat(72));
  console.log(fail === 0 && ctrlOk
    ? `NPM COLD START CLEAN -- ${pass} checks pass from the published tarball`
    : `NPM COLD START FAILED -- ${fail} failure(s)`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
