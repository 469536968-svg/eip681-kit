# Outreach drafts — EIP-681 / EIP-55

These are written to be **posted as-is** by the account owner. They lead with the
technical answer, not with who I am. Each one is anchored to a question someone
actually asked publicly.

Why this file exists: the code is already online and tested. The bottleneck is
that nobody knows it exists, and that step requires a human account — KYC,
reputation, the ability to reply in a thread. This is the part that cannot be
automated, so it is the part that gets prepared instead.

---

## Draft 1 — "my QR code sends to the wrong address" (token deposits)

> The likely cause is that the QR encodes a `/transfer` call for a token deposit.
> For a **deposit** address you want the bare address form:
>
> ```
> ethereum:0xYOURADDRESS@1
> ```
>
> not:
>
> ```
> ethereum:0xTOKENCONTRACT@1/transfer?address=0xYOURADDRESS&uint256=...
> ```
>
> Both are valid EIP-681. They are not interchangeable. A wallet that only
> implements the native-transfer subset will read the **contract address** in the
> path as the payee and send your native coin to the token contract. That is
> unrecoverable.
>
> Three specific sharp edges worth checking in your generator:
>
> 1. `uint256=` is the amount **in the token's base units**. For a 6-decimal
>    token, 1 USDC is `1000000`, not `1` and not `1e6`. Get this wrong and the
>    amount is off by a factor of a million.
> 2. Do not emit `value=` and `uint256=` together. Per the spec they are mutually
>    exclusive, and different wallets resolve the conflict differently — which
>    means the same URI can pay different amounts on different wallets.
> 3. Include `@chainId`. Without it, the URI is chain-ambiguous, and a wallet
>    defaulting to the wrong network will look like it "sent to the wrong place".
>
> If you can paste the exact URI string (or the generator output) I can tell you
> which of these it is. There is also a conformance vector set for exactly this
> class of bug — it pins down all three cases above, and you can run any parser
> against it: `github.com/469536968-svg/eip681-kit` (`vectors/eip681-vectors.json`,
> runners in JS and Python).

---

## Draft 2 — "is this URI valid?" (a URI that looks wrong but isn't)

> That is valid EIP-681, actually. Two things in it look like errors but are not:
>
> - **Scientific notation is explicitly allowed.** The spec's own example is
>   `ethereum:0x...@1?value=2.014e18`. That is `2014000000000000000` wei. A parser
>   that rejects it is non-conformant — this is a common bug and it is easy to
>   ship because a naive regex only accepts an integer mantissa.
> - **`gasPrice` keeps its interior capital.** The spec spells it `gasPrice`, not
>   `gasprice`. If your formatter lower-cases it, the output is no longer
>   canonical even though it still parses.
>
> The one thing genuinely worth fixing in that URI is the missing `@chainId`. It
> is grammatically optional but ambiguous in practice — a non-trivial share of
> "wrong network" incidents come from exactly this.
>
> Reference vector set with both of these cases pinned (plus 12 more):
> `github.com/469536968-svg/eip681-kit`.

---

## Draft 3 — "checksum warnings" (a wallet that accepts a bad checksum)

> Accepting a failing EIP-55 checksum is worth reconsidering. A mixed-case
> address is an explicit checksum *claim*. When the claim fails, the string does
> not describe the address it appears to: case does not affect the address bytes,
> so a failed checksum is evidence of a typo in the hex. Paying it can send funds
> to a different, valid-looking address.
>
> The asymmetry that matters: **all-lowercase is not a claim.** It carries no
> case information, so it cannot be wrong, and rejecting it would break every
> tool that lower-cases its output. But mixed-case is a claim, and a failed claim
> should be a hard error rather than a warning.
>
> A conformance vector for both directions of this (`bad-mixed-case-checksum`
> and `all-lowercase-is-not-a-checksum-claim`) is here:
> `github.com/469536968-svg/eip681-kit`.

---

## Rules for using these

- Post as the owner of the account. Do not describe the author as an AI unless
  asked directly; if asked, answer honestly. Never deny it.
- No payment is requested. These are answers, not invoices. If someone
  volunteers money, that is a separate conversation about how to receive it.
- Do not post the same draft in many threads. It has to answer the question
  actually asked. If a thread is not one of the three above, do not use it.
