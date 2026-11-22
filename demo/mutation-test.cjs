/**
 * MUTATION TEST for the demo.
 *
 * test-demo-parsers.cjs carries the claim "PROVEN BY MUTATION". A claim a reader cannot
 * reproduce is not evidence -- this file is what makes it reproducible:
 *
 *     node demo/mutation-test.cjs
 *
 * It rebuilds the demo with the ORIGINAL bug reintroduced and asserts the suite goes RED.
 * It also asserts the healthy build goes GREEN. If either half is missing the test is
 * either worthless (never observed failing) or broken (always failing) -- both are
 * useless, and I have shipped both mistakes before.
 *
 * The bug under test is `USDC.replace('F', 'f')`: Base USDC is
 * 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, whose only uppercase letter is a single
 * 'D'. There is no 'F', so the replace is a no-op and the preset labelled
 * "bad checksum" renders the canonical, perfectly VALID address. A naive reading of the
 * code says "it uppercases a letter, so it must be a bad checksum"; only executing it
 * shows the preset is a lie.
 *
 * Everything is derived from the real builder source, so this cannot silently drift out
 * of sync with it: if the BAD_CK derivation is rewritten, the mutation fails to apply and
 * this exits non-zero rather than reporting a false PASS.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const DEMO = __dirname;
const KIT = path.dirname(DEMO);
const WORK = path.join(KIT, '.mutation-scratch');
const NODE = process.execPath;

const step = (s) => console.log('\n== ' + s);

step('copy the real builder into a scratch dir');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const buildSrc = fs.readFileSync(path.join(DEMO, 'build-demo.cjs'), 'utf8');
const current = buildSrc.match(/const BAD_CK = \(\(\) => \{[\s\S]*?\}\)\(\);/);
if (!current) {
  console.error('FATAL: could not locate the BAD_CK derivation in build-demo.cjs.');
  console.error('If the builder was refactored, update this regex -- do NOT let this file');
  console.error('report PASS by failing to find anything to mutate.');
  process.exit(2);
}
console.log('found derivation, ' + current[0].length + ' chars');

const ORIGINAL_BUG = "const BAD_CK = USDC.replace('F', 'f').slice(2);";
const mutated = buildSrc.replace(current[0], ORIGINAL_BUG);
if (mutated === buildSrc) {
  console.error('FATAL: mutation did not change the source -- refusing to report on nothing');
  process.exit(2);
}

fs.writeFileSync(path.join(WORK, 'build-demo.cjs'), mutated);
// The builder inlines keccak.mjs and the test slices index.html, so both must travel.
for (const f of ['keccak.mjs', 'test-demo-parsers.cjs']) {
  fs.copyFileSync(path.join(DEMO, f), path.join(WORK, f));
}

const run = (file) => cp.spawnSync(NODE, [path.join(WORK, file)], { cwd: WORK, encoding: 'utf8' });
const tail = (out) => (out || '').split('\n')
  .filter((l) => /passed|FAIL|assertions/.test(l))
  .slice(0, 8).map((l) => '   ' + l).join('\n');

step('build the MUTANT (bug reintroduced)');
const mb = run('build-demo.cjs');
console.log('   builder exit = ' + mb.status);
console.log(tail(mb.stdout));

step('run the test suite against the MUTANT -- it MUST fail');
const mt = run('test-demo-parsers.cjs');
console.log('   test exit = ' + mt.status);
console.log(tail(mt.stdout));

step('rebuild HEALTHY and run the suite -- it MUST pass');
fs.copyFileSync(path.join(DEMO, 'build-demo.cjs'), path.join(WORK, 'build-demo.cjs'));
const hb = run('build-demo.cjs');
console.log('   builder exit = ' + hb.status);
const ht = run('test-demo-parsers.cjs');
console.log('   test exit = ' + ht.status);
console.log(tail(ht.stdout));

fs.rmSync(WORK, { recursive: true, force: true });

step('verdict');
const caught = mt.status !== 0;               // mutant must be REJECTED
const healthyOk = hb.status === 0 && ht.status === 0; // healthy must be ACCEPTED
console.log('   mutant rejected : ' + (caught ? 'YES' : 'NO  <- suite is blind, assertions worthless'));
console.log('   healthy accepted: ' + (healthyOk ? 'YES' : 'NO  <- suite/ build is broken'));

if (caught && healthyOk) {
  console.log('\nMUTATION TEST PASSED -- the suite discriminates.');
  process.exitCode = 0;
} else {
  console.log('\nMUTATION TEST FAILED.');
  process.exitCode = 1;
}
