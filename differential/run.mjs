// differential/run.mjs — feed ONE corpus to MULTIPLE EIP-681 implementations.
//
// Why this exists
// ---------------
// "My parser is correct" is a claim. A differential test converts it into evidence:
// run every case through every available implementation and print where they
// disagree. Every cell where two implementations differ is either
//   (a) a bug in one of them, or
//   (b) an ambiguity in the spec that real wallets will resolve inconsistently.
// Both are worth knowing, and neither is visible from a single test suite, because
// a test suite can only ever check the implementation against its own author's
// reading of the spec.
//
// The corpus carries the governing rule for each case, so a disagreement can be
// adjudicated against EIP-681 rather than against whichever parser is mine.
//
// An adapter module must export:
//   name    : string
//   version : string
//   parseUri(uri) -> { accept: boolean, reason: string|null }
// and must never throw.
//
// Usage:
//   node differential/run.mjs
//   node differential/run.mjs --corpus differential/corpus.json
//   node differential/run.mjs --json          # machine-readable
//   node differential/run.mjs --only <id>
//   node differential/run.mjs --require 2     # exit 1 unless >=2 adapters loaded
//
// Exit codes: 0 = all loaded adapters agree with the corpus, 1 = at least one
// disagreement or adapter failure, 2 = setup error (bad corpus / no adapters).

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Windows-safe: fileURLToPath gives a native path; the /^\/([A-Za-z]:)/ dance is
// only for URL.pathname and is a common source of "C:\c\Users\..." bugs here.
const ROOT = resolve(HERE, '..');

const EXIT_OK = 0;
const EXIT_DISAGREE = 1;
const EXIT_SETUP = 2;

function argsOf(argv) {
  const a = { json: false, corpus: join(HERE, 'corpus.json'), only: null, require: 1 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--json') a.json = true;
    else if (x === '--corpus') a.corpus = argv[++i];
    else if (x === '--only') a.only = argv[++i];
    else if (x === '--require') a.require = Number(argv[++i]);
  }
  return a;
}

function die(msg) {
  process.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process.exit(EXIT_SETUP);
}

// Load every adapter that exists. A missing adapter is not an error — it shrinks
// the matrix. A present-but-broken adapter IS an error, because silently dropping
// it would quietly reduce the comparison to one implementation, which proves nothing.
async function loadAdapters() {
  const dir = join(HERE, 'adapters');
  if (!existsSync(dir)) die('setup: no adapters/ directory at ' + dir);
  const files = readFileSync ? null : null;

  const names = (await import('node:fs')).readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  const out = [];
  for (const f of names.sort()) {
    const p = join(dir, f);
    try {
      const mod = await import(pathToFileURL(p).href);
      const name = mod.name || f.replace(/\.mjs$/, '');
      const version = mod.version || '?';
      const fn = mod.parseUri || (mod.default && mod.default.parseUri);
      if (typeof fn !== 'function') {
        out.push({ file: f, name, version, parseUri: null, loadError: 'no parseUri export' });
        continue;
      }
      out.push({ file: f, name, version, parseUri: fn, loadError: null });
    } catch (e) {
      out.push({ file: f, name: f, version: '?', parseUri: null, loadError: String(e && e.message ? e.message : e) });
    }
  }
  return out;
}

// Always returns a verdict object; never propagates a throw.
function verdictOf(adapter, uri) {
  if (!adapter.parseUri) return { accept: null, reason: 'adapter-not-loaded: ' + adapter.loadError, crashed: false };
  try {
    const r = adapter.parseUri(uri);
    if (!r || typeof r.accept !== 'boolean') {
      return { accept: null, reason: 'adapter returned a non-verdict', crashed: false };
    }
    return { accept: r.accept, reason: r.reason || null, crashed: false };
  } catch (e) {
    // A crash is a finding, not a reason to abort.
    return { accept: null, reason: 'THREW: ' + String(e && e.message ? e.message : e), crashed: true };
  }
}

