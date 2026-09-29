# tools/

## check_unrecognised.mjs

Flags Rust call sites of `TransactionRequest::from_native_request_parts` /
`from_erc20_request_parts` where the `Result` is consumed by `?` / `unwrap` /
`expect` without any narrowing.

**Why:** both constructors end in `Self::parse(&req)`, and `parse` returns
`Ok(Unrecognised(..))` — not `Err` — for over-length addresses. Measured against
`zcash/librustzcash` @ `7a2504de3c`: 40 hex digits → `Ok(Erc20Request)`; 41, 64, 65,
128 digits → `Ok(Unrecognised(..))`. A caller using `?` therefore gets no signal.

Bounded, and the lint says so: on `Unrecognised`, `as_native()` and `as_erc20()` are
both `None`, so nothing invalid reaches a signature.

```bash
node tools/check_unrecognised.mjs path/to/src
# exit 0 = clean, exit 1 = review these call sites, exit 2 = usage error
```

Deliberately *not* flagged: propagation followed by `as_native()` / `as_erc20()`,
because narrowing **is** handling. Line/window heuristic — it points at places to
review, it does not prove a bug.
