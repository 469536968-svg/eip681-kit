#!/usr/bin/env python3
"""
Independent second implementation of the EIP-681 amount rules, written from the
written spec only -- deliberately NOT a port of the JS file, and it never imports it.

Purpose: the README published today claims the vectors can be dropped into any
language. That claim was only exercised in JavaScript. Running a from-scratch Python
parser against the same 55 vectors turns the claim into a measurement.

If Python and JS agree on all 55 cases, the vectors are language-neutral and the
semantics are reproducible from prose. If they disagree, one of the two is wrong and
I need to know which before the vectors are cited anywhere else.
"""
import json
import re
import sys

VECTOR_PATH = r"C:\Users\HUAWEI\workspace\eip681-kit\amount\vectors\eip681-amount-vectors.json"
UINT256_MAX = (1 << 256) - 1

# integer part (possibly empty), optional fraction (one or more digits), optional exponent
AMOUNT_RE = re.compile(r"^(?P<int>\d*)(?:\.(?P<frac>\d+))?(?:[eE](?P<exp>[+-]?\d+))?$")


def parse_amount(text, decimals):
    """-> {'ok': True, 'units': '<decimal string>'} or {'ok': False, 'reason': <one of six>}"""
    if not isinstance(text, str):
        return {"ok": False, "reason": "syntax"}

    s = text.strip()
    if s == "":
        return {"ok": False, "reason": "empty"}

    low = s.lower()
    if low.startswith("0x") or low.startswith("-0x") or low.startswith("+0x"):
        return {"ok": False, "reason": "hex-not-allowed"}
    if s.startswith("-"):
        return {"ok": False, "reason": "negative"}

    m = AMOUNT_RE.match(s)
    if not m:
        return {"ok": False, "reason": "syntax"}

    int_part = m.group("int") or ""
    frac_part = m.group("frac") or ""
    if int_part == "" and frac_part == "":
        return {"ok": False, "reason": "syntax"}

    digits = int_part + frac_part
    mantissa = int(digits) if digits else 0
    exp = int(m.group("exp")) if m.group("exp") is not None else 0

    # value * 10^decimals == mantissa * 10^(exp - len(frac) + decimals)
    shift = exp - len(frac_part) + decimals
    if shift >= 0:
        units = mantissa * (10 ** shift)
    else:
        divisor = 10 ** (-shift)
        if mantissa % divisor != 0:
            return {"ok": False, "reason": "fraction-of-a-unit"}
        units = mantissa // divisor

    if units < 0:
        return {"ok": False, "reason": "negative"}
    if units > UINT256_MAX:
        return {"ok": False, "reason": "exceeds-uint256"}
    return {"ok": True, "units": str(units)}


def format_amount(units, decimals):
    """base units (int or decimal str) -> human decimal string, trailing zeros trimmed"""
    u = int(units)
    if u < 0:
        raise ValueError("negative units")
    if decimals == 0:
        return str(u)
    s = str(u).zfill(decimals + 1)
    int_part, frac_part = s[:-decimals], s[-decimals:]
    frac_part = frac_part.rstrip("0")
    return int_part + ("." + frac_part if frac_part else "")


def decode_param_value(text):
    """percent-decode; return None if any escape is malformed"""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "%":
            if i + 2 >= len(text):
                return None
            hexpart = text[i + 1:i + 3]
            if len(hexpart) != 2 or any(c not in "0123456789abcdefABCDEF" for c in hexpart):
                return None
            out.append(chr(int(hexpart, 16)))
            i += 3
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def main():
    with open(VECTOR_PATH, encoding="utf-8") as f:
        V = json.load(f)

    passed = failed = 0
    failures = []

    for c in V["amount"]:
        got = parse_amount(c["input"], c["decimals"])
        if got == c["expect"]:
            passed += 1
        else:
            failed += 1
            failures.append(
                "amount input=%r d=%s\n    expect %s\n    got    %s"
                % (c["input"], c["decimals"], json.dumps(c["expect"]), json.dumps(got))
            )

    for c in V["format"]:
        got = format_amount(c["units"], c["decimals"])
        if got == c["expect"]:
            passed += 1
        else:
            failed += 1
            failures.append(
                "format units=%s d=%s\n    expect %r\n    got    %r"
                % (c["units"], c["decimals"], c["expect"], got)
            )

    for c in V["decode"]:
        got = decode_param_value(c["input"])
        if got == c["expect"]:
            passed += 1
        else:
            failed += 1
            failures.append(
                "decode input=%r\n    expect %r\n    got    %r"
                % (c["input"], c["expect"], got)
            )

    total = passed + failed
    print("python (independent, from-scratch): %d passed, %d failed of %d" % (passed, failed, total))
    for f_ in failures:
        print("  FAIL " + f_)

    # the classic Python trap, asserted rather than trusted
    assert parse_amount("1e18", 0) == {"ok": True, "units": "1000000000000000000"}
    assert format_amount(10 ** 24, 6) == "1000000000000000000"
    assert parse_amount("0.000000000000000001e36", 0)["units"] == "1000000000000000000"

    # floats would break here; ints do not
    assert parse_amount("9007199254740993", 0)["units"] == "9007199254740993"

    ok = failed == 0
    print("RESULT: %s" % (
        "PASS -- two independent implementations agree on all %d vectors, so the file is language-neutral" % total
        if ok else "FAIL -- implementations disagree; the vectors are not yet safe to cite"
    ))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
