# VERIFIED — `from_*_request_parts` returns `Ok(Unrecognised)` for over-length addresses

**Measured, not argued.** `cargo test` against `zcash/librustzcash` `components/eip681`
@ `7a2504de3c` (PR #3062 applied).

Reproductions in this directory:
- [`constructor_outcomes.rs`](./constructor_outcomes.rs) — the outcome matrix
- [`raw_bypass.rs`](./raw_bypass.rs) — the correction below

---

## ⚠️ CORRECTION (2026-09-29): my earlier "bounded" claim was WRONG

In the comment at
[zcash/librustzcash#3062 (id 5883601359)](https://github.com/zcash/librustzcash/pull/3062#issuecomment-5883601359)
I wrote that the damage was bounded because:

> on the `Unrecognised` value both `as_native()` and `as_erc20()` are `None`, so nothing
> invalid can reach a signature.

**The first half is true. The conclusion does not follow.** `RawTransactionRequest` is
reachable via `into_raw()`, and it carries the over-length address **verbatim**:

```
--- native ---
raw = RawTransactionRequest {
    schema_prefix: SchemaPrefix { prefix: "ethereum", has_pay: false },
    target_address: Address(
        HexDigits {
            places: "aaaa…(128 hex digits)…aaaa",
        },
    ),
    ...
}

--- erc20 ---
    target_address: Address(
        HexDigits { places: "bbbb…802" },
    ),
    ...
            AbiType(
                EthereumAbiTypeName { name: "address" },
                Address(
                    Address(
                        HexDigits { places: "aaaa…(128 hex digits)…aaaa" },
```

Measured string lengths in that output: **128 digits**, twice. `test result: ok. 1 passed`.

So `as_native()` / `as_erc20()` returning `None` prevents the *typed* path from seeing an
invalid request. It does **not** prevent a caller from obtaining the invalid address —
`.into_raw().target_address` hands it over with no error.

### What I now claim, and what I do not

| claim | status |
|---|---|
| 41/64/65/128 hex digits → `Ok(Unrecognised(..))`, never `Err` | **measured** |
| `as_native()` / `as_erc20()` are `None` on that value | **measured** |
| the invalid address survives verbatim in `into_raw()` | **measured** (above) |
| "nothing invalid can reach a signature" | **RETRACTED** — I did not measure the signer |

The retracted line asserted a property of a code path (`parse → sign`) that I never
executed. I inferred it from the accessors being `None` and stated it as fact. That is
the same failure mode as the four earlier ones in this kit: **a structural reading
presented as a measurement.**

### What remains genuinely unknown

Whether the real signing path consumes `as_native()`/`as_erc20()` (in which case an
over-length address still cannot be signed) or reads the raw struct (in which case it
can). I have not traced the signer. Until someone does, the honest severity statement is
**"an unvalidated address escapes the constructor with no error signal, and is reachable
from at least one public API"** — no more.

---

## The original finding (unchanged, still measured)

`TransactionRequest::parse` returns `Unrecognised` for "valid via EIP-681, but
unrecognised". Reasonable for `parse`. But `from_native_request_parts` and
`from_erc20_request_parts` both end in `Self::parse(&req)` (`request.rs:98`), so they are
*constructors* whose `Result` promise "build me a request, or tell me why you can't".

| input | `from_*_request_parts` / `parse` returns |
|---|---|
| exactly **40** hex digits | `Ok(Erc20Request)` / `Ok(NativeRequest)` |
| **41, 64, 65, 128** hex digits | `Ok(Unrecognised(..))` — **success-shaped, never `Err`** |

Both positions (native recipient, ERC-20 token contract) behave identically.

```rust
let req = TransactionRequest::from_erc20_request_parts(..)?;  // no signal at all
```

## Status of the PR #3062 thread

- `to_erc55_validated_string` has three call sites; the PR's test originally covered the
  native recipient and the ERC-20 `address=` parameter but not the token contract
  (`request.rs:389`). The author confirmed the gap and extended the test to all three over
  41..64 digits, **failing without the fix**.
- Under-length (1..39) never reaches the changed arm — `AddressOrEnsName::parse` enforces
  `parse_min(40)`. Independently reproduced; consistent with the author's explanation.
- The `Ok(Unrecognised)` shape is pre-existing and out of scope for PR #3062. The author's
  call to keep it out of that PR is defensible.
