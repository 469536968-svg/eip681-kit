# VERIFIED — `from_*_request_parts` returns `Ok(Unrecognised)` for over-length addresses

**Measured, not argued.** Two runs of `cargo test` against
`zcash/librustzcash` `components/eip681` @ `7a2504de3c` (PR #3062 applied).
Reproduction file: [`constructor_outcomes.rs`](./constructor_outcomes.rs).

## Why the question matters

`TransactionRequest::parse` is documented as returning the `Unrecognised` variant when a
URI is "valid via EIP-681, but unrecognised". That is a reasonable design for `parse`.

But `from_erc20_request_parts` and `from_native_request_parts` both end in
`Self::parse(&req)` (request.rs:98, and the native equivalent). They are *constructors*:
the name and the `Result` return type promise "build me a request, or tell me why you
can't". So the variant returned by `parse` **is** the variant returned by the
constructors — there is no second validation step.

## Measured matrix

Same test file, one run:

| input | `from_*_request_parts` / `parse` returns |
|---|---|
| exactly **40** hex digits | `Ok(Erc20Request)` / `Ok(NativeRequest)` |
| **41, 64, 65, 128** hex digits | `Ok(Unrecognised(..))` — **success-shaped, never `Err`** |

Both address positions (native recipient and ERC-20 token contract) behave identically.

## Why this is worth recording

The idiomatic Rust error path is the `?` operator:

```rust
let req = TransactionRequest::from_erc20_request_parts(..)?;   // no signal at all
```

A 128-digit token contract address is not a transaction any chain will sign. Yet the
constructor reports success, and `?` propagates that success. The failure is not lost so
much as *mislabelled*.

## Bounded damage — what does NOT go wrong

On the `Unrecognised` value, both typed accessors refuse:

```
as_native() = false
as_erc20()  = false
```

So a caller cannot obtain a `NativeRequest` or `Erc20Request` from it. Nothing
downstream can mistake it for a signable request, and no invalid address reaches a
signature. **The misdirection is confined to the `Result` itself** — which is a
soundness-of-API question, not a fund-safety one.

This is why it is reported as a record rather than a defect claim: the user-visible
outcome is correct, the type-level signal is not. The upstream author has stated it is
pre-existing and out of scope for PR #3062, which is a defensible call.

## Status of the PR #3062 thread

- `to_erc55_validated_string` has **three** call sites; the PR's test covered the native
  recipient and the ERC-20 `address=` parameter but not the token contract
  (request.rs:389). The author confirmed the gap and extended the test to all three,
  over 41..64 digits, failing without the fix.
- Under-length (1..39) never reaches the changed arm — `AddressOrEnsName::parse`
  enforces `parse_min(40)`. Independently reproduced here; consistent with the author's
  explanation.
