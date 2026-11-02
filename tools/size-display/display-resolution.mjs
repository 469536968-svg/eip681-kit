/**
 * display-resolution: detect and fix "the message shows two equal figures while
 * asserting an inequality".
 *
 * THE BUG CLASS
 * -------------
 * A program compares two quantities at full resolution, then prints both through a
 * formatter that rounds. When the rounding quantum exceeds the real difference, the
 * rendered message contradicts itself. Measured example from a real tree:
 *
 *     freeBytes = 536870912000        -> "500.0 GiB"
 *     projected = 536871960575        -> "500.0 GiB"
 *     message:   "500.0 GiB free in ... about 500.0 GiB more -- more than is free"
 *
 * Nothing in that sentence is a lie about any single value. The defect is in the
 * RELATIONSHIP between the display resolution and the comparison resolution, which
 * is why unit tests that assert on one message at a time never catch it.
 *
 * THE PROPERTY
 * ------------
 * For a comparison rendered to text, it must hold that
 *
 *     a !== b  implies  text(a) !== text(b)
 *
 * This file provides:
 *   - measureQuantum(fn, x)  : smallest delta that changes fn's output at x
 *   - audit(fn, opts)        : the falsification rate of that property
 *   - sizePairText(a, b, f)  : a formatter for comparison OPERANDS (pair-aware)
 *
 * Zero dependencies. Node >= 16 (ESM).
 *
 * Usage:
 *   import { audit, measureQuantum, sizePairText } from './display-resolution.mjs';
 *   const r = audit(myFormatter);
 *   if (r.collisionRate > 0) console.warn(`${r.collisions}/${r.checked} pairs are ambiguous`);
 *
 * CLI:
 *   node display-resolution.mjs            # run the built-in self-test
 */

/**
 * Smallest positive delta d such that fn(x + d) !== fn(x).
 * Returns { quantum, base } or { quantum: null, reason }.
 *
 * Deliberately probes by DOUBLING then binary-searching instead of assuming a
 * grain: formatters branch on magnitude, so a single global quantum does not exist.
 */
export function measureQuantum(fn, x, cap = 2 ** 40) {
    let base;
    try {
        base = fn(x);
    } catch {
        return { quantum: null, reason: 'fn threw at x' };
    }

    // Walk UP in powers of two until the output changes.
    let hi = 1;
    while (hi <= cap) {
        let s;
        try {
            s = fn(x + hi);
        } catch {
            return { quantum: null, reason: 'fn threw while probing' };
        }
        if (s !== base) break;
        hi *= 2;
    }
    if (hi > cap) return { quantum: null, base, reason: `no change up to ${cap}` };

    // Binary search the boundary in (hi/2, hi].
    let lo = Math.floor(hi / 2);
    while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        let s;
        try {
            s = fn(x + mid);
        } catch {
            return { quantum: null, reason: 'fn threw while bisecting' };
        }
        if (s === base) lo = mid;
        else hi = mid;
    }
    return { quantum: hi, base };
}

/**
 * Falsification test for the property over a grid of candidate values.
 *
 * opts.magnitudes : base magnitudes to multiply (default: KiB..GiB range)
 * opts.multipliers: scale factors per magnitude
 * opts.deltas     : candidate real differences to test
 *
 * Returns { checked, collisions, rate, examples, quantumByMagnitude }.
 */
export function audit(fn, opts = {}) {
    const magnitudes = opts.magnitudes ?? [2 ** 10, 2 ** 20, 2 ** 25, 2 ** 30, 5 * 2 ** 30, 500 * 2 ** 30];
    const multipliers = opts.multipliers ?? Array.from({ length: 64 }, (_, i) => i + 1);
    const deltas = opts.deltas ?? [1, 13, 1e3, 1e5, 1e6, 5e6, 2e7, 3e7, 5e7];
    const maxExamples = opts.maxExamples ?? 5;

    let checked = 0;
    let collisions = 0;
    const examples = [];

    for (const m of magnitudes) {
        for (const k of multipliers) {
            const a = m * k;
            for (const d of deltas) {
                const b = a + d;
                if (a === b) continue;
                let ta;
                let tb;
                try {
                    ta = fn(a);
                    tb = fn(b);
                } catch {
                    continue;
                }
                if (typeof ta !== 'string' || typeof tb !== 'string') continue;
                checked++;
                if (ta === tb) {
                    collisions++;
                    if (examples.length < maxExamples) examples.push({ a, b, delta: b - a, text: ta });
                }
            }
        }
    }

    const quantumByMagnitude = magnitudes.map((m) => {
        const q = measureQuantum(fn, m);
        return { at: m, quantum: q.quantum, rendered: q.base ?? null, reason: q.reason ?? null };
    });

    return {
        checked,
        collisions,
        rate: checked === 0 ? 0 : collisions / checked,
        examples,
        quantumByMagnitude,
    };
}

/**
 * Render the two operands of a size comparison.
 *
 * Guarantees: a !== b implies text(a) !== text(b). It achieves that by dropping to a
 * finer unit when the caller's formatter collides -- never by inventing precision
 * that the underlying integer does not have (the final branch is an exact byte
 * count, which is always truthful for an integer input).
 *
 * @param a first operand
 * @param b second operand
 * @param fmt the project's existing human formatter, (n) => string
 * @returns [textA, textB]
 */
