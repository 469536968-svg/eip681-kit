"""Example Python adapter for conform.py.

Copy this next to your implementation and make `parse()` return the normalised
shape below. Nothing else is required - no base class, no registration.

Run:
    python conform.py ./adapters/example_python.py

The example below delegates to the bundled JavaScript kit via Node so that this
file is runnable as-is. Replace the body of `parse()` with a call into your own
implementation; that is the whole adapter contract.
"""

import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)  # repo root (this file lives in adapters/)

name = "eip681-kit via node (example adapter)"

_NODE_SNIPPET = """
import { explain } from './explain.mjs';
const uri = process.argv[1];
const r = explain(uri);
const codes = (a) => (a || []).map((e) => (typeof e === 'string' ? e : e.code));
console.log(JSON.stringify({
  ok: r.ok,
  scheme: r.decoded?.scheme ?? null,
  target: r.decoded?.target ?? null,
  chainId: r.decoded?.chainId ?? null,
  functionName: r.decoded?.functionName ?? null,
  isTokenTransfer: !!(r.decoded?.contract),
  recipient: r.decoded?.recipient ?? null,
  amount: r.decoded?.amountRaw ?? null,
  gasLimit: r.decoded?.gasLimit ?? null,
  gasPrice: r.decoded?.gasPrice ?? null,
  canonical: r.decoded?.canonical ?? null,
  errors: codes(r.errorDetails || r.errors),
  warnings: codes(r.warnings),
  allCodes: r.codes || [],
  checksumValid: r.checksum?.valid ?? null,
  checksumAbsent: r.checksum?.absent ?? null,
}));
"""


def parse(uri):
    """Return the normalised adapter shape for one URI.

    Replace this with a call into your own EIP-681 implementation. The only
    requirements: return a dict, use base-unit decimal strings for amounts, and
    expose `checksumValid`/`checksumAbsent` so a caller can tell whether the
    checksum was actually verified.
    """
    out = subprocess.run(
        ["node", "--input-type=module", "-e", _NODE_SNIPPET, uri],
        cwd=KIT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(out.stdout)
