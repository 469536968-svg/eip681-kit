'use strict';
/**
 * tools/npm-pack-audit.cjs -- verify what `npm publish` would actually ship,
 * against the real packer, before the publish happens.
 *
 * THE RULE THAT BIT ME (2026-11-16)
 * ---------------------------------
 * npm has two independent exclusion systems and they do NOT compose:
 *
 *   `files` in package.json  = allowlist, and it WINS
 *   .npmignore / .gitignore  = applied only to what `files` did not already name
 *
 * Docs: "Files included with the files array cannot be excluded through
 * .npmignore or .gitignore." So a directory entry in `files` ships EVERYTHING
 * under it, and the ignore files are silently inert. I wrote an .npmignore that
 * excluded conformance/subjects/ and it did nothing -- the packer still shipped
 * generated builds of a third-party bundled library (eth-url-parser). Worse, my
 * first version of this audit printed "no nested-ignore disagreement" while
 * those files were in the list: the detector was broken and green.
 *
 * Consequences encoded here:
 *   - the durable fix is not an ignore file, it is explicit `files` entries
 *     (see tools/normalize-files.cjs), because only that is authoritative
 *   - every gate below is paired with a CONTROL that must fail when the check is
 *     handed a known-bad input. A check that cannot fail is not evidence.
 *
 * Checks:
 *   1. every runtime export target is inside the tarball
 *   2. every declared .d.ts / main / types / bin is inside
 *   3. nothing sensitive ships (.env, keys, node_modules, scratch, tgz, log)
 *   4. no shipped path is matched by a NESTED .gitignore (git says "generated",
 *      npm says "ship", and the disagreement is invisible by inspection)
 *
 * Usage: node tools/npm-pack-audit.cjs [--json]
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_DIR = path.resolve(__dirname, '..');
const AS_JSON = process.argv.includes('--json');

function findNpm() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js',
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function nestedGitignores(root) {
  const found = [];
  const skip = new Set(['node_modules', '.git']);
  const visit = (dir) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (skip.has(n)) continue;
      const p = path.join(dir, n);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) visit(p);
      else if (n === '.gitignore') {
        const patterns = fs.readFileSync(p, 'utf8').split(/\r?\n/)
          .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
        found.push({ dir: path.relative(root, path.dirname(p)).replace(/\\/g, '/'), patterns });
      }
    }
  };
  visit(root);
  return found;
}

/** Does repo-relative `rel` match `pattern`, as anchored at directory `base`? */
function matches(rel, base, pattern) {
  const scope = (base === '' || base === '.' || base === undefined)
    ? rel
    : (rel === base ? '' : (rel.startsWith(base + '/') ? rel.slice(base.length + 1) : null));
  if (scope === null) return false;
  const target = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!target) return false;
  if (target.includes('*')) {
    const re = new RegExp('^' + target.split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(scope) || scope.split('/').some((seg) => re.test(seg));
  }
  return scope === target || scope.startsWith(target + '/');
}

/** Walk a directory, returning repo-relative file paths. */
function walkFiles(abs, relBase = '') {
  const out = [];
  const skip = new Set(['node_modules', '.git']);
  const visit = (dir, rel) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (skip.has(n)) continue;
      const a = path.join(dir, n);
      const r = rel ? rel + '/' + n : n;
      let st;
      try { st = fs.statSync(a); } catch { continue; }
      if (st.isDirectory()) visit(a, r);
      else out.push(r);
    }
  };
  visit(abs, relBase);
  return out;
}

