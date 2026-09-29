# Control-flow property of `AddressOrEnsName::to_erc55_validated_string` at a pinned revision

**Status of this evidence: SOURCE-READ + EXECUTED-PORT.** This is *not* a `cargo test`
run. No Rust binary can link on the host where this was produced (mingw `dlltool`
cannot create import libraries for proc-macro build scripts), so no claim of a
compiled-binary run is made anywhere in this repository.

## What was done

`validate_erc55`, `to_erc55_validated_string`, and the `0x` address grammar were
transcribed verbatim from the pinned source into `eip681_address_len_port.mjs`, then
executed under Node. The Keccak-256 used by the checksum is self-checked before use
against the official vectors (`""`, `"abc"`, the fox sentence) and all four canonical
EIP-55 vectors.

## The property

`validate_erc55` rejects a wrong length:

```rust
snafu::ensure!(self.places.len() == 40, IncorrectEthAddressLenSnafu { len: self.places.len() });
```

but `to_erc55_validated_string` tests the error with `if let Err(ValidationError::Erc55Validation { reason })`.
Because `IncorrectEthAddressLen` is a *different* variant, it does not match the
pattern, control falls into the `else`, and an over-length hex string is returned
as a valid ERC-55 address. The grammar is `preceded(tag("0x"), HexDigits::parse_min(40))`
— a minimum, with no maximum.

## Measured

| digits | at pin | with the `match` rewrite |
|---|---|---|
| 38–39 | rejected by grammar | rejected by grammar |
| 40 | accepted | accepted |
| 41–64 | accepted (25/25) | rejected (24/25) |

Controls: genuine EIP-55 address accepted by both; all-lowercase 40-digit accepted
by both; the same address plus one extra digit flips `Ok` -> `IncorrectEthAddressLen`.

## Why it matters to a caller

`from_native_request_parts` / `from_erc20_request_parts` build a URI and re-parse it,
so a bad-length address surfaces as `Ok(Unrecognised(..))`, never `Err`. A caller
using `?` sees no error at all. There are three call sites of
`to_erc55_validated_string`, not two: the native recipient, the ERC-20 `address=`
parameter, and the ERC-20 **token contract** address.

Run it: `node eip681_address_len_port.mjs`
