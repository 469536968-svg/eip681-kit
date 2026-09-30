// conformance/gen_vectors.mjs — emit the conformance corpus in forms other languages
// can consume directly, so a Rust/Go/Python/Swift wallet can run the same expectations
// without re-typing them (and without transcription errors).
//
//   node conformance/gen_vectors.mjs > /dev/null    # writes the files below
//
// Outputs (all committed, all generated from vectors.json — a single source of truth):
//   conformance/vectors.json   (source of truth, hand-authored)
//   conformance/vectors.tsv    one line per case, tab-separated, for shell/awk/CI
//   conformance/vectors.ndjson one JSON object per line, for streaming test harnesses
//
// Deterministic: re-running produces byte-identical output.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, 'vectors.json'), 'utf8'));

const flat = (v) => ({
  id: v.id,
  input: v.input,
  ok: v.expect.ok,
  errors: (v.expect.error_codes || []).join('|'),
  warnings: (v.expect.warning_codes || []).join('|'),
  chainId: v.expect.fields && 'chainId' in v.expect.fields ? String(v.expect.fields.chainId) : '',
  amount: v.expect.fields && 'amount' in v.expect.fields ? String(v.expect.fields.amount) : '',
  recipient: (v.expect.fields && v.expect.fields.recipient) || '',
  target: (v.expect.fields && v.expect.fields.target) || '',
  isTokenTransfer: v.expect.fields && 'isTokenTransfer' in v.expect.fields ? String(v.expect.fields.isTokenTransfer) : '',
  why: v.why.replace(/\s+/g, ' '),
});

const rows = suite.vectors.map(flat);

// TSV — header + rows. Tabs inside a field are impossible: `why` is whitespace-collapsed.
const cols = ['id', 'ok', 'errors', 'warnings', 'chainId', 'amount', 'recipient', 'target', 'isTokenTransfer', 'input', 'why'];
const tsv = [cols.join('\t'), ...rows.map((r) => cols.map((c) => r[c]).join('\t'))].join('\n') + '\n';
writeFileSync(join(here, 'vectors.tsv'), tsv, 'utf8');

// NDJSON — one case per line.
const ndjson = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(join(here, 'vectors.ndjson'), ndjson, 'utf8');

// A tiny language-neutral driver, so the corpus is usable without reading this repo's JS.
writeFileSync(join(here, 'HOWTO.md'), `# Running the conformance corpus in any language

\`vectors.json\` is the source of truth. \`vectors.tsv\` and \`vectors.ndjson\` are generated
from it by \`gen_vectors.mjs\` — do not edit them by hand.

## What a conforming parser must satisfy

For each case:

1. \`ok\` must equal your parser's "no errors" result. Warnings do not make \`ok\` false.
2. Every string in \`expect.error_codes\` must appear in your error list when \`ok\` is false.
3. Every string in \`expect.warning_codes\` must appear in your warning list.
4. When \`ok\` is true, each field in \`expect.fields\` must match:
   - \`chainId\` — integer, or \`null\` when the URI omits it
   - \`amount\` — decimal string (never a float; uint256 does not fit a double), or \`null\`
   - \`recipient\` / \`target\` — lowercase hex with \`0x\` prefix
   - \`isTokenTransfer\` — boolean; true only for the \`/transfer\` form
5. **When \`ok\` is false, no amount may be exposed.** A caller that tests
   \`amount !== null\` instead of \`ok\` must not be able to pay a silently chosen
   number. This is case \`T-05\` and it is the single most important rule here.

## Which cases catch which class of real bug

| Cases | Bug class they catch |
|---|---|
| \`C-02\`..\`C-06\` | **Address length tested as a minimum, not an exact width.** A grammar written with a min-40 rule inherits no ceiling, so 41..64 digits reach the checksum step and are reported as a checksum problem (\`bad-checksum\`) rather than a length problem. This is a defect observed in \`librustzcash\` \`components/eip681\`. |
| \`C-07\` | Treating any mixed case as valid without verifying the EIP-55 claim. |
| \`C-11\` | The opposite: demanding mixed case, so ordinary all-lowercase QRs are rejected. |
| \`T-02\` | Reading a \`/transfer\` with no \`uint256\` as an open-ended transfer the user will fill in. |
| \`T-04\` | Conflating the token **contract** (target) with the **recipient** — the classic broken deposit QR. |
| \`T-05\` | Exposing an ambiguous amount on a failed parse. |
| \`T-08\` | Length-checking the recipient but not the token contract. |
| \`X-06\` | Reporting a token **approval** as a payment. |
| \`A-05\` | Precision loss on uint256 via a float or a 53-bit integer. |
| \`X-01\` | Silent mainnet/testnet mixups when the chain id is absent. |

## Exit criteria for your own CI

Fail the build if any case mismatches. The corpus is small enough to run in
milliseconds and specific enough that a regression names itself.
`, 'utf8');

console.log(`wrote vectors.tsv (${rows.length} cases), vectors.ndjson, HOWTO.md`);
