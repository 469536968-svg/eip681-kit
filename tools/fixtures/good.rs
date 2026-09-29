fn c() {
    match TransactionRequest::from_erc20_request_parts("ethereum", false, None, tok, to, v) {
        Ok(TransactionRequest::Erc20Request(r)) => use_it(r),
        Ok(TransactionRequest::Unrecognised(raw)) => log_unknown(raw),
        Err(e) => return Err(e),
    }
}
fn d() {
    let req = TransactionRequest::from_native_request_parts("ethereum", false, None, to, v, None, None)?;
    let Some(n) = req.as_native() else { return Err(Error::Unknown) };
    use_it(n);
}
