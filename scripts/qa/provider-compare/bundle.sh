#!/bin/bash
# Bundles electron/lyrics-provider.ts into one ES module that Node can import
# (fetchLyrics and the other exports), from the working tree or from a git ref.
#
#   bash scripts/qa/provider-compare/bundle.sh <out.mjs> [git ref] [entry file]
#
# The entry defaults to electron/lyrics-provider.ts; src/lib/lyrics.ts gives the
# renderer's parsing and row assignment (for untranslated.mjs and
# saved-row-assignment.mjs). Pass "" as the ref to bundle the working tree.
#
# A ref is extracted into .qa-scratch/ref-<ref>/ (git-ignored, inside the repo
# so imports still resolve against node_modules), bundled from there, and the
# extracted copy is removed again: vitest would collect its test files.
cd "$(dirname "$0")/../../.." || exit 1
OUT="$1"; REF="$2"; SOURCE="${3:-electron/lyrics-provider.ts}"
[ -n "$OUT" ] || { echo "usage: bundle.sh <out.mjs> [git ref] [entry file]"; exit 1; }
ENTRY="$SOURCE"
if [ -n "$REF" ]; then
  DIR=".qa-scratch/ref-$(echo "$REF" | tr -c 'A-Za-z0-9._-' '_')"
  rm -rf "$DIR"; mkdir -p "$DIR"
  git archive "$REF" electron src | tar -x -C "$DIR" || exit 1
  ENTRY="$DIR/$SOURCE"
fi
npx esbuild "$ENTRY" --bundle --format=esm --platform=node --external:electron --outfile="$OUT" --log-level=warning
STATUS=$?
[ -n "$REF" ] && rm -rf "$DIR"
[ $STATUS -eq 0 ] || exit 1
echo "bundled ${REF:-working tree} -> $OUT"
