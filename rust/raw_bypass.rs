use eip681::TransactionRequest;

#[test]
fn can_a_caller_bypass_the_typed_accessors_via_into_raw() {
    // The over-length address, in both positions.
    let over = "a".repeat(128);
    let native = format!("ethereum:0x{over}?value=1");
    let erc20  = format!("ethereum:0x{}802?address=0x{}&uint256=1000000", "b".repeat(42), over);

    for (label, uri) in [("native", &native), ("erc20", &erc20)] {
        let r = TransactionRequest::parse(uri).expect("parse returns Ok, not Err");
        println!("--- {label} ---");
        // Does the raw form still carry the bad address in a reachable field?
        let raw = r.into_raw();
        println!("raw = {raw:#?}");
    }
}
