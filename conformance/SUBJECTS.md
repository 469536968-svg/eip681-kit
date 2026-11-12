# The harness run against code I did not write

`run-against-parser.cjs` was only ever demonstrated against `eip681-kit` itself.
A checker proven only on its author's code is a demo, not a tool. This is the missing
evidence: the same harness, same corpus, pointed at a **third-party library** in two
forms that differ by exactly one regex.

**Subject:** `eth-url-parser@1.0.4` as published on npm (author: brunobar79).
**Method:** take the shipped `dist/index.js` verbatim and derive two modules from it.

| file | derivation |
|---|---|
| `subjects/subject-patched.cjs` | byte-identical to `dist/index.js` (contains my fix) |
| `subjects/subject-unpatched.cjs` | same file, fixed regex replaced by the one npm ships |

Nothing else differs. That is what makes the delta attributable.

## Building the subjects

```bash
node conformance/build-subjects.cjs <path>/eth-url-parser/dist/index.js conformance/subjects
```

The `subjects/` directory is **generated and not committed** — those files are
third-party bundled code, and shipping a 150 KB copy would make this repository a
redistributor for no benefit. The builder is deterministic; regenerate instead.

## Verified build output

```
dist bytes        : 149561
baseline counts   : fixed=1 buggy=1   (buggy>0 is normal: other call sites keep the loose form)
patched           : bytes=149561  fixed=1 buggy=1
unpatched         : bytes=149540  fixed=0 buggy=2
  PASS  patched is byte-identical to source
  PASS  patched keeps baseline counts
  PASS  unpatched has fixed removed
  PASS  unpatched gained exactly baseF buggy
  PASS  byte delta matches substitution
differential precondition: SATISFIED (one regex family, nothing else changed)
```

Negative control: feeding the builder a dist with **no** fixed form exits **2** with
`BUILD FAILURE: fixed form not present`. The guard is proven able to fire.

## Results

Both runs emitted their instrument controls **before** any score:

```
smoke control (canonical valid URI parses) ...... PASS on BOTH subjects
NEGATIVE CONTROL len=40 (address round-trips) ... PASS on BOTH subjects
corpus: 49 scorable, 0 undeterminable
```

| metric | unpatched (npm 1.0.4) | patched (PR #21) |
|---|---|---|
| corpus agree | **29 / 49** | **35 / 49** |
| accepted-invalid | **19** | **13** |
| rejected-valid | 1 | 1 |
| over-length accepted (41..64) | **24 / 24** | **0 / 24** |
| of those, silently truncated | **24** | **0** |
| total disagreements | 44 | 14 |
| exit code | 1 | 1 |

Exit is **1 on both**, deliberately. The patched build is not clean, and the harness
must not be readable as "the fix makes everything right."

## What the 24/24 truncation does

Surplus digits are not rejected and not ignored — they are **absorbed into
`chain_id`**, inventing a value the caller never supplied:

```
input : ethereum:0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d3590@1   (41 digits)
output: target_address = 0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359   (truncated)
        chain_id       = "0"                                        (the 41st digit)
```

A **different account** is returned than was signed, and the network id is fabricated.
The sweep covers 41..64 inclusive because one 42-digit sample exercises a single offset;
the leaked digit only surfaces as `chain_id` at particular lengths.

The six cases that flip from accepted-invalid to agree (`C-03`, `C-04`, `C-05`, `C-06`,
`T-07`, `X-05`) are exactly the set a length boundary should move, and nothing else
moved that should not have. `T-08` — an over-length **token contract** address, the
third call site — also stops being accepted.

## The 13 residuals, listed rather than hidden

- **checksum claim ignored** — mixed case is an EIP-55 assertion (`C-07`)
- **zero address** — valid syntax, unrecoverable, emitted without warning (`C-12`, `T-09`)
- **amount semantics** — `value=1.5` fractional base units, `value=` empty,
  `uint256` outside `/transfer`, `uint256`+`value` ambiguity (`A-03`, `A-07`, `T-05`, `T-06`)
- **chain id** — `@0`, `@` empty, 23-digit id past `MAX_SAFE_INTEGER` (`A-08`, `A-09`, `A-10`)
- **missing recipient** — `/transfer?uint256=` with no `address=` (`T-03`)
- **`/approve` treated as a payment** (`X-04`)
- **rejected-valid** — surrounding whitespace not trimmed, common from QR text (`X-03`)

## Exit codes

`0` = no disagreement · `1` = defects found · `2` = harness or binding failure,
**output meaningless**. A harness that returns 0 when it is broken is worse than none.

## Three broken instruments, recorded on purpose

Each was a check that could not fail, or could not fire, and each was caught by
executing rather than by reading:

1. **Unescapable substring test.** A byte assertion printed
   `patched contains buggy regex: true` — the literal it searched for was present in
   *both* files. Discarded, though it did not affect the result.
2. **Wrong escaping in the builder.** The dist is a bundle, so the pattern sits inside
   a JS string literal and its **file bytes** carry a doubled backslash:
   file `(0x[\\w]{40})` (13 chars) → runtime `(0x[\w]{40})`. Substituting the 12-char
   form wrote a regex the engine read as `[w]{40}` — a class of one literal letter — so
   the subject parsed nothing. **The harness's smoke control caught it and refused to
   report numbers**, which is exactly what a control is for.
3. **Absolute precondition.** The builder demanded `buggy==0` in the patched subject,
   but the real dist legitimately keeps one loose form at a *different* call site, so it
   rejected a correct input and exited 2. A precondition must be **relative to the
   baseline it measures**; an absolute one encodes an assumption the subject may violate.

Fix for all three is the same and is now enforced in code: assert the negative control
first, and prefer an *outcome* check over an *intent* check.
