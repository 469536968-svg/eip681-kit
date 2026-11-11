# Issue #3026 item 6 — ERC-20 path silently discards an unrepresentable chain id

Compiler-verified on a local clone of `zcash/librustzcash` `components/eip681`.

> All line numbers in this document were measured against upstream
> `main` blob `f3a80400` (29876 bytes), not inferred from a local clone.

Source-verified at upstream `main` (`0495aa63f430813a36d2ea6dd4e81c29c00a8ffa`).

Two trees were used, and they are **not** the same tree. Both are named below
because a claim is only worth the tree it was measured on.

| tree | identity | `request.rs` | what it gave |
|---|---|---|---|
| local clone (executed) | `components/eip681` crate dir | 25181 B, 674 lines | the control table |
| upstream `main` (read) | `0495aa63f430813a36d2ea6dd4e81c29c00a8ffa` | 29876 B | confirms it is still present |

At upstream `main`, `Erc20Request` has **no cached `chain_id` field at all**:

```rust
// upstream main, components/eip681/src/request.rs:378-389
pub struct Erc20Request {
    /// Validated token contract
    token_contract_address: String,
    /// Validated recipient
    recipient: String,
    /// Validated atomic value
    value_atomic: U256,

    /// The original parsed request that the validated values
    /// originated from.
    inner: RawTransactionRequest,
}
```

Every other field is described as *Validated*. `chain_id` is absent, so the
accessor has to re-derive it on each call and throws the error away:

```rust
// upstream main, components/eip681/src/request.rs:506-509
pub fn chain_id(&self) -> Option<u64> {
    let digits = self.inner.chain_id.as_ref()?;
    digits.as_u64().ok()          // ValidationError discarded
}
```

Note that the file contains **two** `chain_id` accessors — `NativeRequest` at
`request.rs:299` and `Erc20Request` at `request.rs:506`. Only the second discards
the error, and the two are 200 lines apart, which is why this is easy to miss
when reading the file top-down.

`NativeRequest` does the opposite — it validates once, at construction:

```rust
// upstream main, components/eip681/src/request.rs:236-240
chain_id: if let Some(chain_id_digits) = raw.chain_id.as_ref() {
    Some(chain_id_digits.as_u64().context(ChainIdInvalidSnafu)?)
} else {
    None
},
```

And `Erc20Request::try_from` never mentions `chain_id` — measured, not assumed:
`mentions chain_id: false` over its full body.

## Why this is a real defect and not a style preference

`None` already means *"the URI did not specify a chain id"*. Returning `None`
for *"the URI specified one that cannot be represented as a `u64`"* makes two
different facts indistinguishable, and most callers read `None` as mainnet.

## The control table

Same test file, same crate, same toolchain (`cargo 1.98.1`, `stable-x86_64-pc-windows-gnu`).

```
BEFORE fix (pristine tree)
  test erc20_valid_chain_id_still_round_trips .............. ok
  test measure_what_current_code_does ...................... ok
  test erc20_chain_id_overflow_never_surfaces_as_none ...... FAILED
  test native_and_erc20_paths_agree_on_overflow ............ FAILED
  test result: FAILED. 2 passed; 2 failed

  [MEASURE] variant               = Erc20Request
  [MEASURE] chain_id()            = None
  [MEASURE] native path rejects/errors on 2^64: true
  [MEASURE] erc20 path returns None on 2^64: true

AFTER fix
  test erc20_chain_id_overflow_never_surfaces_as_none ...... ok
  test native_and_erc20_paths_agree_on_overflow ............ ok
  test measure_what_current_code_does ...................... ok
  test erc20_valid_chain_id_still_round_trips .............. ok
  test result: ok. 4 passed; 0 failed

  [MEASURE] variant               = Unrecognised
  [MEASURE] erc20 path returns None on 2^64: false

REGRESSION
  cargo test --lib -p eip681 ............................... 50 passed; 0 failed
```

The two failures **before** the fix are the point. A test that cannot fail
proves nothing, so the suite is written to assert the desired behaviour and was
executed against the unpatched tree first.

`erc20_valid_chain_id_still_round_trips` is the positive control: it pins
`@1 -> Some(1)` and `@18446744073709551615 -> Some(u64::MAX)`, so the suite
cannot be satisfied by simply rejecting everything.

## The fix

Give `Erc20Request` the same cached, validated field `NativeRequest` already has.
Three edits, no accessor hack:

```rust
// 1. struct — add the field every sibling field already has
pub struct Erc20Request {
    chain_id: Option<u64>,
    token_contract_address: String,
    // ...
}

// 2. constructor — validate once, like the native path
let chain_id = if let Some(chain_id_digits) = raw.chain_id.as_ref() {
    Some(chain_id_digits.as_u64().context(ChainIdInvalidSnafu)?)
} else {
    None
};

Ok(Erc20Request {
    chain_id,
    token_contract_address: raw.target_address.to_erc55_validated_string()?,
    // ...
})

// 3. accessor — return the field, stop re-deriving
pub fn chain_id(&self) -> Option<u64> {
    self.chain_id
}
```

`ChainIdInvalidSnafu` and `ChainIdInvalid { source: ValidationError }` already
exist in the tree (`error.rs:222`), so this needs no new error variant.

## The trap

After the fix, `TransactionRequest::parse` returns **`Ok(Unrecognised(raw))`,
not `Err(...)`**. That is expected: the dispatch chain is

```rust
if let Ok(native_req) = NativeRequest::try_from(&raw) { return Ok(...) }
if let Ok(erc20_req)  = Erc20Request::try_from(&raw)  { return Ok(...) }
Ok(TransactionRequest::Unrecognised(raw))
```

so a rejected chain id falls through to `Unrecognised` by design. Two consequences
for anyone testing this:

- An assertion written as `parse(uri).is_err()` will **not** pass, before or after.
  The behaviour that changes is the *variant* and whether `chain_id()` lies.
- Callers that do `req.as_erc20().unwrap()` on an over-long chain id now panic
  where they previously got a request with a confident-looking `None`. That is a
  behaviour change and belongs in the PR description.

## Length of the reproducing input

`18446744073709551616` (2^64) is `u64::MAX + 1`. Anything at or above it works;
`18446744073709551615` (`u64::MAX`) must still round-trip exactly, which is what
the positive control asserts.

## Files

- `erc20_chain_id_overflow.rs` — the four tests; drop into `components/eip681/tests/`.
  Contains one placeholder, `CRATE_PATH_HERE`, because the crate is named `eip681`
  in this tree but the upstream module path may differ; substitute the correct
  `use <crate>::TransactionRequest;` line before running.
- `apply_fix.cjs` — applies the three line-based edits and re-runs both suites.
  Anchors on line numbers rather than `\n` because the tree is CRLF.
