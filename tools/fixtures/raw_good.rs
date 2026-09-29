fn send_out(uri: &str) -> Result<(), Error> {
    let req = TransactionRequest::parse(uri)?;
    let to = req.into_raw().target_address;
    if to.places.len() != 40 {
        return Err(Error::IncorrectEthAddressLen);
    }
    wallet.send_to(&to)
}
