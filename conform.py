#!/usr/bin/env python3
"""conform.py - EIP-681 conformance runner (Python port of conform.mjs).

Point it at any EIP-681 implementation that exposes the adapter interface
below and it will tell you exactly which vectors fail and why. This exists so
the vector set is not usable only from JavaScript.

Adapter interface - a Python module with one required function:

    def parse(uri: str) -> dict:
        return {
            "ok": bool,                # does this implementation accept the URI?
            "scheme": str | None,
            "target": str | None,          # address in the path
            "chainId": int | None,
            "functionName": str | None,
            "isTokenTransfer": bool,
            "recipient": str | None,        # for /transfer: the ?address= payee
            "amount": str | None,           # BASE UNITS, decimal string
            "gasLimit": str | None,
            "gasPrice": str | None,         # base units
            "canonical": str | None,
            "errors": [str | {"code": str}],
            "warnings": [str | {"code": str}],
            "checksumValid": bool | None,   # mixed case AND valid EIP-55
            "checksumAbsent": bool | None,  # no case information present
        }

Optional module attribute `name` (str) labels the output.

Fields a vector does not assert are ignored. Fields a vector asserts that your
implementation does not report are FAILURES - which is the point: an
implementation that cannot report `checksumValid` cannot be trusted to have
checked it.

Usage:
    python conform.py                       # self-test: python adapter vs vectors
    python conform.py ./my_adapter.py       # run any adapter module

Exit code: 0 all pass, 1 failures, 2 usage/load error.
"""

import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = os.path.join(HERE, "vectors", "eip681-vectors.json")


def codes(value):
    """Normalise an errors/warnings list to a list of code strings."""
    if not value:
        return []
    out = []
    for item in value:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            c = item.get("code")
            if c is not None:
                out.append(str(c))
    return out


def compare(vector, got):
    """Return a list of human-readable failure strings for one vector."""
    fails = []
    exp = vector.get("expect", {}) or {}

    for key, want in exp.items():
        if key == "errorCodes":
            have = set(codes(got.get("errors"))) | set(got.get("allCodes") or [])
            missing = [c for c in want if c not in have]
            if missing:
                fails.append(
                    "errorCodes: expected %s, missing %s (got %s)"
                    % (json.dumps(want), json.dumps(missing), json.dumps(sorted(have)))
                )
            continue

        if key == "warningCodes":
            have = set(codes(got.get("warnings"))) | set(got.get("allCodes") or [])
            missing = [c for c in want if c not in have]
            if missing:
                fails.append(
                    "warningCodes: expected %s, missing %s (got %s)"
                    % (json.dumps(want), json.dumps(missing), json.dumps(sorted(have)))
                )
            continue

        if key == "amountMustBeWeiString":
            have = got.get("amount")
            if str(have) != str(want):
                fails.append(
                    "amountMustBeWeiString: expected %s, got %s"
                    % (want, json.dumps(have))
                )
            continue

        have = got.get(key, "__MISSING__")
        if have == "__MISSING__":
            fails.append(
                "%s: implementation did not report this field (expected %s)"
                % (key, json.dumps(want))
            )
        elif str(have) != str(want):
            fails.append("%s: expected %s, got %s" % (key, json.dumps(want), json.dumps(have)))

    return fails


def load_adapter(path):
    spec = importlib.util.spec_from_file_location("eip681_adapter", path)
    if spec is None or spec.loader is None:
        raise SystemExit("conform.py: cannot load adapter from %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "parse") or not callable(mod.parse):
        raise SystemExit("conform.py: %s does not define parse(uri)" % path)
    return getattr(mod, "name", os.path.basename(path)), mod.parse


def main(argv):
    if not os.path.exists(VECTORS):
        raise SystemExit("conform.py: missing %s" % VECTORS)
    with open(VECTORS, "r", encoding="utf-8") as fh:
        spec = json.load(fh)

    adapter_path = os.path.join(HERE, "adapters", "example_python.py")
    if len(argv) > 1:
        adapter_path = os.path.abspath(argv[1])

    name, parse = load_adapter(adapter_path)

    vectors = spec.get("vectors", [])
    failures = []
    passed = 0

    for vec in vectors:
        try:
            got = parse(vec["input"])
        except Exception as exc:  # noqa: BLE001 - a raising adapter is a failure, not a crash
            failures.append((vec, ["threw %s: %s" % (type(exc).__name__, exc)]))
            continue
        if not isinstance(got, dict):
            failures.append((vec, ["parse() returned %s, expected dict" % type(got).__name__]))
            continue
        f = compare(vec, got)
        if f:
            failures.append((vec, f))
        else:
            passed += 1

    print("")
    print("EIP-681 conformance - adapter: %s" % name)
    print("reference: %s" % spec.get("reference", "(none)"))
    print("")

    for vec, fs in failures:
        print("FAIL  %s%s" % (vec.get("id", "?"), "  [spec]" if vec.get("spec") else ""))
        print("      %s" % vec["input"][:110])
        for m in fs:
            print("      - %s" % m)
        if vec.get("why"):
            print("      why: %s" % vec["why"])
        print("")

    spec_total = sum(1 for v in vectors if v.get("spec"))
    failed_ids = {v.get("id") for v, _ in failures}
    spec_pass = sum(1 for v in vectors if v.get("spec") and v.get("id") not in failed_ids)

    print("%d/%d vectors pass" % (passed, len(vectors)))
    print("spec-derived: %d/%d" % (spec_pass, spec_total))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
