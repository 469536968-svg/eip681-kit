# EIP-681 amount conformance vectors

A single JSON file you can drop into any language's test suite to check whether your
EIP-681 amount parser is correct — including the cases that are silently wrong in most
implementations.

```
amount/vectors/eip681-amount-vectors.json
```

43 amount cases, 7 format cases, 5 decode cases. Covers all six refusal reasons,
the uint256 boundary, and three cases that a `Double`-based parser gets wrong.

## Why you can trust the `expect` values

They were **not hand-written**. `gen-vectors.cjs` produces them by calling the
reference parser and serializing its actual return value. That alone would be a
tautology, so three independent things pin it down:

1. `amount/eip681-amount.test.mjs` — 52 assertions that state the intended semantics
   in prose-and-assertion form, written before the vectors existed.
2. `amount/verify-vectors.cjs` — re-reads the JSON **from disk** as a consumer,
   re-checks all 55 cases, and then runs a **negative control**: a deliberately
   naive `Number()`-based parser must fail the `differential` group.
3. `amount/conformance_py.py` — a **second, from-scratch implementation in Python**
   that never imports the JavaScript. If the vectors were just my JS behavior
   serialized, an independent implementation reading the same spec would diverge.

Actual output of 2 and 3, run on 2026-11-16:

```
strict re-check: 55 passed, 0 failed  (vectors: amount=43 format=7 decode=5)
negative control: float parser caught on 3 differential case(s), wrongly agreed on 0
RESULT: PASS (vectors reproduce, and they discriminate against float arithmetic)

python (independent, from-scratch): 55 passed, 0 failed of 55
RESULT: PASS -- two independent implementations agree on all 55 vectors, so the file is language-neutral
```

If the vectors stopped discriminating, control 2 would report `0 caught` and the run
would fail. The vectors are evidence only for as long as they can fail.

**Honest limit:** both implementations were written by the same agent. Agreement shows
the semantics are *reproducible from the written spec*, not that a third party would
rule them correct. Disagreement would have been decisive; agreement is strong but not
final evidence.

## Schema

`units` is always a **decimal string**, never a JSON number. `2^256` does not survive
JSON's number precision, and a vector file that can't represent its own legal values
is not a conformance file.

```jsonc
// amount[] — decimals is a REQUIRED input, not a default
{ "input": "1.5", "decimals": 6,
  "expect": { "ok": true, "units": "1500000" } }

{ "input": "0.1", "decimals": 0,
  "expect": { "ok": false, "reason": "fraction-of-a-unit" } }

// format[] — base units -> decimal string
{ "units": "1500000", "decimals": 6, "expect": "1.5" }

// decode[] — percent-decoding; null means refused
{ "input": "1%2E5", "expect": "1.5" }
```

Refusal reasons: `empty`, `syntax`, `negative`, `hex-not-allowed`,
`fraction-of-a-unit`, `exceeds-uint256`.

## The four cases worth reading even if you use nothing else

**1. `decimals` must be an input.** The spec says an amount is accepted when it is a
whole number of wei **or token units**. `"1.5"` has no wei representation but is
exactly `1500000` base units of a 6-decimal token. An API shaped
`parse(amount) -> Result` makes the spec's own rule unenforceable. This is the single
cheapest thing to fix before writing the parser.

**2. Do not decide wholeness from the syntax.**

| input | decimals | result |
|---|---|---|
| `0.000000000000000001e36` | 0 | **ok, 1000000000000000000** |
| `.5` | 0 | refused: `fraction-of-a-unit` |

The first has a fraction part *and* an exponent and is still a whole `1e18` wei. Any
guard of the form "reject if it contains a dot" is wrong.

**3. `Number()` diverges from exactness in three measurable places.**

| input | exact | what a double gives |
|---|---|---|
| `9007199254740993` | 9007199254740993 | 9007199254740992 |
| `21000000000000000001` | 21000000000000000001 | 21000000000000000000 |
| `1.000000000000000001e18` | 1000000000000000000 | 999999999999999999-ish |

Use a big integer type end to end. `BigInt` (JS), `BigInteger` (Java/Kotlin),
`int` (Python) — but *not* `float` anywhere on the value path.

**4. Decimal amount ≠ base units, and the misparse is silent.**

A URI `value=1500000` on a 6-decimal token means `1.5` tokens. Passing the same
integer `1500000` to a `uint256` transfer function means `0.0000000000000000000015`
of the total supply — or on a 6-decimal token, `1.5` if you meant base units.

| parse `"1500000"` at | result |
|---|---|
| 0 dp (base units) | 1500000 — correct for a `uint256` argument |
| 6 dp (decimal amount) | 1500000000000 — **10^6 inflation, no error raised** |

Both are legal inputs. Only the caller's intent distinguishes them, so the API must
force the caller to say which one they mean. This is vector group `trap`.

## Running it

```bash
node amount/gen-vectors.cjs      # regenerate from the reference parser
node amount/verify-vectors.cjs   # consumer check + negative control (exit 1 on failure)
python amount/conformance_py.py  # independent Python implementation, same 55 vectors
```

`verify-vectors.cjs` exits non-zero if any case fails **or** if the float control stops
being caught. Wire it into CI and the vectors cannot silently rot.

## Consuming from another language

The Python file is a complete worked example — copy its shape rather than the JS one
if you are not writing JavaScript:

```python
import json
V = json.load(open("eip681-amount-vectors.json"))

def check(parse):                      # parse(amount: str, decimals: int) -> dict
    for c in V["amount"]:
        got = parse(c["input"], c["decimals"])
        assert got == c["expect"], f'{c["input"]}@{c["decimals"]}: {got} != {c["expect"]}'
```

Give your parser the same shape as `expect` — `{ok: true, units: "<decimal string>"}`
or `{ok: false, reason: "<one of the six>"}` — and the whole file becomes a test suite
for free. If your parser returns a `float` or a `double` for `units`, it will fail
`differential`, correctly.

## Known coverage gap (found while writing the Python)

The Python `decode_param_value` I first wrote contained a **nonsensical bounds
condition** (an `and` over two contradictory comparisons). It passed all five decode
vectors anyway, because the very next check — that the two characters after `%` are
valid hex — subsumes it. So a malformed *guarding* expression is invisible to this
vector set as long as a *later* check catches the same inputs.

Concretely: these vectors prove your decoder's **output** is right. They do not prove
every branch of your decoder is reachable or correct. If you are auditing rather than
testing, read the code too.

## License / provenance

MIT, same as the rest of `eip681-kit`. Generated and verified on 2026-11-16 by an
autonomous AI agent; every number above is the output of a command, not an estimate.
