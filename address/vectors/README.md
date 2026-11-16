# EIP-681 address conformance vectors

A single JSON file to check whether your EIP-681 address parser is correct — built
around the failure mode that actually costs money.

```
address/vectors/eip681-address-vectors.json
```

23 vectors: 8 legal, 7 refuse, 2 checksum, 6 trap. All six refusal reasons covered.

## The problem this solves

A wrong-length address is almost never *rejected*. It is **silently truncated** or
**silently unwrapped** into a different, perfectly valid-looking account. There is no
error to catch and no exception to log — the transfer succeeds, to the wrong place.

This is not hypothetical. I measured it twice, independently:

| parser | over-length inputs accepted | what happened |
|---|---|---|
| `eth-url-parser@1.0.4` | **24 / 24** | surplus digits absorbed into `chain_id`; a different account returned than was signed |
| `zcash/librustzcash` (pre-fix) | **25 / 25** | `Erc20Request` silently became `Unrecognised`; fix merged as PR #3062 |

Both are the same defect: **length was never checked before the value was used.**

Executed proof, from `address/verify-vectors.cjs` on 2026-11-16:

```
SILENT  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913abc"
         spec: too-long  |  buggy returned 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
         recipient is a REAL address, no error raised (it is USDC, the intended one)
```

43 characters went in. A valid USDC address came out. Nothing was raised.

## Check order is part of the contract

The `reason` on a refusal is observable, so the order must be fixed. A caller that
reorders these gets different reasons on the same input, and these vectors catch it:

```
empty -> prefix-only -> length (too-short / too-long) -> non-hex -> bad-checksum
```

Why order matters, concretely:

| input | this order says | a naive order says |
|---|---|---|
| `vitalik.eth` | `too-short` | `non-hex` (if charset is checked first) |
| `0xzzz…` at 40 chars | `non-hex` | `too-short` (if a regex with `{40}` fails, which reports nothing useful) |

Length **before** charset is the important one. If you test the character class first,
a short string fails the regex and you cannot distinguish "wrong length" from "wrong
characters" — and the length case is the one that silently corrupts.

## Six refusal reasons, and why each is distinct

| reason | meaning | why it must not be merged with another |
|---|---|---|
| `empty` | no input after trim | caller bug, not attacker input |
| `prefix-only` | `0x` with nothing after | **distinct from `empty`** — the user pasted a prefix and lost the body; different UI message |
| `too-short` | body < 40 | could be a truncated paste — recoverable by asking again |
| `too-long` | body > 40 | **the dangerous one** — see below |
| `non-hex` | 40 chars, bad charset | could be an ENS name or a typo |
| `bad-checksum` | 40 hex, mixed case, EIP-55 fails | **corruption** — the address was altered in transit |

`too-long` must never be treated as "trim it and continue". That single line is the bug
behind both rows in the first table.

`bad-checksum` must never be treated as "lowercase it and continue". Mixed case is
EIP-55 carrying integrity information; discarding it discards the only error detection
an address has.

## All-lowercase and all-uppercase are legal

```
"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"  -> ok, checksummed=false
"0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913"  -> ok, checksummed=false
"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  -> ok, checksummed=true
```

EIP-55 assigns no meaning to uniform case — there is no checksum information to verify,
so it cannot be "wrong". Only **mixed** case is a checksum claim that can fail. A parser
that rejects lowercase breaks every tool that lowercases addresses; a parser that
accepts any mixed case has no checksum at all. Both are in the vectors as controls.

## The trap group

Six vectors where a careless parser returns a real address and raises nothing:

| input | length | slice-to-40 gives | spec says |
|---|---|---|---|
| `USDC` + `a` | 41 | USDC | `too-long` |
| `USDC` + `abc` | 43 | USDC | `too-long` |
| `USDC` + 18 f's | 58 | USDC | `too-long` |
| `0x` + 24 zeros + `BODY` | 64 | **24 zeros-prefix version** | `too-long` |
| `0x` + 64 f's | 64 | `ffff…f` | `too-long` |
| `BODY` + 24 zeros | 64 | BODY | `too-long` |

The 64-digit rows are ABI `uint256` encodings. Unwrapping them is a **guess** about
caller intent: `0x0000…0000<address>` left-padded and `<address>0000…0000` right-padded
are both 64 hex digits, and unwrapping one of them silently produces garbage. Refuse;
make the caller pass the address, not a word that might contain one.

## Why you can trust the `expect` values

They are **not emitted from a parser** — that would be a tautology, since a broken parser
generates equally broken vectors that agree with themselves. They come from a spec
function written from the EIP-681/EIP-55 text, and three independent things pin it down:

1. **Consumer re-check** — `verify-vectors.cjs` re-reads the JSON from disk and
   re-derives all 23. `23 passed, 0 failed`.
2. **Three negative controls**, one per real bug:

   ```
   CAUGHT truncating   (eth-url-parser@1.0.4 slices the body): caught 3/3, wrongly agreed 0
   CAUGHT padding      (ABI uint256 unwrap guess):             caught 1/1, wrongly agreed 0
   CAUGHT case-blind   (ignores EIP-55 entirely):              caught 1/1, wrongly agreed 0
   ```

3. **Silent-corruption proof** — the truncating control must *accept* what the spec
   *refuses*, which is demonstrated above.

If a control ever passes everything, `verify-vectors.cjs` exits 1. A vector set that
cannot fail is not evidence.

**Honest limit:** both the spec function and the controls were written by the same
agent, and the checksum primitive is delegated to an existing implementation rather than
independently re-derived. This shows the rules are reproducible from the written spec; it
does not show a third party would ratify them. Disagreement would be decisive; agreement
is strong but not final.

## A bug in my own first attempt, kept as a warning

My first generator reported **6/6 reasons covered** while it actually covered 4:

- the "non-hex" fixtures were **38 and 37 characters**, so the length check fired first
  and `non-hex` never occurred;
- the checksum flip targeted **body index 4, which is the digit `8`** — flipping a digit
  changes nothing, so the vector was a duplicate of a legal address.

The generator now **refuses to write** unless all six reasons appear and every control
has at least one target vector. Coverage is asserted, not claimed. If you build your own
vectors, do this — a vector set silently missing a reason lets every parser pass that
branch, and you will never notice.

## Running it

```bash
node address/gen-vectors.cjs      # regenerate from the spec function (asserts coverage)
node address/verify-vectors.cjs   # consumer check + 3 negative controls (exit 1 on failure)
```

## Consuming it

```js
const V = require('./eip681-address-vectors.json');

function check(validate) {            // validate(addr) -> {ok, address} | {ok:false, reason}
  for (const c of V.address) {
    const got = validate(c.input);
    const a = JSON.stringify(got), b = JSON.stringify(c.expect);
    if (a !== b) throw new Error(`${JSON.stringify(c.input)}: ${a} != ${b}`);
  }
}
```

Return the same shape as `expect` and the whole file becomes your test suite. If you
return a boolean instead of a `reason`, the six refusal vectors collapse into one
pass/fail and you lose the ability to distinguish a *corrupted* address from a *mistyped*
one — which is the distinction the user interface needs.

## License / provenance

MIT, same as the rest of `eip681-kit`. Generated and verified 2026-11-16 by an autonomous
AI agent. Every number above is the output of a command, not an estimate.
