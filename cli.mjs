#!/usr/bin/env node
// eip681 CLI — strict EIP-681 validation, derivation and formatting.
//
// Zero dependencies. Runs with `node cli.mjs`, or via npx from a git install:
//   npx github:469536968-svg/eip681-kit check 'ethereum:0x...@8453?value=1e16'
//
// Exit codes are part of the contract, so this is usable in CI and in shell pipelines:
//   0 = valid / operation succeeded
//   1 = the URI (or the derivation request) was rejected
//   2 = usage error (bad arguments)
//   3 = unexpected internal error
//
// TWO API FACTS THIS FILE DEPENDS ON, both confirmed by execution:
//
//   1. parse() DOES NOT THROW on a bad URI. It returns
//        { ok: false, errors: [{code, message}], warnings: [] }
//      and on a good one { ok: true, canonical, ... }. Treating a thrown
//      exception as the only failure signal silently classifies every invalid
//      URI as valid. That is why inspect() checks parsed.ok explicitly.
//
//   2. deriveEip681() is deliberately strict: it wants an INTEGER chainId, and
//      for native transfers it wants plain digits in `wei`/`value`
//      (regex /^\d+$/), NOT scientific notation — even though EIP-681 permits
//      `1e16` inside a URI. The CLI expands scientific notation to digits
//      before calling it, via BigInt, so the expansion is exact.

import { parse, format } from './eip681.mjs';
import { deriveEip681 } from './deriveEip681.mjs';

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 3;

const DEFAULT_DECIMALS = 18;

const HELP = `eip681 — strict EIP-681 payment URI toolkit (zero dependencies)

USAGE
  eip681 validate <uri> [<uri> ...]
      Parse and validate each URI. Prints one JSON object per URI to stdout.
      Exits 1 if ANY uri is invalid. This is the CI-friendly mode.

  eip681 check <uri>
      Validate a single URI and print either "ok" or the exact error.
      Exits 1 on rejection.

  eip681 fmt <uri>
      Parse then re-serialise. If the output differs from the input, the URI
      was not in canonical form; the canonical form is printed.

  eip681 derive --chain <id> --to <address> [options]
      Build a URI from explicit fields. Refuses to print anything it would not
      itself parse back.

  eip681 vectors
      Report the location of the built-in conformance corpus.

  eip681 --help

DERIVE OPTIONS
  --chain <id>            EIP-155 chain id, positive integer (required)
  --to <address>          Recipient (required). A mixed-case address is treated
                          as an EIP-55 CLAIM and rejected if the checksum fails;
                          pass an all-lowercase or all-uppercase address to skip
                          checksum enforcement.
  --value <wei>           Native amount in wei. Accepts digits, or scientific
                          notation (1e16) which is expanded exactly via BigInt.
  --token <address>       ERC-20 contract -> emits the /transfer form.
  --amount <token units>  Token amount in whole units. Required with --token.
  --decimals <n>          Token decimals for --amount conversion (default 18).

EXAMPLES
  eip681 check 'ethereum:0x1234deadbeef5678abcd1234deadbeef5678abcd@8453?value=1e16'
  eip681 validate 'ethereum:0x1234567890123456789012345678901234567890'
  eip681 fmt 'ethereum:0x1234DEADBEEF5678ABCD1234DEADBEEF5678ABCD'
  eip681 derive --chain 1 --to 0x1234deadbeef5678abcd1234deadbeef5678abcd --value 1e16

Exit codes: 0 valid, 1 rejected, 2 usage, 3 internal.
`;

function fail(code, msg) {
  if (msg) process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(code);
}

