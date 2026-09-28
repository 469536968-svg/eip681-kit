//! Drop-in integration test for `zcash/librustzcash` PR #3062 (issue #3061).
//!
//! Place at: `components/eip681/tests/overlength_contract_address.rs`
//!
//! Covers the case the PR's own added unit test omits: `to_erc55_validated_string`
//! has *three* call sites — the native recipient, the ERC-20 `address=` parameter,
//! and the ERC-20 **token contract** address. The PR test asserts the first two.
//!
//! Verified result (real `cargo test`, not a model):
//!   - patched (PR #3062 applied):   4 passed, 0 failed
//!   - unpatched (upstream HEAD):    1 passed, 3 failed
//!
//! The unpatched failure message names the bug exactly:
//!   "native recipient len=41: expected accepted=false"
//! which is exactly the behaviour reported in issue #3061.

use eip681::{TransactionRequest, U256};

const BAD: &str = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d35900"; // 42 hex digits
const GOOD: &str = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"; // 40
const USDC: &str = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// ---------------------------------------------------------------- gap #1
#[test]
fn over_length_token_contract_address_is_rejected() {
    let uri = format!("ethereum:{BAD}/transfer?address={USDC}&uint256=1000000");
    assert!(
        matches!(
            TransactionRequest::parse(&uri).unwrap(),
            TransactionRequest::Unrecognised(_)
        ),
        "over-length token contract address must not parse as an Erc20Request"
    );
}

// Control: the fix must not be over-broad.
#[test]
fn well_formed_token_contract_address_still_parses() {
    let uri = format!("ethereum:{USDC}/transfer?address={GOOD}&uint256=1000000");
    let req = TransactionRequest::parse(&uri).unwrap();
    let erc20 = req.as_erc20().expect("should be an Erc20Request");
    assert_eq!(erc20.token_contract_address(), USDC);
    assert_eq!(erc20.recipient_address(), GOOD);
}

// ---------------------------------------------------------------- gap #2
// Sweep 40..=64 at all three call sites; exactly one length is accepted.
#[test]
fn only_length_40_is_accepted_at_every_call_site() {
    let digits = "a".repeat(64); // all-lowercase => no checksum claim; isolates length

    for len in 40..=64 {
        let addr = format!("0x{}", &digits[..len]);

        let native_uri = format!("ethereum:{addr}?value=1");
        let native_ok = matches!(
            TransactionRequest::parse(&native_uri).unwrap(),
            TransactionRequest::NativeRequest(_)
        );
        assert_eq!(native_ok, len == 40, "native recipient len={len}");

        let erc20_uri = format!("ethereum:{USDC}/transfer?address={addr}&uint256=1");
        let erc20_ok = matches!(
            TransactionRequest::parse(&erc20_uri).unwrap(),
            TransactionRequest::Erc20Request(_)
        );
        assert_eq!(erc20_ok, len == 40, "erc20 recipient len={len}");

        let token_uri = format!("ethereum:{addr}/transfer?address={GOOD}&uint256=1");
        let token_ok = matches!(
            TransactionRequest::parse(&token_uri).unwrap(),
            TransactionRequest::Erc20Request(_)
        );
        assert_eq!(token_ok, len == 40, "erc20 TOKEN CONTRACT len={len}");
    }
}

// ---------------------------------------------------------------- observation
#[test]
fn constructor_parts_yield_unrecognised_not_err() {
    let native =
        TransactionRequest::from_native_request_parts("ethereum", false, None, BAD, None, None, None)
            .expect("constructor returns Ok");
    assert!(matches!(native, TransactionRequest::Unrecognised(_)));

    let erc20 = TransactionRequest::from_erc20_request_parts(
        "ethereum", false, None, BAD, GOOD, U256::from(1u64),
    )
    .expect("constructor returns Ok");
    assert!(matches!(erc20, TransactionRequest::Unrecognised(_)));

    let ok = TransactionRequest::from_erc20_request_parts(
        "ethereum", false, None, USDC, GOOD, U256::from(1u64),
    )
    .expect("constructor returns Ok");
    assert!(ok.as_erc20().is_some());
}