export function sizePairText(a, b, fmt) {
    if (a === b) return [fmt(a), fmt(b)];
    if (fmt(a) !== fmt(b)) return [fmt(a), fmt(b)];

    const mb = (x) => `${(x / 2 ** 20).toFixed(1)} MiB`;
    if (mb(a) !== mb(b)) return [mb(a), mb(b)];

    const kb = (x) => `${(x / 2 ** 10).toFixed(1)} KiB`;
    if (kb(a) !== kb(b)) return [kb(a), kb(b)];

    return [`${a} bytes`, `${b} bytes`];
}

/* ------------------------------------------------------------------ self-test */
/* Runs under `node display-resolution.mjs`. Every number below is computed.      */

function selfTest() {
    let failures = 0;
    const check = (name, cond, detail = '') => {
        if (cond) {
            console.log(`  PASS  ${name}`);
        } else {
            failures++;
            console.log(`  FAIL  ${name}${detail ? '  ' + detail : ''}`);
        }
    };

    // Two real-shaped formatters: one WITHOUT a sub-KiB branch (the defective kind),
    // one WITH (the correct kind). Both are the actual shapes found in the wild.
    const noSubKiB = (n) => {
        const u = ['KiB', 'MiB', 'GiB', 'TiB'];
        let v = n / 1024;
        let i = 0;
        while (v >= 1024 && i < u.length - 1) {
            v /= 1024;
            i++;
        }
        return `${v.toFixed(1)} ${u[i]}`;
    };
    const withSubKiB = (n) => {
        if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'B'}`.replace('B', n === 1 ? 'byte' : 'B');
        return noSubKiB(n);
    };

    console.log('1) quantum measurement');
    // NOTE ON THE EXPECTED VALUE: the quantum is HALF the last-digit step, not the
    // full step. "1.0 MiB" -> "1.1 MiB" is driven by rounding to one decimal, so the
    // smallest observable change is 0.05 MiB = 52428.8 bytes, measured as 52429.
    // An earlier version of this assertion expected a full 0.1 MiB step (104858);
    // the assertion was wrong and the measurement was right. The second check below
    // pins that relationship so the same mistake cannot be made silently again.
    const q1 = measureQuantum(noSubKiB, 1024 ** 2);
    const halfStep = Math.round(0.05 * 1024 ** 2);
    check('quantum at 1 MiB equals half a 0.1 MiB step',
        q1.quantum !== null && Math.abs(q1.quantum - halfStep) <= 2,
        `got ${q1.quantum}, expected ~${halfStep}`);
    check('quantum is strictly smaller than a full last-digit step',
        q1.quantum !== null && q1.quantum < 0.1 * 1024 ** 2,
        `quantum=${q1.quantum} step=${0.1 * 1024 ** 2}`);
    const q2 = measureQuantum(noSubKiB, 0);
    check('quantum at 0 is ~52 bytes for a 1-decimal KiB formatter',
        q2.quantum !== null && Math.abs(q2.quantum - 52) <= 2,
        `got ${q2.quantum}`);

    console.log('2) the defective formatter falsifies the property');
    const bad = audit(noSubKiB, { maxExamples: 3 });
    check('collisions > 0', bad.collisions > 0, `${bad.collisions}/${bad.checked}`);
    check('collision rate is high (>50%)', bad.rate > 0.5, `rate=${bad.rate.toFixed(3)}`);
    console.log(`        measured: ${bad.collisions}/${bad.checked} = ${(bad.rate * 100).toFixed(1)}% ambiguous`);

    console.log('3) negative control: the property is not vacuous');
    const control = audit(withSubKiB, { maxExamples: 3 });
    check('a formatter with a sub-KiB branch still collides above a KiB',
        control.collisions > 0,
        `collisions=${control.collisions}`);

    console.log('4) sizePairText satisfies the property where the formatter cannot');
    let pass = 0;
    let fail = 0;
    for (const m of [2 ** 20, 2 ** 25, 2 ** 30, 5 * 2 ** 30]) {
        for (let k = 1; k <= 32; k++) {
            for (const d of [1, 13, 1e5, 1e6, 5e6]) {
                const a = m * k;
                const b = a + d;
                if (a === b) continue;
                const [ta, tb] = sizePairText(a, b, withSubKiB);
                if (ta === tb) {
                    fail++;
                    if (fail <= 3) console.log(`        FAIL a=${a} b=${b} both "${ta}"`);
                } else pass++;
            }
        }
    }
    check('pair-aware formatter never collides', fail === 0, `${pass} pass / ${fail} fail`);

    console.log('5) the reported real-world case reproduces');
    const FREE = 536870912000;
    const PROJECTED = 536871960575;
    check('both sides really do render identically through the defective formatter',
        noSubKiB(FREE) === noSubKiB(PROJECTED),
        `${noSubKiB(FREE)} vs ${noSubKiB(PROJECTED)}`);
    check('and the comparison still says "more than is free"',
        PROJECTED > FREE,
        `${PROJECTED} > ${FREE}`);
    const [tf, tp] = sizePairText(FREE, PROJECTED, withSubKiB);
    check('pair-aware rendering distinguishes them', tf !== tp, `${tf} vs ${tp}`);
    console.log(`        old message: ${noSubKiB(FREE)} free ... about ${noSubKiB(PROJECTED)} more -- more than is free`);
    console.log(`        new message: ${tf} free ... about ${tp} more -- more than is free`);

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
    console.log(`defective formatter: ${bad.collisions}/${bad.checked} pairs indistinguishable ` +
        `(${(bad.rate * 100).toFixed(1)}%)`);
    return failures === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('display-resolution.mjs')) {
    process.exit(selfTest());
}
