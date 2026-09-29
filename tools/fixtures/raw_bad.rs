fn send_out(uri: &str) {
    let req = TransactionRequest::parse(uri).unwrap();
    let raw = req.into_raw();
    let to = raw.target_address;
    wallet.send_to(&to, raw.parameters)?;
}