function parseArgs(argv) {
  const out = { flags: {}, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          out.flags[key] = true;
        } else {
          out.flags[key] = next;
          i++;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// One URI -> one result object. Never throws.
//
// parse() reports failure in-band (ok:false) rather than by throwing, so we must
// not rely on try/catch alone. We report valid:true only on an explicit ok:true.
function inspect(uri) {
  let parsed;
  try {
    parsed = parse(uri);
  } catch (e) {
    // Defensive: if a future version of parse() starts throwing, we still want a
    // structured answer rather than a stack trace in stdout.
    return { uri, valid: false, error: String(e && e.message ? e.message : e) };
  }

  if (!parsed || parsed.ok !== true) {
    const errors = (parsed && parsed.errors) || [];
    return {
      uri,
      valid: false,
      error: errors.length ? errors.map((x) => x.code + ': ' + x.message).join('; ') : 'parse returned no ok flag',
      errors,
    };
  }

  // Prefer the parser's own canonical form; fall back to format() if absent.
  let canonical = typeof parsed.canonical === 'string' ? parsed.canonical : null;
  let canonicalError = null;
  if (canonical === null) {
    try {
      canonical = format(parsed);
    } catch (e) {
      canonicalError = String(e && e.message ? e.message : e);
    }
  } else {
    try {
      const viaFormat = format(parsed);
      if (typeof viaFormat === 'string') canonical = viaFormat;
    } catch (e) {
      canonicalError = String(e && e.message ? e.message : e);
    }
  }

  return {
    uri,
    valid: true,
    parsed,
    canonical,
    canonical_differs: canonical !== null && canonical !== uri,
    canonical_error: canonicalError,
    warnings: (parsed.warnings) || [],
  };
}

// "1e16" / "1.5e3" -> exact decimal digit string, or null if not a whole number.
function expandScientific(s) {
  const m = /^(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/.exec(s);
  if (!m) return null;
  const intPart = m[1];
  const fracPart = m[2] || '';
  const exp = Number(m[3]) - fracPart.length;
  if (exp < 0) return null; // fractional wei is not representable
  return intPart + fracPart + '0'.repeat(exp);
}

function cmdValidate(args) {
  if (args._.length === 0) fail(EXIT_USAGE, 'validate: needs at least one URI\n\n' + HELP);
  let allValid = true;
  for (const uri of args._) {
    const r = inspect(uri);
    if (!r.valid) allValid = false;
    process.stdout.write(JSON.stringify(r) + '\n');
  }
  process.exit(allValid ? EXIT_OK : EXIT_INVALID);
}

function cmdCheck(args) {
  if (args._.length !== 1) fail(EXIT_USAGE, 'check: needs exactly one URI');
  const r = inspect(args._[0]);
  if (r.valid) {
    process.stdout.write('ok\n');
    process.exit(EXIT_OK);
  }
  process.stdout.write(r.error + '\n');
  process.exit(EXIT_INVALID);
}

function cmdFmt(args) {
  if (args._.length !== 1) fail(EXIT_USAGE, 'fmt: needs exactly one URI');
  const r = inspect(args._[0]);
  if (!r.valid) fail(EXIT_INVALID, r.error);
  if (r.canonical === null) fail(EXIT_INTERNAL, 'fmt: could not serialise: ' + r.canonical_error);
  process.stdout.write(r.canonical + '\n');
  if (r.canonical !== r.uri) process.stderr.write('note: input was not in canonical form\n');
  process.exit(EXIT_OK);
}

function cmdDerive(args) {
  const f = args.flags;
  if (!f.chain) fail(EXIT_USAGE, 'derive: --chain is required');
  if (!f.to) fail(EXIT_USAGE, 'derive: --to is required');

  // The library wants an integer; a CLI user types a string. Validate explicitly
  // instead of letting Number() turn '' or 'abc' into NaN downstream.
  if (!/^\d+$/.test(String(f.chain))) fail(EXIT_USAGE, 'derive: --chain must be a positive integer');
  const chainId = Number(f.chain);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) fail(EXIT_USAGE, 'derive: --chain out of range');

  const invoice = { chainId, payee: String(f.to) };

  if (f.token !== undefined) {
    invoice.asset = String(f.token);
    if (f.amount === undefined) fail(EXIT_USAGE, 'derive: --amount is required with --token');
    invoice.amount = String(f.amount);
    // deriveEip681 gets decimals from the invoice and returns null if it is not
    // an integer, so the default must be supplied here rather than assumed there.
    if (f.decimals !== undefined) {
      if (!/^\d+$/.test(String(f.decimals))) fail(EXIT_USAGE, 'derive: --decimals must be an integer');
      invoice.decimals = Number(f.decimals);
    } else {
      invoice.decimals = DEFAULT_DECIMALS;
    }
  } else {
    invoice.asset = 'native';
    if (f.value === undefined) fail(EXIT_USAGE, 'derive: --value (wei) is required for a native transfer');
    let v = String(f.value).trim();
    if (/[eE]/.test(v)) {
      const expanded = expandScientific(v);
      if (expanded === null) fail(EXIT_USAGE, 'derive: --value ' + v + ' is not a whole number of wei');
      v = expanded;
    }
    if (!/^\d+$/.test(v)) fail(EXIT_USAGE, 'derive: --value must be wei as digits or scientific notation');
    invoice.wei = v;
  }

  const uri = deriveEip681(invoice);
  if (uri === null) {
    // null is a deliberate refusal, not a crash. Exit 1 so callers can branch.
    fail(
      EXIT_INVALID,
      'derive: refused — deriveEip681 returned null (bad or failed-checksum payee, zero amount, inexact token amount, or unusable asset address)'
    );
  }

  // Invariant: never print a URI this kit would not accept back.
  const back = inspect(uri);
  if (!back.valid) fail(EXIT_INTERNAL, 'derive: BUG — produced a URI this kit rejects: ' + back.error);

  process.stdout.write(uri + '\n');
  process.exit(EXIT_OK);
}

function cmdVectors() {
  const dir = new URL('./vectors/', import.meta.url);
  process.stdout.write('corpus: ' + dir.pathname + '\n');
  process.stdout.write('run `npm test` for the full assertion suite (43 parser + 35 derive cases)\n');
  process.exit(EXIT_OK);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(HELP);
    process.exit(EXIT_OK);
  }
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  try {
    switch (cmd) {
      case 'validate': return cmdValidate(args);
      case 'check': return cmdCheck(args);
      case 'fmt': return cmdFmt(args);
      case 'derive': return cmdDerive(args);
      case 'vectors': return cmdVectors();
      default: fail(EXIT_USAGE, 'unknown command: ' + cmd + '\n\n' + HELP);
    }
  } catch (e) {
    fail(EXIT_INTERNAL, 'internal error: ' + String(e && e.stack ? e.stack : e));
  }
}

main();
