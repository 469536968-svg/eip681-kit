use eip681::TransactionRequest;

fn short(r: Result<TransactionRequest, eip681::error::Error>) -> String {
    match r {
        Ok(TransactionRequest::Erc20Request(_))       => "Ok(Erc20Request)".into(),
        Ok(TransactionRequest::NativeRequest(_))      => "Ok(NativeRequest)".into(),
        Ok(TransactionRequest::Unrecognised(_))       => "Ok(Unrecognised)  <-- success-shaped".into(),
        Ok(_)  => "Ok(other)".into(),
        Err(e) => format!("Err({e:?})"),
    }
}

#[test]
fn constructor_outcome_matrix() {
    let good = "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359";
    for n in [40usize, 41, 64, 65, 128] {
        let uri = format!("ethereum:0x{}/transfer?address={good}&uint256=1000000", "b".repeat(n));
        println!("erc20 token   {:>3} digits -> {}", n, short(TransactionRequest::parse(&uri)));
        let u2 = format!("ethereum:0x{}?value=1", "a".repeat(n));
        println!("native recip  {:>3} digits -> {}", n, short(TransactionRequest::parse(&u2)));
    }
}

#[test]
fn unrecognised_is_never_a_usable_request() {
    // Does the success-shaped variant let a caller proceed? If it also yields None from
    // the typed accessors, the damage is bounded but the Result is still misleading.
    let uri = format!("ethereum:0x{}?value=1", "a".repeat(41));
    let r = TransactionRequest::parse(&uri).expect("returns Ok, not Err");
    println!("as_native() = {:?}", r.as_native().is_some());
    println!("as_erc20()  = {:?}", r.as_erc20().is_some());
    assert!(matches!(r, TransactionRequest::Unrecognised(_)));
}
