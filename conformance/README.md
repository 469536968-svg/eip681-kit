# Conformance harness for EIP-681 parsers

Point this at **any** published EIP-681 parser and get a verdict. Dependency-free.

```sh
mkdir /tmp/probe && cd /tmp/probe
npm install eth-url-parser
node /path/to/eip681-kit/conformance/run-against-parser.cjs eth-url-parser
```

The second argument is a module name resolved **from your current directory**, so the
target does not have to be installed next to this script.

## Exit codes

Distinct on purpose, because a harness that cannot run must never be readable as a
strict library:

| code | meaning |
|---|---|
| `0` | no disagreement found against the corpus |
| `1` | disagreement(s) found — real output |
| `2` | **harness or binding failure. The numbers above are meaningless.** |

If you see `2`, do not read the output as evidence about the library. It means the
library was not exercised: wrong export shape, wrong module resolution, or a failed
control.

## Controls

Two controls run before any measurement, and both must pass or the harness exits `2`:

1. **Smoke control** — a canonical valid URI must parse successfully. Without this, a
   mis-bound module throws on *everything* and looks exactly like a strict validator.
   That is the easiest possible way to publish a false accusation.
2. **Length-40 negative control** — a valid 40-digit address must round-trip
   byte-identical. Without this, a harness bug looks identical to a library defect.

## What it measures

### 1. Corpus agreement

`vectors.json` holds adversarial cases with an explicit expected accept/reject. Each
case carries a `why` describing the failure mode it probes. Results are split into:

- **accepted-invalid** — corpus says reject, library accepted
- **rejected-valid** — corpus says accept, library rejected

A case whose expectation cannot be read is **not scored** and is reported as
`undeterminable`. It is never silently counted as agreement — that is how a comparator
reports a false 100%.

> The corpus is one reading of the spec. Treat `accepted-invalid` entries as questions
> to investigate, not as proven defects, **except** where the wrong answer maps an
> address to a different account. Those are unambiguous.

### 2. Length sweep — silent truncation

Sweeps address lengths 40..64. This is the check that does not depend on any reading of
the policy, because it is not a policy question: if a 41-digit hex string is accepted
and the returned address is a 40-digit **prefix**, the parser has silently mapped
address `X` to a **different account** `Y`. Nothing is rejected, nothing is reported,
and a wallet can display one recipient while the transfer targets another.

## Measured results

Two independently maintained libraries, same harness, same corpus, same controls:

| library | smoke | len=40 control | truncated | corpus agree |
|---|---|---|---|---|
| `eth-url-parser@1.0.4` | PASS | PASS | **24/24** (41..64) | 28/49 |
| `@rsksmart/rif-wallet-eip681@1.0.1` | PASS | PASS | **24/24** (41..64) | 26/49 |

Both accept every over-length address and return a 40-digit truncation. Zero rejections
across 24 lengths each.

For `eth-url-parser` the leaked digits additionally shift into the chain-id field
(`@1` on a 41-digit address reports `chain_id: "0"`), so the user's requested network is
silently replaced. `rif-wallet` reports no chain id for this input form, so that second
symptom is specific to `eth-url-parser`; the truncation itself is not.

**Scope of these claims.** Both libraries' *behavior* was measured by execution. The
*source* was read only for `eth-url-parser` (bundle line 4720, `var address_regex =
'(0x[\w]{40})'` — an unanchored 40-quantifier). No shared root cause is claimed for
`rif-wallet`; an unanchored 40-quantifier elsewhere is a plausible explanation and
nothing more.

## Adding a case

Append to `vectors.json`:

```json
{ "id": "C-99", "input": "ethereum:0x<41 hex digits>@1", "expect": false,
  "why": "one sentence on the failure mode this probes" }
```

`expect` may be `true`, `false`, or `{ "ok": true|false }`. Any other shape is reported
as `undeterminable` rather than guessed.

## Why this exists

Publishing "library X is broken" is cheap and often wrong. The only claim worth making
is one that a stranger can reproduce in thirty seconds, with a control proving the
observation is not an artifact of the measuring instrument. This harness exists so that
every claim in `SECURITY-eth-url-parser-truncation.md` can be re-derived independently,
including the possibility that the harness itself is the thing that is broken.
