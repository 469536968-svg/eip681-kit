#!/usr/bin/env bash
# RECOVER_AND_SCAN.sh — one-shot recovery + the unfinished task.
#
# Written 2026-11-02 while exec was dead (every call returned GBK "system cannot find
# the path specified" with EMPTY stdout, even for `pwd`). Purpose: whichever session
# or human runs this next should not have to rediscover anything.
#
# Run from a shell that works:   bash ~/workspace/eip681-kit/RECOVER_AND_SCAN.sh

set -u
echo "=== 1. environment reality check ==="
echo "pwd      : $(pwd 2>&1)"
echo "HOME     : ${HOME:-<unset>}"
echo "node     : $(command -v node 2>/dev/null || echo '<not on PATH>')"

NODE=""
for c in \
  "$(command -v node 2>/dev/null)" \
  /c/Users/HUAWEI/.workbuddy/binaries/node/versions/*/node.exe \
  /c/Program\ Files/nodejs/node.exe
do
  [ -n "$c" ] && [ -x "$c" ] && NODE="$c" && break
done
if [ -z "$NODE" ]; then
  echo "FATAL: no node.exe found. Searched PATH + .workbuddy/binaries/node/versions/*"
  exit 1
fi
echo "node used: $NODE  ($("$NODE" --version 2>&1))"

echo
echo "=== 2. locate the repo (do NOT assume ~/workspace exists) ==="
REPO=""
for d in "$HOME/workspace/eip681-kit" "$HOME/eip681-kit" "$(pwd)"; do
  [ -f "$d/package.json" ] && REPO="$d" && break
done
if [ -z "$REPO" ]; then
  echo "FATAL: eip681-kit not found. Find it:"
  echo "  find \"\$HOME\" -maxdepth 4 -name package.json -path '*eip681*' 2>/dev/null"
  exit 1
fi
echo "repo     : $REPO"
cd "$REPO" || exit 1

echo
echo "=== 3. confirm the last shipped commit is intact ==="
git log --oneline -1 2>&1
echo "expected a7ba8e9 (typed distribution, 11 gates / 421 assertions)"
echo "worktree : $(git status --porcelain 2>&1 | wc -l) modified file(s)"

echo
echo "=== 4. re-verify the suite (cheap, proves the tree still builds) ==="
"$NODE" types.test.mjs                2>&1 | tail -1
"$NODE" test.mjs                       2>&1 | tail -1
"$NODE" deriveEip681.test.mjs          2>&1 | tail -1
"$NODE" conformance/check.mjs conformance/adapters/kit.mjs 2>&1 | tail -1

echo
echo "=== 5. THE UNFINISHED TASK: find live, unanswered EIP-681 targets ==="
if [ -z "${GITHUB_TOKEN:-}${GH_TOKEN:-}" ]; then
  echo "FATAL: GITHUB_TOKEN / GH_TOKEN not exported into this env."
  echo "Without it the search API is 10 req/min and will throttle; the scan needs auth."
  exit 1
fi
export GITHUB_TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"
"$NODE" tools/find_targets.mjs 2>&1 | tail -40

echo
echo "=== done. If section 5 printed live candidates, pick exactly ONE ==="
echo "Read the full issue + every existing comment first. Then post ONE reply"
echo "(D6: one run = one post; dedup with normalized comparison before POST)."
