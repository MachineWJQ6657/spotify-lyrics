#!/bin/bash
# Runs the playback-clock scenarios against the working tree: the real worker
# body of electron/local-spotify.ts and the real LocalSpotifyService on a
# virtual clock (harness.mjs). No Spotify, no audio, no window; synthetic data.
#
#   bash scripts/qa/clock-sim/run.sh [scenario name ...]
#
# The bundles and copies of the scenarios go to .qa-scratch/clock-sim/ (inside
# the repo, so the bundled service still resolves its native modules).
cd "$(dirname "$0")/../../.." || exit 1
OUT=.qa-scratch/clock-sim
mkdir -p "$OUT"
cp scripts/qa/clock-sim/*.mjs "$OUT"/
npx esbuild electron/local-spotify.ts --bundle --format=esm --platform=node --external:electron --external:koffi --external:libspotifyctl \
  "--alias:node:worker_threads=./$OUT/worker-threads-stub.mjs" --outfile="$OUT/local-spotify.bundle.mjs" --log-level=warning || exit 1
npx esbuild src/lib/clock.ts --bundle --format=esm --platform=node --outfile="$OUT/clock.bundle.mjs" --log-level=warning || exit 1
cd "$OUT" || exit 1
for scenario in ${@:-sim-s1-hold-after-track-change sim-s2-s3-s5 sim-s2b-pause-button sim-s4-seek-refresh sim-s5b-logged-flap sim-repeat-seek}; do
  echo "=== $scenario"
  node "$scenario.mjs" || exit 1
done
