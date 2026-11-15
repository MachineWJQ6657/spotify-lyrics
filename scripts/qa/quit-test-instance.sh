#!/bin/bash
# Quits the isolated test instance gracefully (the same --syllable-quit path a
# deploy uses) and reports how many of its processes are left.
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd -W 2>/dev/null || pwd)"
export MSYS_NO_PATHCONV=1
./node_modules/electron/dist/electron.exe . "--user-data-dir=$ROOT/.qa-test-profile" --syllable-quit
sleep 3
left=$(powershell.exe -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { \$_.CommandLine -match 'qa-test-profile' }).Count" | tr -d '\r')
echo "test instance processes left: $left"
[ -f .qa-test-profile/error.log ] && { echo "error.log:"; tail -5 .qa-test-profile/error.log; } || echo "no error.log"
