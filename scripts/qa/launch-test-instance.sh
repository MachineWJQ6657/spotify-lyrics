#!/bin/bash
# Launches the dev build (out/, after `npm run build`) as an ISOLATED test
# instance: its own profile in <repo>/.qa-test-profile (git-ignored), CDP on
# port 9333, and only on the secondary display (--syllable-secondary-test).
# It never touches the user's own Syllable profile or its running instance.
#
#   bash scripts/qa/launch-test-instance.sh [extra electron args]
#   node scripts/qa/cdp.mjs targets
#   bash scripts/qa/quit-test-instance.sh
#
# Occlusion tracking is off so CDP screenshots render while the window is covered.
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd -W 2>/dev/null || pwd)"
# Without a build Electron shows an error dialog on the PRIMARY screen ("Unable to find Electron app").
[ -f out/main/main.js ] && [ -f out/renderer/index.html ] || { echo "no build in out/: run npm run build first"; exit 1; }
mkdir -p .qa-test-profile .qa-scratch
export MSYS_NO_PATHCONV=1
nohup ./node_modules/electron/dist/electron.exe . "--user-data-dir=$ROOT/.qa-test-profile" --remote-debugging-port=9333 \
  --disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding --syllable-secondary-test \
  "--syllable-qa-log=$ROOT/.qa-scratch/test-instance.log" "$@" > "$ROOT/.qa-scratch/test-instance.out" 2>&1 &
