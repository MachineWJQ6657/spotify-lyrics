# QA and release tools

Everything here works on an **isolated test instance**: the dev build with its
own profile in `<repo>/.qa-test-profile` (git-ignored), CDP on port 9333, shown
only on the secondary display (`--syllable-secondary-test`). The user's own
Syllable profile and running instance are touched by `deploy.ps1` alone.

## Test instance

```bash
npm run build
bash scripts/qa/launch-test-instance.sh      # starts it; logs go to .qa-scratch/
node scripts/qa/cdp.mjs targets              # the three pages: main, #/overlay, #/overlay-controls
node scripts/qa/cdp.mjs shot "=index.html" .qa-scratch/main.png
node scripts/qa/cdp.mjs eval "=#/overlay" "document.querySelector('.overlay-primary')?.textContent"
bash scripts/qa/quit-test-instance.sh        # graceful quit, reports leftovers and error.log
```

`cdp.mjs` also has `hover`, `click`, `key`, `wheel`, `dblclick` and `sized`
(a screenshot at another viewport size). A page is named by a URL suffix
(`=index.html`, `=#/overlay`). In Git Bash, set `MSYS_NO_PATHCONV=1` when an
argument starts with `=#/`, and pass output files as relative paths.

Checks that need no audio:

- `node scripts/verify-source-chain.mjs` simulates listening verdicts and walks
  the real source-switching chain. Run it after any change to
  `listen-controller.ts`, `lyrics-source.ts`, `setLyricsSource` or the lookup.
- `powershell -File scripts\qa\post-wm-close.ps1` posts WM_CLOSE (what Alt+F4
  sends) to the test instance's windows; all three must survive.
- `./node_modules/electron/dist/electron.exe scripts/verify-overlay-contrast.cjs`
  and `scripts/verify-overlay-paint.cjs` check the overlay's styles.

## What the user's library looks like

```bash
./node_modules/electron/dist/electron.exe scripts/qa/library-stats.cjs .qa-user-data-preupdate-<n>
```

A read-only summary of a profile **backup** (never the profile of a running
app): songs by language and source, listening verdicts, songs without a Chinese
translation, provider revisions, and the display settings. Real data found the
missing translations for music-video cuts, the songs that predate the provider
list, and that the overlay was switched off; look at it before deciding what to
improve.

Do not click the copy items of the lyric menu in a test: they overwrite the
real clipboard. Do not toggle "start at login": it writes the real login items.

## Release

1. Add the release's user-facing entry to `CHANGELOG` in `src/lib/changelog.ts`.
2. `python scripts/qa/bump.py . <old> <new> [checks.txt]` bumps the version and
   inserts new verifier checks (a file of JS object lines) into
   `scripts/verify-package.cjs`.
3. `npm run build && npx vitest run`
4. `npx electron-builder --win dir -c.directories.output=release/candidate-<n>`
5. `node scripts/verify-package.cjs release/candidate-<n>/win-unpacked` (exit 0, no failed check)
6. `bash scripts/qa/smoke.sh candidate-<n>`
7. `powershell -File scripts\qa\deploy.ps1 -Candidate candidate-<n> -Old <old> -New <new> -Recycle <older backup>`
8. `python scripts/qa/docs.py . <old> <new> <oldChecks> <newChecks> <todo.md> <cont.md> "<previous CONTINUATION heading>"`
   prepends the notes to `TODO.md` and `CONTINUATION.md`.
9. Commit and push (the pre-push guard refuses profiles, recordings, models and release output).

Patches whose text contains backslashes are written as files, never through a
shell heredoc: the heredoc collapses `\\n` into a real newline.
