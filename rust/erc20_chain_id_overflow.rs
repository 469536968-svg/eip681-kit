//! Evidence for zcash/librustzcash#3026 item 6.
//!
//! Claim under test: on the ERC-20 path a chain id that cannot be represented as a
//! u64 is discarded silently, so the caller cannot distinguish "not specified" from
//! "too large". The native path validates the same input at construction time.
//!
//! These assertions state the DESIRED behaviour. They therefore FAIL on the current
//! tree and PASS once the chain id is validated on the ERC-20 path as well. That
//! failure is the negative control: it demonstrates the test is load-bearing rather
//! than vacuously green.

use CRATE_PATH_HERE::TransactionRequest;

const CONTRACT: &str = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const RECIPIENT: &str = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

/// 2^64, exactly one more than u64::MAX.
const OOR: &str = "18446744073709551616";

fn erc20_uri(chain: &str) -> String {
    format!("ethereum:{CONTRACT}@{chain}/transfer?address={RECIPIENT}&uint256=1")
}

fn native_uri(chain: &str) -> String {
    format!("ethereum:{RECIPIENT}@{chain}?value=1")
}

#[test]
fn measure_what_current_code_does() {
    let uri = erc20_uri(OOR);
    println!();
    println!("[MEASURE] erc20 uri   = {uri}");
    match TransactionRequest::parse(&uri) {
        Ok(TransactionRequest::Erc20Request(r)) => {
            println!("[MEASURE] variant     = Erc20Request");
            println!("[MEASURE] chain_id()  = {:?}", r.chain_id());
        }
        Ok(TransactionRequest::NativeRequest(r)) => {
            println!("[MEASURE] variant     = NativeRequest chain_id()={:?}", r.chain_id());
        }
        Ok(TransactionRequest::Unrecognised(_)) => println!("[MEASURE] variant     = Unrecognised"),
        Err(e) => println!("[MEASURE] Err         = {e}"),
    }

    let n = native_uri(OOR);
    println!("[MEASURE] native uri  = {n}");
    match TransactionRequest::parse(&n) {
        Ok(TransactionRequest::NativeRequest(r)) => {
            println!("[MEASURE] native      = NativeRequest chain_id()={:?}", r.chain_id());
        }
        Ok(TransactionRequest::Unrecognised(_)) => println!("[MEASURE] native      = Unrecognised"),
        Ok(_) => println!("[MEASURE] native      = other variant"),
        Err(e) => println!("[MEASURE] native Err  = {e}"),
    }
}

/// The defect. An unrepresentable chain id must never surface as `None`, because
/// `None` already means "the URI did not specify a chain", and most callers read
/// `None` as mainnet.
#[test]
fn erc20_chain_id_overflow_never_surfaces_as_none() {
    let uri = erc20_uri(OOR);
    match TransactionRequest::parse(&uri) {
        Ok(TransactionRequest::Erc20Request(r)) => {
            let got = r.chain_id();
            assert!(
                got.is_some(),
                "BUG (issue #3026 item 6): Erc20Request::chain_id() returned None for an over-long chain id. None is indistinguishable from not-specified. uri={uri}"
            );
        }
        // Rejecting the URI, or declining to classify it, does not lie to the caller.
        Ok(TransactionRequest::Unrecognised(_)) | Err(_) => {}
        Ok(_) => {}
    }
}

/// Positive control. A representable chain id must still reach the caller. Without
/// this the test above would be satisfied by rejecting every ERC-20 URI.
#[test]
fn erc20_valid_chain_id_still_round_trips() {
    let uri = erc20_uri("1");
    match TransactionRequest::parse(&uri).expect("valid uri must parse") {
        TransactionRequest::Erc20Request(r) => assert_eq!(r.chain_id(), Some(1), "uri={uri}"),
        other => panic!("expected Erc20Request, got {other:?} for {uri}"),
    }

    // u64::MAX is representable and must round-trip exactly.
    let max = erc20_uri("18446744073709551615");
    match TransactionRequest::parse(&max).expect("u64::MAX chain id must parse") {
        TransactionRequest::Erc20Request(r) => {
            assert_eq!(r.chain_id(), Some(u64::MAX), "u64::MAX must round-trip exactly")
        }
        other => panic!("expected Erc20Request, got {other:?}"),
    }
}

/// Symmetry check: whatever the native path does with an over-long chain id, the
/// ERC-20 path should not be more permissive by returning a confident-looking None.
#[test]
fn native_and_erc20_paths_agree_on_overflow() {
    let n = native_uri(OOR);
    let native_rejects = match TransactionRequest::parse(&n) {
        Ok(TransactionRequest::NativeRequest(r)) => r.chain_id().is_none(),
        Ok(TransactionRequest::Unrecognised(_)) | Err(_) => true,
        Ok(_) => true,
    };
    println!("[MEASURE] native path rejects/errors on 2^64: {native_rejects}");

    let e = erc20_uri(OOR);
    let erc20_claims_none = matches!(
        TransactionRequest::parse(&e),
        Ok(TransactionRequest::Erc20Request(r)) if r.chain_id().is_none()
    );
    println!("[MEASURE] erc20 path returns None on 2^64: {erc20_claims_none}");

    assert!(
        !erc20_claims_none || native_rejects && !erc20_claims_none,
        "BUG (issue #3026 item 6): the native path rejects an over-long chain id, \
         while the ERC-20 path returns None, which reads as 'no chain specified'."
    );
}
