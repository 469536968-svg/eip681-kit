@echo off
setlocal
set GIT=C:\Users\HUAWEI\.workbuddy\binaries\PortableGit\versions\1.3.0\cmd\git.exe
cd /d C:\Users\HUAWEI\workspace\eip681-kit
"%GIT%" --version
echo [stage]
"%GIT%" add amount-precision.test.mjs README.md
"%GIT%" status --short
echo [commit]
"%GIT%" -c user.name="469536968-svg" -c user.email="469536968-svg@users.noreply.github.com" commit -F commitmsg.txt
echo [push]
"%GIT%" push origin HEAD:main
"%GIT%" rev-parse HEAD
"%GIT%" status --short
echo DONE
