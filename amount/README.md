# amount/ — exact EIP-681 amount parsing

Integer-only parser for EIP-681 `value=` and ERC-20 `uint256=` amounts.
No `Number`, no `Double`, no floating point anywhere on the value path.

```js
import { parseAmount, formatAmount } from './eip681-amount.mjs';

parseAmount('2.014e18')                    // { ok: true, units: 2014000000000000000n }
parseAmount('1.5',       { decimals: 6 })  // { ok: true, units: 1500000n }   <- USDT
parseAmount('1.5',       { decimals: 18 }) // { ok: true, units: 1500000000000000000n }
parseAmount('0.1')                         // { ok: false, reason: 'fraction-of-a-unit' }
parseAmount('-1')                          // { ok: false, reason: 'negative' }
parseAmount('0x10')                        // { ok: false, reason: 'hex-not-allowed' }
```

## Why `decimals` is not optional

"Accepted only when the result is a whole number of wei **or token units**"
is unenforceable without knowing the token's decimals. `value=1.5` has no
wei representation but is exactly `1500000` base units of a 6-decimal token.
Pass `decimals: 0` for base-unit input (an ERC-20 `uint256` from calldata);
pass the token's decimals for a decimal URI amount.

The distinction is load-bearing and silent: parsing the base-unit integer
`1500000` at `decimals: 6` does not error — it returns `1500000000000`,
a 10^6 inflation.

## Why not `parseFloat`

Measured divergences between exact BigInt arithmetic and the naive `Number` path:

| input | exact | naive double |
|---|---|---|
| `9007199254740993` (2^53+1) | 9007199254740993 | …992 |
| `21000000000000000001` | 21000000000000000001 | …000 |
| `1.000000000000000001e18` | 1000000000000000001 | 1000000000000000000 |

## Refusal reasons

`empty`, `syntax`, `negative`, `hex-not-allowed`, `fraction-of-a-unit`,
`exceeds-uint256`, `exponent-out-of-range`, `bad-decimals`, `not-a-string`.

Distinct reasons on purpose: "too large" and "not a whole number" are
different messages to a user.

## Tests

```
node amount/eip681-amount.test.mjs
```

52 assertions, including a differential that proves the exact path is
load-bearing rather than merely passing, and a round-trip identity check.
```
