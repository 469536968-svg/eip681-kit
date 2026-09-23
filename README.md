# eip681-kit

**A strict EIP-681 parser, validator and formatter with zero dependencies.**

[EIP-681](https://eips.ethereum.org/EIPS/eip-681) defines a URI format for Ethereum
payment requests. Emitting one is easy. Emitting one that is *safe to hand to an
unknown parser* is not — and the failure mode is money sent to the wrong place.

This library refuses to guess. Malformed input produces errors. Valid-but-dangerous
input produces **warnings that name the hazard**, so the caller can decide.

```js
import { parse } from './eip681.mjs';

const v = parse('ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=0x…&uint256=1000000');

v.ok            // true  — grammatically valid
v.isTokenTransfer // true
v.chainId       // 8453 (Base)
v.recipient     // 0x…  (distinct from v.target, the token contract)
v.amount        // 1000000n  (bigint, exact)
v.warnings      // []  — or the specific hazards found
```

## The hazards it catches

| Input | Result | Why it matters |
|---|---|---|
| `/transfer` with no `uint256` | **warning** `token-no-amount` | Some parsers read this as an open-ended transfer the user fills in; others as zero. |
| `/transfer` with no `address` | **error** `token-no-recipient` | The recipient is unspecified. Undefined behaviour across wallets. |
| `/transfer` with both `value` and `uint256` | **error** `token-value-ambiguous` | Native units vs token base units — two parsers, two meanings. |
| no `@chainId` | **warning** `no-chain-id` | The same address exists on many chains. A wallet may pick the wrong one. |
| zero address as target or recipient | **error** | Funds are unrecoverable. |
| duplicate query parameter | **error** | Parsers disagree on which value wins. |
| lowercase/corrupt EIP-55 checksum | **warning** `bad-checksum` | Common and not fatal, but worth surfacing. |

## Correctness, verified against external ground truth

```
node test.mjs
ALL PASS: 41 passed, 0 failed
```

Nothing is compared against this library's own output:

- **Keccak-256** — the `""`, `"abc"` and fox-sentence vectors. (Two real bugs were
  found this way: a 32-bit lane mask and big-endian lane output.)
- **EIP-55** — all four canonical checksum vectors from the EIP.
- **EIP-681** — the spec's example URIs, plus deliberately malformed inputs that
  must error rather than be coerced.
- **Amounts** — exact `bigint` arithmetic; `1e18` is parsed as a decimal power, not
  as a float. `uint256` max round-trips.

## Why the token form is special

A naive parser that understands only `ethereum:<address>?value=` will ignore
`/transfer?…` entirely and may offer to send native currency *to the token
contract address*. That is why some integrators choose to keep the **bare address**
in the QR code for token deposits rather than emit a token-form URI a partial
parser might misread. This library models that distinction explicitly: `target` is
the contract, `recipient` is the person, and they are never conflated.

## Scope and limitations

- Parses and validates; it does **not** sign or broadcast anything.
- `chainId` is limited to `Number.MAX_SAFE_INTEGER`. Real chain ids are far below.
- Function calls other than `transfer` are parsed structurally but their parameters
  are not type-checked — only `address`, `uint256` and `value` have semantics here.
- Unknown query parameters are preserved, not stripped; the spec allows extensions.

## Files

- `eip681.mjs` — the library (pure ES module, browser-compatible).
- `test.mjs` — the test suite.
- `demo.html` — a self-contained validator you can open offline.

## License

MIT.

## Explain a payment URI before you sign it

**Live: https://469536968-svg.github.io/eip681-kit/explain.html**

Paste any EIP-681 URI (or a QR payload) and see what a wallet would actually do with it.
Runs entirely in the browser, no network calls.

It flags the failure modes that actually cause money loss:

| Code | Meaning |
|---|---|
| `NO_CHAIN_ID` | No `@chainId` — the wallet picks the network, so the same QR can pay on the wrong chain |
| `BAD_CHECKSUM` | Mixed-case address that fails EIP-55 — strict wallets refuse it, lax ones pay a maybe-wrong address |
| `PAYEE_IS_THE_ADDRESS` | In a token transfer the path address is the **recipient**, not the token contract. Parsers that ignore the query string will try to send native coin to a person |
| `VALUE_AND_UINT256` | Both amount fields present; EIP-681 makes them mutually exclusive and wallets disagree which wins |
| `UINT256_WITHOUT_TRANSFER` | `uint256=` with no `/transfer` — no contract call to carry the amount |
| `NO_AMOUNT` | No amount: the safest form to publish publicly |

Rejected URIs are still explained in plain language instead of just failing (`errorDetails`).

```js
import { explain } from './explain.mjs';
explain('ethereum:0xdead…@8453/transfer?address=0xToken&uint256=1000000');
```

CLI: `node explain.mjs "<ethereum:...>"` — exits 1 on high risk, 3 on invalid.

---

## Conformance vectors - test any implementation against the spec

`vectors/eip681-vectors.json` is a language-agnostic vector set. `conform.mjs`
runs it against any implementation through a small adapter:

```js
// my-adapter.mjs
import { parse } from './my-eip681-lib';
export default {
  name: 'my-lib',
  parse(uri) {
    const p = parse(uri);
    return {
      ok: p.ok, target: p.target, chainId: p.chainId,
      functionName: p.functionName, recipient: p.recipient,
      amount: p.amount?.toString() ?? null,
      errors: p.errors, warnings: p.warnings,
      checksumValid: p.checksumValid, checksumAbsent: p.checksumAbsent,
    };
  },
};
```

```bash
node conform.mjs ./my-adapter.mjs      # exit 0 = conformant, 1 = failures listed
node conform.mjs                       # self-test the bundled kit
```

Not a JavaScript shop? `conform.py` is the same runner in Python, and the vectors
are plain JSON either way:

```bash
python conform.py ./adapters/example_python.py
python conform.py                      # self-test via the bundled example adapter
```

`adapters/example_python.py` is a complete, runnable adapter showing the required
return shape. Copy it next to your implementation and point `parse()` at your own
code. `vectors/README.md` documents every `expect` key and the rules a conforming
implementation must follow (the important one: a missing assertion is a *failure*,
not a skip - an implementation that cannot report `checksumValid` cannot be
trusted to have checked it).

Fields a vector does not assert are ignored. Fields a vector asserts that your
implementation does not report are **failures** - an implementation that cannot
report `checksumValid` cannot be trusted to have checked it.

### What the vectors decide

| Vector | What it pins down |
|---|---|
| `spec-native-value-sci` | `2.014e18` is valid EIP-681 (decimal mantissa + exponent). Refusing it is non-conformance. |
| `spec-native-value-gas` | `gas` and `gasPrice` in scientific notation, canonical spelling `gasPrice`. |
| `spec-erc20-transfer` | Path address is the **contract**; `?address=` is the **recipient**. |
| `spec-pay-prefix` | `pay-` prefix must be stripped, not refused. |
| `spec-checksum-required-mixed-case` | Mixed case is an EIP-55 **claim**. |
| `bad-mixed-case-checksum` | A failing claim is a **hard error**, not a warning. Case does not change the address bytes, so a failed checksum means a possible typo in the hex - paying it can send funds to a *different* address. |
| `all-lowercase-is-not-a-checksum-claim` | All-lowercase carries no case information, so it cannot be wrong. Refusing it would break every tool that lowercases output. |
| `token-deposit-bare-address` | The form safe to publish publicly: bare address, no `/transfer`. |
| `no-chain-id-present` | Valid per grammar, dangerous in practice - valid but warned. |
| `value-and-uint256-conflict` | Mutually exclusive per spec; wallets disagree, so **refuse**. |
| `uint256-without-transfer` | `uint256=` with no `/transfer` is unpayable as written. |
| `not-a-payment-uri` | `https://...` is not an EIP-681 URI. |
| `amount-wei-not-float` | Amounts are wei strings / bigints, never floats. |
| `max-uint256-amount` | `2^256-1` accepted; the boundary most float-based parsers miss. |

Every vector carries a `why` field stating the real-world consequence of getting
it wrong. That is the part a pass count does not tell you.

### Defects these vectors found in this very kit

Written from the spec rather than from this kit's own behaviour, the vectors
exposed three genuine faults in the parser they were testing:

1. **`2.014e18` was refused** - the spec permits a decimal mantissa with an
   exponent; the amount pattern only allowed an integer mantissa.
2. **`gasPrice` was lower-cased in canonical output** - the spec spelling is
   `gasPrice`; a "canonical" form that is not the spec spelling is not canonical.
3. **`1.5` base units silently became `1n`** - a fixed-point amount must be
   refused unless it is a whole number of base units. This one was introduced by
   fix #1 and caught by the same vectors that prompted it.

Fixing #1 and #2 created #3. That is the argument for running vectors against
your own implementation, not only publishing them.

## EIP-681 conformance corpus (machine-readable)

`vectors/eip681.conformance.json` + `run-conformance.mjs` — a drop-in conformance
suite for any EIP-681 parser, written because the failure modes that actually cost
users money are not in the happy path.

```
node run-conformance.mjs                 # test the bundled parser (10/10)
node run-conformance.mjs ./your-parser.mjs   # test YOUR parser
```

Your parser must export `parse(uri) -> { ok, scheme, target, chainId, functionName,
params, recipient, amount, errors, canonical }` — see `parser_interface` in the JSON.

The three vectors that matter most, and why:

- **`erc20-transfer`** — for `ethereum:<TOKEN>@8453/transfer?address=<PAYEE>&uint256=…`,
  the segment after `ethereum:` is the **token contract**, not the payee. The payee is
  the `address` param. A scanner that treats the first address as the recipient sends
  funds to the contract. Wallets without function-call support fail *silently and
  wrongly*, not loudly.
- **`accept-all-lowercase` vs `reject-bad-mixedcase`** — the same 20 bytes, two casings,
  opposite verdicts. All-lowercase carries no EIP-55 claim → accept. Mixed case is an
  explicit claim → a failed claim is a hard reject. This pair is the test.
- **`native-no-chain`** — absent `@chainId` means "current chain", *not* chain 1.
  Defaulting it to 1 turns a "whatever chain" intent into a mainnet transfer.

Run it before you ship a QR scanner. It found two real defects in this repo's own
parser and one in its fixtures — the suite is worth more than the code it tests.

## Run it in your CI in three lines

Any repo that parses or emits EIP-681 URIs can adopt the corpus as a GitHub Action.
No dependencies, no config beyond the path to your parser:

```yaml
- uses: 469536968-svg/eip681-kit@main
  with:
    parser: ./src/parse-uri.mjs   # must export parse(uri)
```

A failing run prints which vector failed, **the URI**, the expected value, and what
your parser actually returned — e.g.:

```
FAIL reject-bad-mixedcase
     uri: ethereum:0xFB6916095ca1df60bB79Ce92cE3Ea74c37c5d359
     expected REJECT, got accept -> {"ok":true,"target":"0xFB6916...","errors":[]}
     expected error 'bad-checksum', got []
```

Outputs `passed` / `failed` are set, so you can gate on them. The action exits `2`
for setup errors (so a broken path never looks like a passing suite) and `1` for
real vector failures.

Run it locally the same way:

```bash
node run-conformance.mjs ./your-parser.mjs          # human-readable
node run-conformance.mjs ./your-parser.mjs --json   # machine-readable
node run-conformance.mjs ./your-parser.mjs --vectors ./my-extra-vectors.json
```

### Expected parser interface

Your module must export `parse(uri)` returning:

```js
{ ok, scheme, target, chainId, functionName, params, recipient, amount, errors }
```

`ok:false` plus `errors:[{code,message}]` is how a rejection is reported. For a worked
adapter, see `adapters/` — each one wires a third-party parser into this shape.
