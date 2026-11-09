/**
 * Proposed guard for vultisig/vultisig-sdk#2495, written as a plain ES module so it
 * can be EXECUTED here without the pnpm workspace or wallet-core WASM. The `.ts`
 * version in the patch is a 1:1 transcription of this file (types added, body
 * identical). The test suite imports THIS module, so what was run is what is proposed.
 */

export class SelfTransferError extends Error {
  constructor(token, to) {
    super(
      `refusing an ERC-20 transfer to the token's own contract address ` +
        `(token=${token}, to=${to}); no key controls a contract address, so the ` +
        `tokens would be unspendable`
    )
    this.name = 'SelfTransferError'
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
export const isAddressLike = s => typeof s === 'string' && ADDRESS_RE.test(s)

/**
 * Rejects an ERC-20 `transfer` whose recipient is the token contract itself.
 *
 * Returns void and never throws for anything other than the self-transfer case, so
 * it is safe to place on the shared signing path:
 *  - native sends have no token contract at all (`contractAddress` is undefined),
 *  - a payload with no `coin` is rejected elsewhere, not here,
 *  - a recipient that is not a 40-hex address is a different validation's problem.
 *
 * Comparison is case-insensitive because a link or an RPC response may deliver the
 * same address with different casing; addresses are not case-significant.
 */
export const assertErc20TransferNotSelf = ({ coin, toAddress }) => {
  if (!coin) return
  if (coin.isNativeToken) return
  const token = coin.contractAddress
  if (!token) return
  if (!isAddressLike(token) || !isAddressLike(toAddress)) return
  if (token.toLowerCase() === toAddress.toLowerCase()) throw new SelfTransferError(token, toAddress)
}
