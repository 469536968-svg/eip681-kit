# Consuming eip681-kit without npm

This file exists to correct a claim I carried in my own notes for three weeks:
that eip681-kit was unusable until it was published to the npm registry.

**It was usable the whole time.** No registry account, no publish token, and no
tarball are needed to consume it, because CDNs can fetch straight from the GitHub
repo. Everything below was executed, not inferred.

## Verified install path: a pinned commit, fetched as files

Pin a **commit sha**, not a branch and not the `v1` tag. Two measured reasons:

- `cdn.jsdelivr.net/gh/<owner>/<repo>@v1/` returned **HTTP 404** for me even though
  the `v1` tag exists in the repo (jsDelivr resolves tag snapshots on demand).
- `@main` returned `HTTP 200` on some runs and timed out (`HTTP 0`) on others.

A commit sha was served reliably. Measured on commit `7e4001e3`:

```
files fetched ................. 3   (index.mjs, eip681.mjs, deriveEip681.mjs)
every file byte-identical to
  the local checkout .......... true
exported names ................ 14
module imports and parses ..... true
```

Byte-identity matters: it means the CDN is serving the exact code my own test
suite ran against, not a stale snapshot that only *looks* like the same release.

### What to do

Fetch the three files into one local directory and import `index.mjs` from disk.
This is the path I measured end to end; it needs no bundler and no install:

```js
// after placing index.mjs, eip681.mjs, deriveEip681.mjs in ./vendor/eip681-kit/
import { parse } from './vendor/eip681-kit/index.mjs';
```

The imports between those three files are **relative** (`./eip681.mjs`). That is why
you must mirror all three into one directory, or use a CDN that rewrites specifiers —
plain jsDelivr *file* URLs do not rewrite them, so importing a single file from a CDN
will fail on the relative imports unless its siblings are resolvable at the same path.

## Assertions actually executed on the fetched copy

Parsed `ethereum:0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359?value=2.014e18`:

| check | result |
|---|---|
| `ok === true` | pass |
| `target` is the URI's address | pass |
| `canonical` round-trips to the input exactly | pass |
| warning `no-chain-id` emitted | pass |
| over-short address (`0xdeadbeef`) rejected | pass |
| over-long address (64 hex digits) rejected | pass |

Two of those are **negative controls**. Without them, "returns `ok:true` on valid
input" is also satisfied by a function that returns `ok:true` unconditionally —
which is the exact bug this kit exists to catch. A pass-only suite proves nothing.

### The shape of the parse result

Two things surprised me and are worth stating so they do not surprise you:

- The recipient is **`target`**, not `to` or `address`. I asserted on `to` first and
  got a false failure. The parser was right; my assertion was wrong.
- `amount` is a **`BigInt`**, not a string or number:
  `2014000000000000000n` for `value=2.014e18`. So `JSON.stringify(result)` throws
  `TypeError: Do not know how to serialize a BigInt`. That is the caller's problem
  to solve — a `replacer` of `(k, v) => typeof v === 'bigint' ? v.toString() : v`
  is enough. It is not a defect: a `Number` there would silently lose precision on
  18-decimal amounts, which is worse.

Warnings arrive as structured objects, not strings:

```json
{ "code": "no-chain-id",
  "message": "no chain id (@) present; the same address can exist on multiple chains, so a wallet may pick the wrong one" }
```

## Measured negative: `npm install github:<repo>` does not work here

I previously listed this as "unmeasured". It is now measured, and it fails:

```
command:  npm install github:469536968-svg/eip681-kit
result:   exit 1 after 1.1s
error:    npm error code ENOENT
          npm error syscall spawn git
          npm error path git
```

npm shells out to `git` to resolve a `github:` specifier, and **`git` is not present
on this host** (confirmed independently: `spawn git --version` → `ENOENT`; no binary
under Program Files, Program Files (x86), LOCALAPPDATA, or scoop). So the `github:`
install path is **unavailable here** — not "probably fine".

What that means if your machine *does* have git: the install will clone the repo and
run no build step (there is nothing to build — it ships ESM sources), and it is not
constrained by a `files` field because the repo has none; npm packs the whole checkout.
**I have not executed that variant**, so treat the *on-a-git-host* behaviour as
reasoned rather than verified. The verified path from this host is the pinned-commit
file copy above.

The npm registry is **not** part of any path in this document. Nothing here needed it.

## Why this file exists

My own worklog said, for three weeks, that the blocker was a Creator action item:
`npm publish`. That was wrong, and the cost of the error was real — it kept me from
pointing anyone at a working install for weeks while I waited on something that was
never required. The fix was to test the claim instead of restating it.

MIT licensed. The code is at <https://github.com/469536968-svg/eip681-kit>.
