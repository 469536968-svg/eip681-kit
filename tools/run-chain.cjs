'use strict';
/**
 * run-chain.cjs -- run the full test chain the way `npm test` does, capturing a
 * REAL exit code per file.
 *
 * WHY A RUNNER AND NOT A SHELL CHAIN
 * ---------------------------------
 * In cmd.exe, `a && b` short-circuits and `%ERRORLEVEL%` inside a one-liner can
 * report the echo rather than the child. I have already mis-read a fabricated exit
 * code that way once, so the shell is removed from the measurement entirely:
 * each file is spawned directly and its status recorded.
 *
 * SELF-VERIFYING (`--selftest`)
 * ----------------------------
 * A runner that has only ever seen green runs is unproven. With --selftest it
 * additionally spawns a deliberately-failing child whose STDOUT CLAIMS SUCCESS
 * ("3 passed, 0 failed") while exiting 3, and requires the runner to report it
 * RED. That is the exact failure mode worth guarding: believing a summary line
 * instead of an exit code.
 *
 * Usage:  node tools/run-chain.cjs [--selftest]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KIT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const SELFTEST = process.argv.includes('--selftest');

const CHAIN = [
  ['test.mjs', 'core parser'],
  ['deriveEip681.test.mjs', 'derive'],
  ['cli.test.mjs', 'cli'],
  ['padding-edge.test.mjs', 'padding edge'],
  ['split.test.cjs', 'split'],
  ['strict.test.mjs', 'strict'],
];

function runOne(fileAbs, label, { missingIsFail = true } = {}) {
  if (!fs.existsSync(fileAbs)) {
    return { label, file: path.basename(fileAbs), code: null, note: 'MISSING', ok: !missingIsFail };
  }
  const r = spawnSync(NODE, [fileAbs], {
    cwd: KIT, encoding: 'utf8', timeout: 180000, windowsHide: true,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const summary = out.match(/(\d+)\s+passed[^\n]*/i)
    || out.match(/(\d+)\s+assertions?[^\n]*/i)
    || out.match(/(\d+)\s+ok[^\n]*/i);
  const code = typeof r.status === 'number' ? r.status : (r.signal ? `sig:${r.signal}` : 'null');
  return {
    file: path.basename(fileAbs),
    label,
    code,
    ok: r.status === 0,
    summary: summary ? summary[0].trim() : (out.trim().split('\n').pop() || '').slice(0, 60),
    tail: r.status === 0 ? '' : out.trim().slice(-500),
  };
}

function render(rows) {
  const w1 = Math.max(5, ...rows.map((r) => String(r.file).length));
  const w2 = Math.max(6, ...rows.map((r) => String(r.code).length));
  console.log(`${'file'.padEnd(w1)}  ${'exit'.padEnd(w2)}  label / summary`);
  console.log('-'.repeat(96));
  for (const r of rows) {
    console.log(
      `${String(r.file).padEnd(w1)}  ${String(r.code).padEnd(w2)}  ${r.label}${r.summary ? ' — ' + r.summary : ''}`
      + (r.ok ? '' : '   <== RED'),
    );
  }
  console.log('-'.repeat(96));
  for (const r of rows) if (r.tail) console.log(`\n--- ${r.file} tail ---\n${r.tail}`);
}

const rows = CHAIN.map(([f, label]) => runOne(path.join(KIT, f), label));
render(rows);
const red = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - red}/${rows.length} files green`);

let exit = red === 0 ? 0 : 1;

if (SELFTEST) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-ctl-'));
  const liar = path.join(dir, 'liar.mjs');
  // Claims success on stdout, fails with a nonzero exit. The runner must not be fooled.
  fs.writeFileSync(liar, `console.log('3 passed, 0 failed');\nprocess.exit(3);\n`, 'utf8');
  const ctl = runOne(liar, 'CONTROL liar (green stdout, exit 3)', { missingIsFail: false });
  console.log(`\n[control] exit=${ctl.code} detected_red=${ctl.ok === false} summary="${ctl.summary}"`);
  const caught = ctl.ok === false && String(ctl.code) === '3';
  console.log(caught
    ? '[control] PASS — a green-looking stdout did NOT hide the nonzero exit'
    : '[control] FAIL — runner can be fooled by stdout; its verdict is worthless');
  if (!caught) exit = 1;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(exit === 0 ? '\nCHAIN GREEN' : '\nCHAIN RED');
process.exitCode = exit;
