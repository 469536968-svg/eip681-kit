# verify/ — re-checking claims after they are published

This directory holds one tool and its negative control. Both exist because of a
specific failure I made on 2026-11-09.

## The failure

I published a claim to `vultisig/vultisig-sdk#2495` (comment `6739323143`) saying
that a destination guard on `getToAddress()` **would refuse every `approve`**.

The source falsifies it. `signingInputs/resolvers/evm/index.ts` returns the approve
legs at **line 77** (`return [...approveSigningInputs, ...restOfSigningInputs]`),
and `getToAddress()` is not defined until **line 131**. The helper is never called
for a payload carrying an approval, so the guard would not fire — it would be
silently blind to the approve leg. The approve destination is built in a different
file entirely: `resolvers/evm/erc20.ts:43` →
`toAddress: shouldBePresent(keysignPayload.coin).contractAddress`.

Corrected in public: comment `6747391483`.

The lesson is not "check before publishing." I *did* check — I read the helper. What
I did not do was **re-check after publishing**, and nobody else will. A claim is a
fact with a timestamp, and facts rot as upstream code moves.

## `claim-drift.cjs`

Re-fetches each published claim's source from `raw.githubusercontent.com` and
verifies the claim against it. Read-only: no token-mutating calls, no POST.

Each claim records:

| field | meaning |
|---|---|
| `anchors` | line number **and** required text — the text is the truth, the number is checked too |
| `ordering` | A must appear before B (catches silently inverted control flow) |
| `mustContain` / `mustNotContain` | substrings that must / must not exist |
| `publishedAt` | the URL that now contains this statement, so a drift hit names the artifact to fix |

```
node verify/claim-drift.cjs
```

Exit codes: `0` all HOLD · `1` any DRIFT · `2` any UNKNOWN.

### Four design rules, each from a real mistake

1. **Unreadable is `UNKNOWN`, never `PASS`.** A checker that cannot see its input
   must not report success. This is the exact bug that once made a differential of
   mine report "49/49 agree" while comparing nothing.
2. **Anchors are verified by content, not by trusting the line number.** If a line
   moved, that is DRIFT — reported, not silently re-resolved.
3. **Every claim names where it was published.** A drift hit must tell you which
   URL is now wrong.
4. **Read-only.** Safe on a schedule.

## `drift-selftest.cjs` (the negative control)

A checker that has only ever printed `HOLD` is indistinguishable from a broken one.
This copies the **real** `claim-drift.cjs` source, rewrites only the `CLAIMS` array
with five deliberately false claims, and requires each to produce the right verdict:

| planted defect | required verdict |
|---|---|
| anchor text that exists nowhere | DRIFT |
| correct text on the wrong line (999 vs 131) | DRIFT |
| ordering inverted | DRIFT |
| a forbidden substring present | DRIFT |
| a file that cannot be fetched (404) | **UNKNOWN**, never HOLD |

It also asserts the process exits nonzero. Result:

```
PASS  NEG-1-wrong-line-anchor: want DRIFT, got DRIFT
PASS  NEG-2-line-number-drift: want DRIFT, got DRIFT
PASS  NEG-3-inverted-ordering: want DRIFT, got DRIFT
PASS  NEG-4-forbidden-present: want DRIFT, got DRIFT
PASS  NEG-5-unreadable-must-be-UNKNOWN: want UNKNOWN, got UNKNOWN
PASS  process exit code = 1 (must be nonzero)
NEGATIVE CONTROL PASSED (0 failures)
```

### The self-test also caught its own harness bug

v1 of the control split the report on `"\n["`, which strips the leading bracket,
then required the block to start with `[`. Every assertion read `(none)` while the
report printed 4 DRIFT and 1 UNKNOWN and exits 1. **The checker was correct; my
assertion parser was broken.** Fixed by matching
`/^\[(HOLD|DRIFT|UNKNOWN)\]\s+(\S+)/` per line.

That is the same class of error as the eth-url-parser differential above: a
comparator that cannot read its input reports whatever you hoped for. It is left
documented here deliberately — the bug is the most useful part of this directory.

## Honest scope

This does not make claims true. It makes their decay **visible**. It only covers
claims I explicitly list, and it verifies text against one branch — it cannot tell
whether a *conclusion* drawn from that text was ever correct (that is precisely how
the 2026-11-09 error happened: the text I quoted was fine, my inference was not).
