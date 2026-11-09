# vultisig/vultisig-sdk#2495 — executable specification

An ERC-20 `transfer` whose recipient is the token's own contract burns the tokens.
No key controls a contract address, so the funds are unrecoverable.

This directory holds a **runnable** version of the proposed reject, plus a suite that
executes it. Nothing here is a paraphrase: the test imports the same module body that
the patch proposes.

```
node eip681-kit/vultisig/erc20SelfTransferGuard.test.mjs     # 17 assertions, exit 1 on failure
```

Last run: **17 passed, 0 failed.**

## The guard

```js
export const assertErc20TransferNotSelf = ({ coin, toAddress }) => {
  if (!coin) return
  if (coin.isNativeToken) return
  const token = coin.contractAddress
  if (!token) return
  if (!isAddressLike(token) || !isAddressLike(toAddress)) return
  if (token.toLowerCase() === toAddress.toLowerCase()) throw new SelfTransferError(token, toAddress)
}
```

Four properties are deliberate, and each has a test and a failing control:

1. **Case-insensitive comparison.** A link, a relayed `KeysignPayload`, and an RPC
   response can each deliver the same address with different casing. Exact `===`
   comparison (control **N1**) leaks a lower-cased self-transfer.
2. **Native sends are skipped, not crashed on.** `coin.isNativeToken` has
   `contractAddress: undefined`. The literal fix written in the issue text —
   `toAddress.toLowerCase() === coin.contractAddress.toLowerCase()` — throws
   `TypeError: Cannot read properties of undefined` on every native ETH send
   (control **N2**) and on a payload with no `coin` at all (control **N3**).
3. **Non-address recipients are not this function's problem.** A guard that throws on
   `''`/`null`/`0xdeadbeef` turns a separate validation failure into a crash on the
   signing path. Test **T8**.
4. **One nibble of difference is a real payment.** `...eB48` vs `...eB49` must not be
   refused (**T5**). Over-matching would block legitimate transfers.

## Why the placement matters

`approve(spender, amount)` legitimately sets its destination to the **token contract**
— that is what the ERC-20 approval targets. A guard wired into a shared
`getToAddress()` that does not distinguish the arms will refuse every approval.

The fix therefore belongs on the `transfer` arm, where the destination is a payee.
The suite asserts the shape of that hazard in **T7**: it pins that the approve path's
destination *is* the contract address, so putting the guard there would throw. That
test is a guardrail against the wrong placement, not a claim that the current code
places it there — I have not executed vultisig's `approve` arm, only the invariant it
has to satisfy.

## The EIP-681 half of the bug, reproduced with a real parser

The issue notes a second route: a link whose recipient resolves to the token contract.
That is reproducible without any vultisig code, using
[`eip681-kit`](https://github.com/469536968-svg/eip681-kit) as the parser:

```
ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48@1/transfer?address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&uint256=1000000
```

A correct parser keeps the two roles in separate fields — `target` is the address in
the scheme position (the token contract), `recipient` is the `?address=` payee.
`parse()` returns:

```
target    : 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
recipient : 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
amount    : 1000000n
```

`target == recipient` **is** the self-transfer shape, and it is a *valid* URI — the
parser accepts it because it is well-formed, not because it is safe to sign. So the
parse layer cannot be the only defence: a resolver that takes the leading address
instead of the `address` parameter produces exactly this object, and only the signing
path can refuse it.

Tests **T12** (self-addressed link → refused) and **T13** (ordinary link → allowed)
run that end to end through the real parser, asserting `target` and `recipient`
differ in the ordinary case and are equal in the broken one. T13 is the negative
control: the same code path must *not* refuse a link addressed to a real payee.

## Reproducing the on-chain case

The issue cites `0xc27e81ac…d92f4d`, a `USDC.transfer(USDC_contract, 8000)` that only
reverted because USDC blocks self-transfers. On a token without that guard the same
call would have moved the balance to an address no key controls.
