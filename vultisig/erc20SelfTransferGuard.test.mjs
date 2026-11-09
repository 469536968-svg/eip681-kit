/**
 * vultisig/vultisig-sdk#2495 — executable specification.
 *
 * Imports the guard from erc20SelfTransferGuard.mjs, i.e. THE SAME BODY that is
 * proposed in the patch. Nothing here is a paraphrase of the fix.
 *
 * Run: node vulti-self-transfer-guard.test.mjs   (exit 1 on failure)
 */
import assert from 'node:assert/strict'
import {
  SelfTransferError,
  assertErc20TransferNotSelf,
  isAddressLike,
} from './erc20SelfTransferGuard.mjs'
import { parse } from '../index.mjs'

// JSON.stringify throws on BigInt. A message constructor that throws turns a PASS
// into something that looks like a FAIL, so all diagnostics go through `show`.
const show = v => {
  try {
    return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x))
  } catch {
    return String(v)
  }
}

// ---- real chain data, real EIP-55 casing -------------------------------------
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // EIP-55 checksummed, real
const USDC_LOWER = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDC_UPPER_BODY = '0x' + USDC.slice(2).toUpperCase()
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const PAYEE = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359' // EIP-55 canonical vector #2
const NEAR_MISS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49' // one nibble different

// ---- the two naive fixes, as negative controls --------------------------------
const guardNoLowercase = ({ coin, toAddress }) => {
  if (!coin || coin.isNativeToken) return
  const token = coin.contractAddress
  if (!token) return
  if (token === toAddress) throw new SelfTransferError(token, toAddress)
}

const guardLiteralFromIssue = ({ coin, toAddress }) => {
  if (toAddress.toLowerCase() === coin.contractAddress.toLowerCase()) {
    throw new SelfTransferError(coin.contractAddress, toAddress)
  }
}

// the approve arm's destination (erc20.ts: `toAddress: coin.contractAddress`)
const approveDestination = coin => coin.contractAddress

// ---- harness -----------------------------------------------------------------
let pass = 0
const cases = []
const run = (name, fn) => {
  try {
    fn()
    pass++
    cases.push(['PASS', name])
  } catch (e) {
    cases.push(['FAIL', name + ' :: ' + e.message.split('\n')[0].slice(0, 150)])
  }
}

const usdcCoin = { chain: 'Ethereum', ticker: 'USDC', isNativeToken: false, contractAddress: USDC }
const ethCoin = { chain: 'Ethereum', ticker: 'ETH', isNativeToken: true, contractAddress: undefined }

run('T1 self-transfer (checksummed == checksummed) is refused', () => {
  assert.throws(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: USDC }), SelfTransferError)
})
run('T2 self-transfer with lower-cased destination is refused', () => {
  assert.throws(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: USDC_LOWER }), SelfTransferError)
})
run('T3 self-transfer with upper-cased destination body is refused', () => {
  assert.throws(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: USDC_UPPER_BODY }), SelfTransferError)
})
run('T4 legitimate payment to another address is allowed', () => {
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: PAYEE }))
})
run('T5 address differing in one nibble is allowed', () => {
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: NEAR_MISS }))
})
run('T6 native send (contractAddress undefined) does not throw', () => {
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: ethCoin, toAddress: PAYEE }))
})
run('T6b native send to an address equal to a token address does not throw', () => {
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: ethCoin, toAddress: USDC }))
})
run('T7 approve(a,n) targets the contract; guard must NOT cover the approve arm', () => {
  assert.equal(approveDestination(usdcCoin), USDC)
  assert.throws(
    () => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: approveDestination(usdcCoin) }),
    SelfTransferError
  )
})
run('T8 malformed toAddress does not crash the guard', () => {
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: '' }))
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: '0xdeadbeef' }))
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: null }))
})
run('T9 second token, self-transfer refused', () => {
  const usdt = { chain: 'Ethereum', ticker: 'USDT', isNativeToken: false, contractAddress: USDT }
  assert.throws(() => assertErc20TransferNotSelf({ coin: usdt, toAddress: USDT.toLowerCase() }), SelfTransferError)
})
run('T10 guard with no coin at all is a no-op, not a crash', () => {
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: undefined, toAddress: PAYEE }))
})
run('T11 isAddressLike rejects shapes a naive /^0x/ check would accept', () => {
  assert.equal(isAddressLike('0xdeadbeef'), false)
  assert.equal(isAddressLike('0x' + 'a'.repeat(41)), false)
  assert.equal(isAddressLike('0X' + 'a'.repeat(40)), false) // capital X
  assert.equal(isAddressLike(USDC), true)
})

