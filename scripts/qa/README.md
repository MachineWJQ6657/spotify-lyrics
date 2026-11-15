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

## Comparing two builds of the lyrics provider

After a change to `electron/lyrics-provider.ts`, run the old and the new build
on songs of the user's library and read every difference. The provider HTTP is
cached per song, so both builds see the same responses and a second run is
offline. The 0.4.71 fixes were checked this way on 142 songs; the comparison
found three side effects that no synthetic test had.

```bash
npm run build
./node_modules/electron/dist/electron.exe scripts/qa/provider-compare/dump-originals.cjs .qa-user-data-preupdate-<n> .qa-scratch/library-originals.json
bash scripts/qa/provider-compare/bundle.sh .qa-scratch/provider-old.mjs <git ref of the old build>
bash scripts/qa/provider-compare/bundle.sh .qa-scratch/provider-new.mjs
node scripts/qa/provider-compare/compare.mjs .qa-scratch/provider-old.mjs .qa-scratch/provider-new.mjs .qa-scratch/library-originals.json .qa-scratch/http-cache .qa-scratch/compare.json --every 3 --offset 0
node scripts/qa/provider-compare/show.mjs .qa-scratch/compare.json
node scripts/qa/provider-compare/inspect.mjs .qa-scratch/provider-old.mjs .qa-scratch/provider-new.mjs .qa-scratch/library-originals.json .qa-scratch/http-cache "<song name>" <from s> <to s>
```

`--every 3 --offset 0` takes every third song (about 70 of 213, twelve minutes
with live requests); `--names names.json` takes the named songs. `inspect.mjs`
prints the original rows of a time range, each build's translation rows there
and the NetEase entries' own rows; add `romaji` as the last argument for the
romanization. Rebuild `provider-new.mjs` after each edit. Everything written
here is the user's library or provider responses and stays in `.qa-scratch/`.

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
