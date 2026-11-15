#!/bin/bash
# Smoke-tests a packaged candidate on the SECONDARY display only, in a copy of
# the isolated test profile: version, a console sweep through every view, the
# overlay showing, a graceful quit, and the error log.
#
#   npx electron-builder --win dir -c.directories.output=release/candidate-0469
#   node scripts/verify-package.cjs release/candidate-0469/win-unpacked
#   bash scripts/qa/smoke.sh candidate-0469
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd -W 2>/dev/null || pwd)"
[ -n "$1" ] || { echo "usage: smoke.sh <candidate directory under release/>"; exit 1; }
export MSYS_NO_PATHCONV=1
EXE="./release/$1/win-unpacked/Syllable.exe"
[ -f "$EXE" ] || { echo "missing $EXE"; exit 1; }
P="$ROOT/.qa-smoke-profile"
mkdir -p .qa-scratch .qa-test-profile
rm -rf "$P"; cp -r "$ROOT/.qa-test-profile" "$P"; rm -f "$P/lockfile" "$P/error.log" "$P/main-window.json"
: > "$ROOT/.qa-scratch/smoke.log"
(nohup $EXE "--user-data-dir=$P" --remote-debugging-port=9333 --disable-features=CalculateNativeWinOcclusion --syllable-secondary-test "--syllable-qa-log=$ROOT/.qa-scratch/smoke.log" > "$ROOT/.qa-scratch/smoke.out" 2>&1 &)
sleep 12
node scripts/qa/cdp.mjs eval "=index.html" "JSON.stringify({ v: document.querySelector('.version')?.textContent, screenX, badge: document.querySelector('.source-badge em')?.textContent, groups: document.querySelectorAll('.lyric-group').length })"
node scripts/qa/ui-sweep.mjs 2>&1 | tail -1
node scripts/qa/cdp.mjs eval "=index.html" "window.syllable.overlay.show()" > /dev/null; sleep 2.5
grep -E "overlay (shown|show failed)" "$ROOT/.qa-scratch/smoke.log" | tail -1 | cut -c1-120
node scripts/qa/cdp.mjs eval "=index.html" "window.syllable.overlay.hide()" > /dev/null
$EXE "--user-data-dir=$P" --syllable-quit; sleep 3
left=$(powershell.exe -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='Syllable.exe'\" | Where-Object { \$_.CommandLine -match 'qa-smoke-profile' }).Count" | tr -d '\r')
echo "after graceful quit: left=$left"
[ -f "$P/error.log" ] && { echo "error.log:"; cat "$P/error.log"; } || echo "no error.log"
grep -E "main error" "$ROOT/.qa-scratch/smoke.log" | head -3
