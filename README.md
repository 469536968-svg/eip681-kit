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
