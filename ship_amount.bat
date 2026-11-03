@echo off
setlocal enabledelayedexpansion
cd /d C:\Users\HUAWEI\workspace\eip681-kit

set GIT=
for /f "delims=" %%G in ('where git 2^>nul') do if not defined GIT set GIT=%%G
if not defined GIT if exist "C:\Program Files\Git\cmd\git.exe" set GIT=C:\Program Files\Git\cmd\git.exe
if not defined GIT if exist "C:\Program Files\Git\bin\git.exe" set GIT=C:\Program Files\Git\bin\git.exe
if not defined GIT if exist "C:\Users\HUAWEI\AppData\Local\Programs\Git\cmd\git.exe" set GIT=C:\Users\HUAWEI\AppData\Local\Programs\Git\cmd\git.exe
if not defined GIT if exist "C:\Program Files (x86)\Git\cmd\git.exe" set GIT=C:\Program Files (x86)\Git\cmd\git.exe
if not defined GIT (
  echo GIT_NOT_FOUND
  exit /b 2
)
echo GIT=!GIT!
"!GIT!" --version

echo [stage]
"!GIT!" add amount-precision.test.mjs README.md
"!GIT!" status --short

echo [commit]
"!GIT!" -c user.name="469536968-svg" -c user.email="469536968-svg@users.noreply.github.com" commit -m "verify: 3 EIP-681 amount defects by execution (21 assertions)" -m "Reproduces, against the PUBLISHED packages eth-url-parser and @metamask/controller-utils, three amount-handling defects found while answering MetaMask/metamask-mobile#37818." -m "1. Parser emits exponent notation: a 21-digit value comes back as the string 1e+21, so a naive digit-only amount test REJECTS a valid 10^21 wei amount. Measured over a 1..40 digit sweep in both value and uint256 forms: the naive test drops 38 of 80 cases." -m "2. toHex throws Invalid character on exponent notation, and only uint256 is normalised before routing. Large uint256 is safe; large value throws, so a large-valued link surfaces the same misleading generic error as an amount-less one." -m "3. value=0 parses to the string 0, which is TRUTHY, so a truthiness check builds a 0-value transaction headed to confirmation. An empty value is falsy. Neither should confirm." -m "Fix keeps two predicates separate (amount presence vs routing decision) and expands exponent notation with string arithmetic before any digit test." -m "Scope: models caller control flow driven by the genuine packages; does not run MetaMask's own test suite. That limitation is stated in the README."

echo [push]
"!GIT!" push origin HEAD:main
"!GIT!" rev-parse HEAD
"!GIT!" status --short
echo DONE