// ---- the EIP-681 route to the same bug, through the real parser --------------
// A payment link may name the token contract as the recipient. That is the
// realistic way a user reaches #2495, so it is asserted with the actual parser
// rather than asserted from reading it.
run('T12 a valid EIP-681 link can name the token contract as recipient', () => {
  const uri = `ethereum:${USDC}@1/transfer?address=${USDC}&uint256=1000000`
  const r = parse(uri)
  assert.equal(r.ok, true, 'parser rejected the URI: ' + show(r))
  // the parser keeps the two roles in separate fields, which is why the bug is
  // possible: `target` is the address in the scheme position (the token contract),
  // `recipient` is the ?address= payee. #2495 fires when a link makes them equal.
  assert.equal(String(r.target).toLowerCase(), USDC.toLowerCase(), 'target was ' + show(r.target))
  assert.equal(String(r.recipient).toLowerCase(), USDC.toLowerCase(), 'recipient was ' + show(r.recipient))
  assert.equal(
    String(r.target).toLowerCase(),
    String(r.recipient).toLowerCase(),
    'this link is the self-transfer shape: target == recipient'
  )
  // that recipient, fed to the signing path, is exactly the refused case
  assert.throws(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: r.recipient }), SelfTransferError)
})

run('T13 the same link addressed to a real payee is allowed end to end', () => {
  const uri = `ethereum:${USDC}@1/transfer?address=${PAYEE}&uint256=1000000`
  const r = parse(uri)
  assert.equal(r.ok, true, 'parser rejected the URI: ' + show(r))
  assert.equal(String(r.target).toLowerCase(), USDC.toLowerCase(), 'target was ' + show(r.target))
  assert.equal(String(r.recipient).toLowerCase(), PAYEE.toLowerCase(), 'recipient was ' + show(r.recipient))
  assert.notEqual(
    String(r.target).toLowerCase(),
    String(r.recipient).toLowerCase(),
    'this link is the ORDINARY shape: target != recipient, so it must not be refused'
  )
  assert.doesNotThrow(() => assertErc20TransferNotSelf({ coin: usdcCoin, toAddress: r.recipient }))
})

// ---- negative controls -------------------------------------------------------
run('N1 CONTROL guard without case normalisation LEAKS the lower-cased self-transfer', () => {
  let leaked = false
  try {
    guardNoLowercase({ coin: usdcCoin, toAddress: USDC_LOWER })
    leaked = true
  } catch {}
  assert.equal(leaked, true, 'expected the un-normalised guard to miss it')
})
run('N2 CONTROL the literal fix from the issue text CRASHES on a native send', () => {
  assert.throws(
    () => guardLiteralFromIssue({ coin: ethCoin, toAddress: PAYEE }),
    /Cannot read properties of undefined|toLowerCase/,
    'expected a TypeError from lowercasing an undefined contractAddress'
  )
})
run('N3 CONTROL the literal fix also throws on a payload with no coin', () => {
  assert.throws(
    () => guardLiteralFromIssue({ coin: undefined, toAddress: PAYEE }),
    /Cannot read properties of undefined/
  )
})

// ---- report ------------------------------------------------------------------
for (const [st, name] of cases) console.log(`  ${st}  ${name}`)
const fail = cases.length - pass
console.log(`\n  ${pass} passed, ${fail} failed  (${cases.length} assertions)`)
if (fail > 0) {
  console.log('\n  RESULT: FAIL')
  process.exit(1)
}
console.log('\n  RESULT: PASS — invariant holds, both naive fixes demonstrably broken,')
console.log('          and the EIP-681 route to the bug reproduced with the real parser.')
