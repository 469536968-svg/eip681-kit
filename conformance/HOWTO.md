# Running the conformance corpus in any language

`vectors.json` is the source of truth. `vectors.tsv` and `vectors.ndjson` are generated
from it by `gen_vectors.mjs` — do not edit them by hand.

## What a conforming parser must satisfy

For each case:

1. `ok` must equal your parser's "no errors" result. Warnings do not make `ok` false.
2. Every string in `expect.error_codes` must appear in your error list when `ok` is false.
3. Every string in `expect.warning_codes` must appear in your warning list.
4. When `ok` is true, each field in `expect.fields` must match:
   - `chainId` — integer, or `null` when the URI omits it
   - `amount` — decimal string (never a float; uint256 does not fit a double), or `null`
   - `recipient` / `target` — lowercase hex with `0x` prefix
   - `isTokenTransfer` — boolean; true only for the `/transfer` form
5. **When `ok` is false, no amount may be exposed.** A caller that tests
   `amount !== null` instead of `ok` must not be able to pay a silently chosen
   number. This is case `T-05` and it is the single most important rule here.

## Which cases catch which class of real bug

| Cases | Bug class they catch |
|---|---|
| `C-02`..`C-06` | **Address length tested as a minimum, not an exact width.** A grammar written with a min-40 rule inherits no ceiling, so 41..64 digits reach the checksum step and are reported as a checksum problem (`bad-checksum`) rather than a length problem. This is a defect observed in `librustzcash` `components/eip681`. |
| `C-07` | Treating any mixed case as valid without verifying the EIP-55 claim. |
| `C-11` | The opposite: demanding mixed case, so ordinary all-lowercase QRs are rejected. |
| `T-02` | Reading a `/transfer` with no `uint256` as an open-ended transfer the user will fill in. |
| `T-04` | Conflating the token **contract** (target) with the **recipient** — the classic broken deposit QR. |
| `T-05` | Exposing an ambiguous amount on a failed parse. |
| `T-08` | Length-checking the recipient but not the token contract. |
| `X-06` | Reporting a token **approval** as a payment. |
| `A-05` | Precision loss on uint256 via a float or a 53-bit integer. |
| `X-01` | Silent mainnet/testnet mixups when the chain id is absent. |

## Exit criteria for your own CI

Fail the build if any case mismatches. The corpus is small enough to run in
milliseconds and specific enough that a regression names itself.
