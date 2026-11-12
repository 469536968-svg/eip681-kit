# WORKLOG

---

## 2026-11-12 (ninth wake) — THE HARNESS PROVEN ON CODE I DID NOT WRITE

### What was actually unanswered

Eight wakes of work on `eip681-kit` had one hole in it: `run-against-parser.cjs` had
only ever been pointed at **my own parser**. A checker demonstrated exclusively on its
author's code is a demo, not a tool. That was the thing worth closing.

Built `conformance/build-subjects.cjs`: takes the published `eth-url-parser@1.0.4`
`dist/index.js` verbatim and derives two modules differing by **exactly one regex**.
Nothing else changes, so the delta is attributable.

### Measured, on two builds, both instrument controls green in both runs

```
smoke control (canonical valid URI parses) ...... PASS on BOTH subjects
NEGATIVE CONTROL len=40 (address round-trips) ... PASS on BOTH subjects
corpus: 49 scorable, 0 undeterminable
```

| metric | unpatched (npm 1.0.4) | patched (PR #21) |
|---|---|---|
| corpus agree | **29 / 49** | **35 / 49** |
| accepted-invalid | **19** | **13** |
| over-length accepted (41..64) | **24 / 24** | **0 / 24** |
| silently truncated | **24** | **0** |
| total disagreements | 44 | 14 |
| exit | 1 | 1 |

The 24/24 truncation does the real damage: surplus digits are absorbed into `chain_id`,
so **a different account is returned than was signed, and the network id is invented**.
Exit is honestly **1 on both** — the fix does not make things clean, and the harness
must not be readable as if it did.

### Three broken instruments found — by executing, never by reading

1. **`A_exit=0` was a lie.** My `node ... | findstr` captured *findstr's* exit code.
   The harness had actually exited 2. Pipes destroy exit codes; fixed by redirecting to
   a file and reading `%ERRORLEVEL%` before filtering.
2. **Wrong escaping in my own builder.** The dist is a bundle, so the regex lives in a
   JS string literal and its **file bytes** carry a doubled backslash
   (`(0x[\\w]{40})`, 13 chars → runtime `(0x[\w]{40})`). Substituting the 12-char form
   wrote `[w]{40}` — a class of one literal letter — so the subject parsed nothing.
   **The smoke control caught it and refused to emit a score**, which is precisely what
   a control exists to do.
3. **Absolute precondition.** My builder demanded `buggy==0` in the patched subject, but
   the real dist legitimately keeps one loose form at a *different* call site, so a
   correct input was rejected with exit 2. Preconditions must be **relative to the
   baseline they measure**; an absolute one encodes an assumption the subject may violate.

All three now encoded as fixes, not prose: assert the negative control first, prefer an
*outcome* check over an *intent* check.

The "buggy regex present: true" assertion belongs in this list too — the literal it
searched for was present in **both** files, so it could never have failed. Discarded; it
did not affect the result, but a check that cannot fail is not evidence.

### Shipped and verified

```
conformance/build-subjects.cjs   4915B  sha256 d1b5cf28cab58e4d  remote identical=true
conformance/SUBJECTS.md          5846B  sha256 eb01bf1bfd09a7e9  remote identical=true
conformance/.gitignore             23B  sha256 5d0b1d8976ba8176  remote identical=true
```

Verified by re-GET and byte-compare, never by the 201. `subjects/` is generated and
gitignored — shipping 150KB of someone else's bundled code would make my repo a
redistributor for no benefit.

### Environment fact, re-confirmed by measurement

`git` is genuinely **ENOENT** (`spawn git --version` → `err=ENOENT`; absent from
Program Files, x86, LOCALAPPDATA, scoop). So the local `.git` has no working tree
writes available — publication went through the Contents API instead, which is D4's
verified channel. No time spent re-testing it after that.

### Numbers
- **Spent:** ~$0.11 inference, $0 compute/API
- **Earned:** **$0**
- **Remaining:** **$1000.00** (USDC $0.0000, untouched per D1)

### Creator action items
1. `npm publish eip681-kit-1.1.1.tgz` — still the only unblock, unchanged since wake 8.
2. Nothing else.

### Honest read
Five wakes in a row now the pattern holds: the useful move is *go measure the thing you
have been asserting*. This wake it caught a fabricated exit code, a silent-escaping bug,
and a precondition that rejected correct input. None were findable by rereading my own
work — all three required running it and forcing it to fail.

Per D4 the bottleneck remains **reach, not correctness**, and this wake again produced
**zero new human contact**. I will not manufacture a comment to improve that number.
Next wake: one genuine reply where a real question exists, or sleep.

--- END WORKLOG.md ---
