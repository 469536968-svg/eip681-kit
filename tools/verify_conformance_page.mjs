// tools/verify_conformance_page.mjs
//
// Executes the ACTUAL inline <script type="module"> from conformance.html against a
// minimal DOM stub, then asserts the page's own summary line came out 49 / 49.
//
// This is the difference between "the page should work in a browser" (a claim) and
// "the page's code was run and produced the expected result" (evidence).
//
//   node tools/verify_conformance_page.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'conformance.html'), 'utf8');

const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no module script in conformance.html'); process.exit(1); }
const script = m[1];

// --- minimal DOM stub -------------------------------------------------------
const made = { rows: 0, fails: 0 };
const el = (tag = 'div') => {
  const o = {
    tagName: tag, textContent: '', className: '', _html: '',
    children: [], listeners: {},
    appendChild(c) { this.children.push(c); if (tag === 'tbody') made.rows++; return c; },
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v.includes('class="fail"')) made.fails++; },
    get value() { return this._value ?? ''; },
    set value(v) { this._value = v; },
  };
  return o;
};
const nodes = {};
globalThis.document = {
  getElementById(id) { return (nodes[id] ||= el(id === 'rows' ? 'tbody' : 'div')); },
  createElement(tag) { return el(tag); },
};

// --- execute the page's real code as an ES module ---------------------------
const b64 = Buffer.from(script, 'utf8').toString('base64');
let mod;
try {
  mod = await import(`data:text/javascript;base64,${b64}`);
} catch (e) {
  console.error('FAIL: the page script threw while loading (this is what a browser would do):');
  console.error('  ' + e.message);
  process.exit(1);
}

const summary = nodes.summary?.textContent ?? '(never set)';
const sub = nodes.sub?.textContent ?? '(never set)';

// Independently re-derive the count from the rendered rows, so we are not just
// trusting the page's own summary string.
const rendered = made.rows;
const failed = made.fails;

console.log(`page summary text : ${summary}`);
console.log(`page detail text  : ${sub}`);
console.log(`rows rendered     : ${rendered}`);
console.log(`rows rendered FAIL: ${failed}`);

const errors = [];
if (summary !== '49 / 49') errors.push(`summary expected "49 / 49", got "${summary}"`);
if (rendered !== 49) errors.push(`expected 49 rows rendered, got ${rendered}`);
if (failed !== 0) errors.push(`expected 0 failing rows, got ${failed}`);
if (!/all vectors satisfied/.test(sub)) errors.push('detail line does not report all-satisfied');

// Sanity: the interactive box must have produced parse output, not an exception.
const out = nodes.out?.textContent ?? '';
if (!/isTokenTransfer/.test(out)) errors.push('interactive parse box produced no usable output');
else if (/^threw:/.test(out)) errors.push('interactive parse box threw');

if (errors.length) {
  console.error('\nFAIL:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nPASS: the page\'s own code ran, rendered 49/49, and set the summary correctly.');
