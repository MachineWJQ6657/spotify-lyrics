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

**With a single display nothing is shown.** `--syllable-secondary-test` refuses
to start when the computer has one display (exit code 3), and the launcher and
`smoke.sh` then start the instance with `--syllable-hidden-test` instead: the
pages load and answer over CDP, but no window, tray icon or global shortcut
exists. In that mode the lookup, the search page (`verify-browse.mjs`), the
view sweep and the main-thread tools work; the lyric list does not follow the
clock (`verify-lyric-list.mjs` fails), the overlay is never shown, and the
`--syllable-qa-view=overlay-*` views cannot run.

`cdp.mjs` also has `hover`, `click`, `key`, `wheel`, `dblclick` and `sized`
(a screenshot at another viewport size). A page is named by a URL suffix
(`=index.html`, `=#/overlay`). In Git Bash, set `MSYS_NO_PATHCONV=1` when an
argument starts with `=#/`, and pass output files as relative paths.

Checks that need no audio:

- `node scripts/verify-source-chain.mjs` simulates listening verdicts and walks
  the real source-switching chain. Run it after any change to
  `listen-controller.ts`, `lyrics-source.ts`, `setLyricsSource` or the lookup.
- `node scripts/qa/verify-lyric-list.mjs` moves the lyric clock through a
  debugger-only hook (the player is not touched) and checks that a new line
  scrolls smoothly and ends centred, that a right-click keeps the list
  following, that Esc closes the find bar from anywhere, and that lyric text
  can be selected. Run it after changes to `LyricsStage.tsx`.
- `node scripts/qa/verify-browse.mjs ["query"] [screenshot prefix]` walks the
  "查歌词" page: searches a song by text (live requests to LRCLIB and
  NetEase), opens the first hit and checks the reader (from the top, every
  row alike, nothing followed, the playing song untouched), Esc back to the
  results, the search kept across pages, and a library song opened from the
  library page. Run it after changes to `BrowseView.tsx`, `useBrowseStore.ts`,
  `electron/song-search.ts` or the `reading` mode of `LyricsStage.tsx`.
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

Two more checks use the same files and run offline:

```bash
bash scripts/qa/provider-compare/bundle.sh .qa-scratch/lyrics-old.mjs <git ref> src/lib/lyrics.ts
bash scripts/qa/provider-compare/bundle.sh .qa-scratch/lyrics-new.mjs "" src/lib/lyrics.ts
node scripts/qa/provider-compare/saved-row-assignment.mjs .qa-scratch/library-originals.json .qa-scratch/lyrics-old.mjs .qa-scratch/lyrics-new.mjs
node scripts/qa/provider-compare/untranslated.mjs .qa-scratch/provider-new.mjs .qa-scratch/lyrics-new.mjs .qa-scratch/library-originals.json .qa-scratch/http-cache
```

- `saved-row-assignment.mjs` lists the saved translation / romaji rows that a
  change to `src/lib/lyrics.ts` (parsing, `alignSecondaryTrack`,
  `visibleTracks`) would show on another row. Such a change acts on every
  saved song at once, without a lookup.
- `untranslated.mjs` counts displayed rows without a Chinese translation and
  names the songs with the most. Look at what those rows are before trusting
  the number: this is how the staff credits shown as lyrics and the lost half
  of 猫日's translation were found.

## Playback clock simulation

```bash
bash scripts/qa/clock-sim/run.sh                      # every scenario
bash scripts/qa/clock-sim/run.sh sim-repeat-seek      # one
```

