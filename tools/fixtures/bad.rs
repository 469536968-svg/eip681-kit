fn a() {
    let req = TransactionRequest::from_erc20_request_parts("ethereum", false, None, tok, to, v)?;
    do_something(req);
}
