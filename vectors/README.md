# vectors/ — EIP-681 conformance vectors

Language-agnostic. Consumed by `conform.mjs` (JavaScript) and `conform.py`
(Python). Any language can read the JSON directly; the runners are conveniences,
the file is the artifact.

```json
{
  "reference": "https://eips.ethereum.org/EIPS/eip-681",
  "vectors": [
    {
      "id": "spec-native-value-sci",
      "spec": true,
      "why": "Real-world consequence of getting this wrong.",
      "input": "ethereum:0x...@1?value=2.014e18",
      "expect": { "ok": true, "amount": "2014000000000000000" }
    }
  ]
}
```

## Vector fields

| Field | Meaning |
|---|---|
| `id` | Stable identifier. Used in failure output; do not renumber. |
| `spec` | `true` if the vector is derived directly from the EIP-681 text or a canonical EIP-55 vector. Runners report a separate `spec-derived` score, because passing only your own invented cases proves little. |
| `why` | The real-world consequence of getting this vector wrong. This is the part a pass count omits. |
| `input` | The URI string. |
| `expect` | Assertions. Every key is compared against the adapter's normalised output. |

## `expect` keys

| Key | Comparison |
|---|---|
| `ok` | Does the implementation accept the URI. |
| `scheme`, `target`, `chainId`, `functionName`, `isTokenTransfer`, `recipient`, `gasLimit`, `gasPrice`, `canonical` | Exact match on the normalised field. |
| `amount`, `amountMustBeWeiString` | Amount in **base units, as a decimal string**. Never compare amounts as floats — `2^256-1` and `2.014e18` both round incorrectly through a double. |
| `checksumValid` | `true` only when the address is mixed-case **and** the EIP-55 checksum verifies. |
| `checksumAbsent` | `true` when there is no case information (all-lower or all-upper), so no checksum claim was made. |
| `errorCodes` | Codes that MUST be present in the implementation's errors. Order-independent; extra codes are allowed. |
| `warningCodes` | Codes that MUST be present in the implementation's warnings. |

## Rules for a conforming implementation

1. **A missing assertion is a failure.** If a vector asserts `checksumValid` and
   your output has no such field, that is a `FAIL`, not a skip. An implementation
   that cannot report `checksumValid` cannot be trusted to have checked it.
2. **Error codes are identifiers, not prose.** Raise them, do not print them.
   Extra codes are tolerated; missing ones are not.
3. **Amounts are base units.** If your API returns `"1e18 wei (native)"` you have
   made the amount unusable to a program. Return `"1000000000000000000"`.
4. **Mixed case is an EIP-55 claim.** If the claim fails, the input is malformed.
   See `bad-mixed-case-checksum`.
5. **All-lowercase is not a claim.** It carries no case information, so it cannot
   be wrong. See `all-lowercase-is-not-a-checksum-claim`.

## Why these vectors exist

They were written from the spec text rather than from any one implementation's
behaviour, and they immediately found three genuine defects in the kit they were
first run against: a refused `2.014e18`, a canonical output that lower-cased
`gasPrice`, and — introduced by fixing the first — `1.5` base units silently
becoming `1`. Fixing one created another; the vectors caught both.

Run them against your own implementation. Publishing vectors is easy; being
changed by them is the useful part.
