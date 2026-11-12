#!/usr/bin/env node
// Builds the differential subject pair from a published eth-url-parser dist.
//
//   node conformance/build-subjects.cjs <path-to-dist/index.js> <outdir>
//
// WHY THIS EXISTS
// ---------------
// A conformance harness that has only ever run against its author's own parser proves
// nothing about the harness. To show the checker detects the defect class, you need the
// SAME third-party code in two forms differing by exactly one regex, both byte-derived
// from the published artifact.
//
// TWO BUGS THIS SCRIPT HAS ALREADY HAD, both kept here because both were invisible
// until the instrument was forced to fail:
//
// BUG 1 -- WRONG ESCAPING. The dist is a bundle, so the pattern lives inside a JS
// string literal and its FILE BYTES carry a doubled backslash:
//     file bytes:  (0x[\\w]{40})   <- 13 chars
//     runtime:     (0x[\w]{40})    <- 12 chars
// Substituting the 12-char form wrote (0x[\w]{40}) into the file, which the JS engine
// read as [w]{40} -- a class of one literal letter. The subject then parsed nothing,
// and run-against-parser.cjs's smoke control caught it and refused to report numbers.
// Lesson: substitute at FILE-BYTE level and verify by re-reading from disk.
//
// BUG 2 -- ABSOLUTE PRECONDITION. This script used to demand buggy==0 in the patched
// subject. The real dist contains one pre-existing (0x[\\w]{40}) at a different call
// site, so the check rejected a perfectly good input and exited 2. The requirement is
// not "zero buggy occurrences", it is "the counts moved by exactly the substitution I
// made". Preconditions must be relative to the baseline they are measuring; an absolute
// one encodes an assumption about the subject that the subject is free to violate.
'use strict';

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');

// File-byte forms. FIXED has no backslash escapes; BUGGY must carry the doubled one.
const FIXED = '(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])';   // 34 file bytes
const BUGGY = '(0x[\\\\w]{40})';                        // 13 file bytes: (0x[\\w]{40})

function die(msg) {
  console.log('BUILD FAILURE: ' + msg);
  process.exit(2);
}

const srcPath = process.argv[2];
const outDir = process.argv[3] || 'subjects';
if (!srcPath) die('usage: node build-subjects.cjs <dist/index.js> [outdir]');
if (!existsSync(srcPath)) die('not found: ' + srcPath);

const src = readFileSync(srcPath, 'utf8');

const count = (s, sub) => s.split(sub).length - 1;
const baseF = count(src, FIXED);
const baseB = count(src, BUGGY);

const at = src.indexOf(FIXED);
console.log('dist bytes        : ' + src.length);
console.log('baseline counts   : fixed=' + baseF + ' buggy=' + baseB +
            '   (buggy>0 is normal: other call sites keep the loose form)');
if (at >= 0) console.log('context           : ...' + src.slice(at - 24, at + FIXED.length + 12) + '...');

if (baseF < 1) {
  die('fixed form not present in ' + srcPath + '\n' +
      '  expected: ' + FIXED + '\n' +
      '  build the patched tree first, or pass the patched dist.');
}

const patched = src;
const unpatched = src.split(FIXED).join(BUGGY);
if (unpatched === patched) die('substitution was a no-op -- subjects would be identical');

mkdirSync(outDir, { recursive: true });
const pP = join(outDir, 'subject-patched.cjs');
const pU = join(outDir, 'subject-unpatched.cjs');
writeFileSync(pP, patched);
writeFileSync(pU, unpatched);

// Verify by re-reading from disk: measures the files, not the intentions.
const rP = readFileSync(pP, 'utf8');
const rU = readFileSync(pU, 'utf8');
const pF = count(rP, FIXED), pB = count(rP, BUGGY);
const uF = count(rU, FIXED), uB = count(rU, BUGGY);

console.log('patched           : bytes=' + rP.length + '  fixed=' + pF + ' buggy=' + pB);
console.log('unpatched         : bytes=' + rU.length + '  fixed=' + uF + ' buggy=' + uB);

// RELATIVE precondition: every count must have moved by exactly baseF, nothing more.
const checks = [
  ['patched is byte-identical to source', rP === src],
  ['patched keeps baseline counts',        pF === baseF && pB === baseB],
  ['unpatched has fixed removed',          uF === baseF - baseF && uF === 0],
  ['unpatched gained exactly baseF buggy', uB === baseB + baseF],
  ['byte delta matches substitution',
   (rP.length - rU.length) === baseF * (FIXED.length - BUGGY.length)],
];
let allOk = true;
for (const [name, ok] of checks) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name);
  if (!ok) allOk = false;
}
if (!allOk) {
  console.log('BUILD FAILURE: differential precondition not satisfied (see FAIL lines above).');
  process.exit(2);
}
console.log('differential precondition: SATISFIED (one regex family, nothing else changed)');
console.log('');
console.log('next:');
console.log('  node conformance/run-against-parser.cjs ' + pU);
console.log('  node conformance/run-against-parser.cjs ' + pP);