async function main() {
  const args = argsOf(process.argv.slice(2));

  if (!existsSync(args.corpus)) die('setup: corpus not found: ' + args.corpus);
  let corpus;
  try {
    corpus = JSON.parse(readFileSync(args.corpus, 'utf8'));
  } catch (e) {
    die('setup: corpus is not valid JSON: ' + e.message);
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) die('setup: corpus has no cases');

  const adapters = await loadAdapters();
  const loaded = adapters.filter((a) => a.parseUri);
  const broken = adapters.filter((a) => !a.parseUri);

  if (loaded.length < args.require) {
    die(
      'setup: only ' + loaded.length + ' adapter(s) loaded, --require ' + args.require + '.\n' +
        'A differential test with fewer than 2 implementations compares a parser to itself and proves nothing.\n' +
        adapters.map((a) => '  ' + a.file + ': ' + (a.loadError || 'ok')).join('\n')
    );
  }

  const cases = args.only ? corpus.cases.filter((c) => c.id === args.only) : corpus.cases;
  if (cases.length === 0) die('setup: --only matched no case: ' + args.only);

  const rows = [];
  let disagreements = 0;
  let adapterFailures = 0;

  for (const c of cases) {
    const cells = loaded.map((a) => ({ adapter: a.name, version: a.version, ...verdictOf(a, c.uri) }));
    const accepts = new Set(cells.filter((x) => x.accept !== null).map((x) => x.accept));
    const unanimous = accepts.size <= 1;
    if (!unanimous) disagreements++;
    if (cells.some((x) => x.crashed || x.accept === null)) adapterFailures++;

    // Does the unanimous answer match the corpus's stated expectation?
    const actual = accepts.size === 1 ? [...accepts][0] : null;
    const expected = c.expect === 'accept';
    const matchesCorpus = actual !== null && actual === expected;

    rows.push({ case: c, cells, unanimous, actual, expected, matchesCorpus });
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          corpus: args.corpus,
          adapters: adapters.map((a) => ({ name: a.name, version: a.version, loaded: !!a.parseUri, error: a.loadError })),
          cases: rows.map((r) => ({
            id: r.case.id,
            uri: r.case.uri,
            expect: r.case.expect,
            rule: r.case.rule,
            unanimous: r.unanimous,
            verdicts: r.cells.map((x) => ({ adapter: x.adapter, accept: x.accept, reason: x.reason })),
          })),
          summary: { cases: rows.length, disagreements, adapterFailures, adapters: loaded.length },
        },
        null,
        2
      ) + '\n'
    );
  } else {
    const W = 34;
    process.stdout.write('differential — ' + loaded.length + ' implementation(s)\n');
    for (const a of loaded) process.stdout.write('  + ' + a.name + ' ' + a.version + '\n');
    for (const a of broken) process.stdout.write('  ! ' + a.file + ' NOT LOADED: ' + a.loadError + '\n');
    process.stdout.write('\n' + 'case'.padEnd(W) + loaded.map((a) => a.name.slice(0, 14).padEnd(16)).join('') + 'verdict\n');
    process.stdout.write('-'.repeat(W + 16 * loaded.length + 12) + '\n');

    for (const r of rows) {
      const label = r.case.id.length > W - 2 ? r.case.id.slice(0, W - 3) + '..' : r.case.id;
      const cells = r.cells
        .map((x) => (x.accept === null ? 'ERR' : x.accept ? 'accept' : 'reject').padEnd(16))
        .join('');
      let v;
      if (!r.unanimous) v = '*** DISAGREE ***';
      else if (!r.matchesCorpus) v = 'corpus says ' + r.case.expect;
      else v = 'ok';
      process.stdout.write(label.padEnd(W) + cells + v + '\n');
    }

    if (disagreements) {
      process.stdout.write('\n--- disagreements, with the governing rule ---\n');
      for (const r of rows.filter((x) => !x.unanimous)) {
        process.stdout.write('\n' + r.case.id + '\n  ' + r.case.uri + '\n  rule: ' + r.case.rule + '\n');
        for (const x of r.cells) {
          process.stdout.write('    ' + x.adapter.padEnd(18) + (x.accept === null ? 'ERROR ' : x.accept ? 'accept' : 'reject') + (x.reason ? '  (' + x.reason + ')' : '') + '\n');
        }
      }
    }

    process.stdout.write(
      '\nsummary: ' + rows.length + ' cases, ' + disagreements + ' disagreement(s), ' +
        adapterFailures + ' with adapter error(s), ' + loaded.length + ' adapter(s)\n'
    );
  }

  process.exit(disagreements === 0 && adapterFailures === 0 ? EXIT_OK : EXIT_DISAGREE);
}

main().catch((e) => die('runner crashed: ' + String(e && e.stack ? e.stack : e)));