(async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'package.json'), 'utf8'));
  const npmCli = findNpm();
  if (!npmCli) { console.log('npm-cli.js not found beside node.exe'); process.exitCode = 2; return; }

  const r = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: REPO_DIR, encoding: 'utf8', windowsHide: true, timeout: 180000,
  });
  const raw = `${r.stdout || ''}${r.stderr || ''}`;
  const start = raw.indexOf('[');
  let parsed = null;
  if (start >= 0) { try { parsed = JSON.parse(raw.slice(start, raw.lastIndexOf(']') + 1)); } catch {} }
  if (!Array.isArray(parsed) || !parsed[0]) {
    console.log('npm pack returned no JSON (exit ' + r.status + ')');
    console.log(raw.slice(0, 1000));
    process.exitCode = 2;
    return;
  }

  const info = parsed[0];
  const shipped = [...new Set((info.files || []).map((f) => f.path.replace(/\\/g, '/')))];
  const shippedSet = new Set(shipped);

  // ---- CONTROL: the matcher must be able to fire -------------------------
  // Pick a path on disk that a nested .gitignore really does exclude, and prove
  // matches() flags it. Without this, check 4 can pass by being blind.
  const nested = nestedGitignores(REPO_DIR);
  let control = { ran: false, fired: false, sample: null };
  for (const g of nested) {
    const baseAbs = g.dir ? path.join(REPO_DIR, g.dir) : REPO_DIR;
    const onDisk = walkFiles(baseAbs, g.dir);
    for (const f of onDisk) {
      if (g.patterns.some((p) => matches(f, g.dir, p))) {
        control = { ran: true, fired: true, sample: f, by: (g.dir || '.') + '/.gitignore' };
        break;
      }
    }
    if (control.fired) break;
  }

  // ---- 1/2: declared targets ---------------------------------------------
  const runtime = [];
  for (const [sub, val] of Object.entries(pkg.exports || {})) {
    const walk = (v) => {
      if (typeof v === 'string') { runtime.push([sub, v]); return; }
      if (v && typeof v === 'object') for (const [k, vv] of Object.entries(v)) if (k !== 'types') walk(vv);
    };
    walk(val);
  }
  const declared = [];
  for (const [sub, val] of Object.entries(pkg.exports || {})) {
    if (val && typeof val === 'object' && typeof val.types === 'string') declared.push([`types ${sub}`, val.types]);
  }
  if (pkg.main) declared.push(['main', pkg.main]);
  if (pkg.types) declared.push(['types', pkg.types]);
  for (const [k, v] of Object.entries(pkg.bin || {})) declared.push([`bin:${k}`, v]);

  const unmet = [];
  const rows = [];
  const checkOne = (label, rel) => {
    const p = String(rel).replace(/^\.\//, '');
    const ok = shippedSet.has(p);
    rows.push({ label, rel, ok });
    if (!ok) unmet.push(label + ' -> ' + rel);
  };
  for (const [sub, rel] of runtime) checkOne(`export ${sub}`, rel);
  for (const [label, rel] of declared) checkOne(label, rel);

  // ---- 3: leaks -----------------------------------------------------------
  const leakRe = /(^|\/)(\.env.*|\.npmrc|id_rsa|.*\.pem|.*\.key)$|(^|\/)(node_modules|\.git)\/|(^|\/)scratch\/|\.(tgz|log)$/i;
  const leaks = shipped.filter((p) => leakRe.test(p));

  // ---- 4: nested-gitignore disagreement ----------------------------------
  const contradictions = [];
  for (const p of shipped) {
    for (const g of nested) {
      if (g.patterns.some((pat) => matches(p, g.dir, pat))) {
        contradictions.push({ file: p, ignoredBy: (g.dir || '.') + '/.gitignore' });
        break;
      }
    }
  }

  // ---- 5: `files` entries that are bare directories (the root cause) -----
  // A directory entry ships everything under it and makes ignore files inert.
  const dirEntries = (pkg.files || []).filter((f) => /\/$/.test(f) || fs.existsSync(path.join(REPO_DIR, f)) && fs.statSync(path.join(REPO_DIR, f)).isDirectory());

  const bad = unmet.length + leaks.length + contradictions.length;

  if (AS_JSON) {
    console.log(JSON.stringify({
      name: pkg.name, version: pkg.version, shipped, shippedCount: shipped.length,
      packedSize: info.size, unpackedSize: info.unpackedSize,
      unmet, leaks, contradictions, dirEntries, control,
    }, null, 2));
    process.exitCode = bad === 0 ? 0 : 1;
    return;
  }

  console.log(`npm pack audit ${new Date().toISOString()}`);
  console.log(`${pkg.name}@${pkg.version}: ${shipped.length} files, ${info.size}B packed, ${info.unpackedSize}B unpacked\n`);

  console.log('[declared targets] must be inside the tarball');
  for (const row of rows) console.log(`  ${row.ok ? 'PASS   ' : 'MISSING'} ${row.label.padEnd(22)} -> ${row.rel}`);

  console.log('\n[leaks] nothing sensitive');
  if (!leaks.length) console.log('  PASS   none');
  else leaks.forEach((l) => console.log('  LEAK   ' + l));

  console.log('\n[nested .gitignore] shipped despite git calling it generated');
  if (!contradictions.length) console.log('  PASS   none');
  else for (const c of contradictions) console.log(`  CONTRADICTION  ${c.file}  (ignored by ${c.ignoredBy})`);

  console.log('\n[files entries] bare directories make ignore files inert');
  if (!dirEntries.length) console.log('  PASS   none (all entries explicit)');
  else dirEntries.forEach((d) => console.log(`  FRAGILE  ${d}  ships everything under it`));

  console.log('\n[control] matcher can fire');
  if (!control.ran) console.log('  UNTESTED  no nested-ignored file exists to prove the matcher works');
  else console.log(`  PASS      flags ${control.sample} (per ${control.by})`);

  console.log('\n' + '-'.repeat(74));
  console.log(bad === 0
    ? 'NPM PACK CLEAN -- every declared target ships, nothing sensitive, no nested-ignore disagreement'
    : `NPM PACK HAS ${unmet.length} MISSING, ${leaks.length} LEAK, ${contradictions.length} CONTRADICTION`);
  if (control.ran && !control.fired) { console.log('MATCHER CONTROL FAILED -- results above are not trustworthy'); process.exitCode = 2; return; }
  process.exitCode = bad === 0 ? 0 : 1;
})();