Runs the real worker body of `electron/local-spotify.ts` and the real
`LocalSpotifyService` on a virtual clock (`harness.mjs`; only the native
client, koffi, timers and `Date.now` are replaced). No Spotify, no audio, no
window. The scenarios print what the renderer's clock shows against where the
audio is: a track change followed by a correction, pausing (from Spotify and
from Syllable's button), a song reached by skipping while paused, a seek and
main's refresh after it, a status flap, and a second seek to the same line.
Run it after any change to `local-spotify.ts`, `native-clock.ts` or the gate
functions; it is the only check of that code that needs no live playback, and
it does not replace one.

## Spotify crossfade

```bash
bash scripts/qa/launch-test-instance.sh
node scripts/qa/fade-watch.mjs            # read-only, 60 s; needs the Web API token of the live check
```

With "crossfade songs" on, Spotify reports each song to the media session
shorter by the crossfade time: a picked song drops about five seconds in
(Lemon 256 116 -> 249 116 ms with a 7 s crossfade), a song reached by the
previous one running out is short from its first sample, and the hand-over
happens that many seconds before the recording ends. Positions are not
shifted. `fade-watch.mjs` prints the Web API's length next to the media
session's ("short by 7000") while the user listens; it never touches the
player. The app keeps lyric matching on the recording's own length
(`src/lib/fade-trim.ts`, `LocalSpotifyService`); its log line is
`crossfade: reported length ... shortened by ...`, and a lookup shows the two
lengths as `spotifyDuration=` / `sourceDuration=`. Changing the crossfade
setting in the middle of a song can leave Spotify's position seconds ahead of
its audio for the rest of that song (seen once: +4.2 s).

## Performance

```bash
powershell -File scripts\qa\perf.ps1 -Name Syllable.exe -Match 'release\current'   # the user's app, read-only
powershell -File scripts\qa\perf.ps1 -Name electron.exe -Match '.qa-test-profile'    # the test instance
node scripts/qa/page-metrics.mjs 20        # renderer work per window (they share one process)
node scripts/qa/trace-frames.mjs 10        # frames drawn, grouped into bursts
node scripts/qa/page-profile.mjs index.html 15
node scripts/qa/main-profile.mjs 15        # main process JS; launch with --inspect=9339
node scripts/qa/main-stalls.mjs 60 25      # each stretch the main thread was busy 25 ms or longer, and in what
```

`perf.ps1` prints the CPU of each process of one instance (percent of one
core) and its GPU engine time. `trace-frames.mjs` records a Chromium trace and
groups the drawn frames into bursts: with one window visible, each burst is
one repaint, e.g. one lyric line change, and its frame count is what it costs.
On a 240 Hz display every CSS transition draws a frame per refresh; the
transparent overlay is copied back from the GPU on each, so a 160 ms word fade
cost 40 frames until 0.4.77 (now 4, with `steps(3, end)`).

Measured on 2026-11-16 (16-core Ryzen, 240 Hz): the app idle 1.1% of a core;
the overlay alone 2.7% (0.4.76: 3.3%, and 28% on a word-timed song); both
windows 6.5% (0.4.76: 9.5%). Real playback is noisy (an interlude draws
nothing, a new song starts a lookup): compare builds side by side on the same
song, e.g. the deployed build as a second instance with its own profile
(`release/current/Syllable.exe --user-data-dir=<repo>/.qa-old-profile
--remote-debugging-port=9334 --syllable-secondary-test`), with listening off in
both test profiles. `window.__syllablePlaybackHold = true` (with
`__syllableQa`) stops a window following the player, so the clock hook can
drive it while the user listens; `verify-lyric-list.mjs` sets it.

## Live playback check

```bash
node scripts/qa/spotify-api.cjs login --client-id=<the Syllable dev app>   # once; the user approves the consent page
bash scripts/qa/launch-test-instance.sh
node scripts/qa/live-check.mjs
node scripts/qa/live-analyse.mjs
bash scripts/qa/quit-test-instance.sh
```

`live-check.mjs` plays the current track on this PC's Spotify (the device named
`%COMPUTERNAME%`, never another one) and reads what the test instance shows
every 8 ms: the position of the progress bar, the active lyric row and the
list's scroll. It pauses and resumes from Spotify and from Syllable's button
(also a quick pause and play), clicks a lyric row and then the same row twice
more, skips to the next track and lets a song end. If the player was paused,
the volume is 0 throughout and the track, position, paused state and volume
are restored at the end. `live-analyse.mjs` compares the shown position with
the Web API's and lists every backward or forward move of the shown clock.
On 0.4.76 (2026-11-15): shown position within 16-69 ms of the Web API on
three tracks, pauses held exactly where Spotify stopped, each click on a row
landed on that row, 30 of 31 line changes scrolled smoothly.

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
   prepends the notes to `TODO.md` and `CONTINUATION.md` (working notes kept on this computer; git ignores them).
9. Commit and push (the pre-push guard refuses profiles, recordings, models and release output).

Patches whose text contains backslashes are written as files, never through a
shell heredoc: the heredoc collapses `\\n` into a real newline.
