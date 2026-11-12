# Syllable continuation checkpoint

## Current state (read first)

- **Deployed:** 0.4.56 at `release/current/Syllable.exe`; the desktop and Start Menu shortcuts point there with no arguments. Rollback: `release/current-0.4.55-backup-20261112`. Profile backups (ignored): `.qa-user-data-preupdate-04xx`.
- **Workflow:** feature commits on `main`, pushed to `origin`.
  - `scripts/git-hooks/pre-push` and `npm run verify:repo` block artifacts.
  - GitHub Actions CI (`.github/workflows/ci.yml`) runs build, tests and the guard on windows-latest.
  - Package with `npx electron-builder --win dir -c.directories.output=release/candidate-<ver>-<date>`, then `node scripts/verify-package.cjs <dir>/win-unpacked` (77 checks).
  - Smoke-test in an isolated `--user-data-dir`, back up `%APPDATA%/syllable`, swap `current`, relaunch. Old versions go to the Recycle Bin.
- **Lyrics:** three community providers (LRCLIB / NetEase / Kugou).
  - NetEase translation alignment handles furigana, kana/kanji variants, split/merged rows and interludes. Missing translations are borrowed from sibling NetEase entries, or found by lyric-text search for romanized Spotify titles.
  - Romanized titles are verified against native kana.
  - Instrumentals show 纯音乐.
  - Audit tooling (scratchpad, not committed): bundle `electron/lyrics-provider.ts` with esbuild and run `fetchLyrics` per track **sequentially and paced**. LRCLIB allows a burst of ~20 requests refilled at ~3/s (429 `retry-after: 1`); Kugou `song_search_v2` silently returns an empty list (byte-identical to a real miss) for a large share of unsigned requests. Back-to-back audits measure those limits, not lyric quality (see 0.4.50).
- **Next-song prefetch (0.4.51, needs the optional Web API connection):** about 60 s before a song ends, `/me/player/queue` gives the next item; its lyrics go through the full pipeline and its generated romaji is cached, so the song change shows them at once. The user's normal profile is **not** connected yet (no `session.json`); without it nothing changes.
- **Romaji:** generated romaji matches NetEase human romaji on 89.8% of 3,022 lines (`ROMANIZATION_REVISION` 3).
- **Listening calibration (0.4.52, default on; Chinese and English since 0.4.53):** the app listens to a few 12 s loopback blocks, force-aligns the known lyric lines with the local RomajiASR CTC model (Chinese via pinyin, English via CMUdict, mapped to its morae) and stores a per-song display offset keyed by the lyric timing (`listenedOffset`). This fixes community files that are a constant 0.6–12 s early/late on Spotify's audio (the real cause of "lyrics too early"; see the 0.4.52 entry).
- **Sync:** SMTC and Web API positions match the audible content (±11 ms) on non-Mix transitions; re-measured 2026-11-12 with an independent loopback recorder: SMTC runs ~50–60 ms ahead of the audio.
  - Spotify no longer stores Mix recipes on disk (`list_player_*` replaced `context_player_state_restore`), so `spotify-transition.ts` finds nothing.
  - The open question is whether user-started Mix transitions time-stretch the incoming track (historical recipes 0.954→1.0 over ~26 s ⇒ ~1 s early lyrics). A reference-free rate estimator exists (see the 0.4.47 entry). A real Mix capture is still pending.
- **Overlay first paint (fixed in 0.4.49):** with the overlay hidden at startup (the user's saved setting), `ready-to-show` intermittently never fires, on Electron 44.2.0 as well as 44.11.1. The old retry waited for that once-per-window event again, so `showOverlay()` failed for the whole session. The earlier "44.11.1 hang" was this same delay (2 × 10 s) cut off by the test timeout, not an Electron regression. Electron is still 44.2.0; the 44.11.1 security update should be re-tested now that the fix is in.
- **Styles:** `src/styles.css` holds only what every window shares (reset, script font stacks) plus the overlay and hover controls; `scripts/verify-overlay-*.cjs` read it. The main window's design is `src/app.css` (tokens `--sy-*`), imported by `App.tsx`, so it ships as the App chunk's CSS and the overlay windows never load it.
- **UI QA:** launch the dev build with `--disable-features=CalculateNativeWinOcclusion`; otherwise a covered window reports `visibilityState=hidden`, the position clock stops (by design, `usePosition`) and CDP screenshots show 0:00. `Emulation.setDeviceMetricsOverride` checks the 1024×680 minimum layout.
- **Older history:** `docs/history/continuation-2026-09-12-to-10-23.md` (0.4.9–0.4.44, verbatim).

## 2026-11-12 / 0.4.56 deployed: GPU at ~20% while listening

- `release/current` = **0.4.56** (asar SHA256 `0541b90a4eb7d40523e371592b9375067c6dd741f4da24e02171004715886e35`, verifier 77/77, 1069 tests). Rollback: `release/current-0.4.55-backup-20261112`; the 0.4.54 backup went to the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0456`.
- **Bisected over CDP** in the isolated dev instance with automatic listening off. Each stage was started by hand from the renderer and the process CPU was sampled for 20 s (`scratchpad/cpu-dev.ps1`).
  - idle: GPU 2.3%
  - `getDisplayMedia` audio track held, video track stopped: 5.4%
  - plus AudioContext and worklet: 2.8%
  - stopped: 1.9%
  - **only the `.listen-pulse` dot, infinitely animated: 20.2%** (11.9% with the backdrop hidden, so 0.4.54 paid it too)
  - after removing the dot: 3.8%
- **Why:** an endless CSS animation keeps the compositor producing frames for the whole window; the capture pipeline is not the cost. The dot is now static. Measured during a real listening session: GPU 3.2–3.3%, and the song was still decided (Unrequited Love −51 ms → offset 0).
- **Verifier:** `staticListeningIndicator` added. The 0.4.55 player-bar check matched `.player-bar{`, but the renderer CSS is not minified (`.player-bar {`), so it passed without checking anything. Both regexes now allow whitespace and were confirmed against a failing sample.
- The renderer CSS ships unminified, so any CSS text check must tolerate whitespace.

## 2026-11-12 / 0.4.55 deployed: main-window redesign

- `release/current` = **0.4.55** (asar SHA256 `c6faa80a78545dbab6647899b716baead878f8f6179318fe3634d7ffe8e82a46`, verifier 76/76, 1069 tests). Rollback: `release/current-0.4.54-backup-20261112`; the 0.4.53 backup went to the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0455`.
- The user asked for a redesign ("界面不太好看，重新设计一下"). The old `styles.css` was four stacked themes (lavender/orange, then a Spotify layer, then font and 0.4.54 patches). A postcss pass (`scratchpad/split-css.cjs`, by class name) kept only overlay/shared selectors there; every main-window rule was rewritten in `src/app.css`.
- **Look:** a blurred album-art backdrop for the whole window (`Backdrop` in `App.tsx`; the previous cover stays under the new one while it fades in, and a missing thumbnail keeps the last). Lyrics sit directly on it (no card). Japanese lines use `word-break: auto-phrase`. The header has a 76 px cover and pill badges, and an `@container main` rule shrinks it below 540 px. The settings panel has four tabs (`syllable-ui-panel-tab` in localStorage) with the overlay toggle in a fixed footer, and `Range` paints the filled track through `--fill`.
- **Performance:** `backdrop-filter` on the player bar re-blurred the window behind it on every progress tick (GPU 20% vs 2%). It is gone, and the verifier fails if it returns. The static art layer's `filter: blur(90px)` is cheap. Same profile with listening off: 0.4.54 GPU 1.2–1.9% / renderer ~2.1%; 0.4.55 GPU 2.0–2.7% / renderer 1.7–2.7%.
- **GPU while listening:** about 20% until the song is decided. Resolved in 0.4.56: the cause was the indicator animation, not the capture.

## 2026-11-12 / 0.4.54 deployed: interaction and layout polish

- `release/current` = **0.4.54** (asar SHA256 `fc088dba9e7b3a6f48bcacb7379ea8d427f24f7931256a815116203ab4732f49`, verifier 75/75, 1067 tests). Rollback: `release/current-0.4.53-backup-20261112`; the 0.4.52 backup went to the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0454`.
- **Click a lyric line to play from it.** `lyricSeekTarget` (`src/lib/seek.ts`) inverts `calibratedPosition`: the line at `startMs` shows at Spotify position `startMs + offset` (per-song manual or listened offset). Session calibrations and audio anchors end at a seek, so they are deliberately not inverted. Hovering a line shows the target time; a mouse text selection is not a seek. Verified in the app: clicking a 0:15 line put Spotify at 15.36 s (read back over the Web API).
- **Keyboard** (`PlayerBar`): Space play/pause, ←/→ ±5 s, skipped for inputs, buttons, sliders and while the editor is open (`isShortcutTarget`).
- **Timing status** on the lyrics card (`src/lib/timing-status.ts`): session calibration → audio anchor → manual offset → listened offset → "正在听音校准…" (`listen-controller` now publishes `listeningTrackId` / `subscribeListening` while capture runs) → SPOTIFY TIMELINE.
- **Layout:** header badges stay on one row (source ellipsized, labeled 编辑 button); single-album names are not repeated; the settings panel collapses to a 52 px rail (localStorage `syllable-ui-panel-collapsed`, per window, not synced); the title bar names the current view; the listening switch no longer shrinks (`.switch { flex-shrink: 0 }`). New rules are one block at the end of `src/styles.css`.
- **Library:** filter (NFKC, case and space folding), 6 s undo after delete (`restoreLibraryDocument`, no-op when the song was saved again meanwhile), timing tags.
- **Editor:** Enter searches; time fields keep a draft and commit on Enter/blur (the old controlled input rejected every partial value, so times could only be pasted whole); the playing row is highlighted and scrolled to once the clock reports a position.

## 2026-11-12 / 0.4.53 deployed: listening calibration for Chinese and English lyrics

- `release/current` = **0.4.53** (asar SHA256 `fab99fc5b97cb0795c35a5399d59f6c49e8799d9330aa6af5326d91557fa6436`, verifier 72/72, 1052 tests). Rollback: `release/current-0.4.52-backup-20261112`; the 0.4.51 backup went to the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0453`.
- **How non-Japanese lines are placed.** The RomajiASR model only knows Japanese morae, so Chinese and English lyrics are mapped onto them:
  - Chinese: pinyin from `pinyin-pro` (3.29.4, context readings, both scripts) → `electron/audio-sync/mandarin-phones.ts`. Each syllable becomes a CV mora set (`xiang` → `sha|shi`, `?a`, `?N`).
  - English: CMUdict (`cmu-pronouncing-dictionary` 3.0.0) → `english-phones.ts`, the way katakana hears a word (`love` → `ra|ro|ru`, `?v|vu|bu`; post-vocalic R dropped).
  - Phone strings: `a|b` lists acceptable labels; a leading `?` marks an optional phone (codas, nasal endings, diphthong tails). `alignLines` can pass over optional phones at 1.5 nats each and leave a line early when its tail is optional. Lines are judged by required phones only.
  - Readings come from `pronunciation-worker.js` (a disposable worker, ~0.1 s, ~30 MB freed afterwards; both libraries are bundled into it, so they are devDependencies). Mixed zh/en lines use one tokenizer; digits, kana and unknown words end a line's usable prefix.
  - Lines scoring ≥ −1.5 are kept for zh/en (−1.2 for Japanese). Over 12 songs, lines at ≥ −1.5 were within 350 ms of their song's offset 90% of the time; below −1.8, none were.
  - English lyrics where < 75% of the words have a reading (Spanish, romaji) are skipped as `no-lines`.
- **Measurements (loopback + offline emulation of the in-app windows, 12 songs × 2 clips; Demucs check).**
  - CTC onset vs Demucs vocal onset: English median +20 ms (IQR 10–220). Chinese +100 ms (IQR 30–210), because sung Chinese lines often open with a soft glide or hum (緣 yu-, 也 ye-, 命 m-) that the energy threshold catches ~300 ms early. CTC lands on the strong vocal rise, so no correction is applied.
  - Relinking matters: Spotify plays a **254.6 s** Shape of You (catalog 233.7 s, 7 s longer intro); every provider's file is ~7.2 s early. Anti-Hero plays a 309 s version and its lines disagree, so it stays undecided. Someone Like You is +0.7 s; Viva La Vida +0.7–1.0 s; 光年之外 +0.3–0.5 s; Blinding Lights −0.2 s; the rest are within ±0.15 s.
  - In-app (isolated dev profile): Shape of You decided after 2 blocks (+7265 ms measured, offset +7120); afterwards lines appeared 0.27 s before to 0.23 s after the vocal. 光年之外 measured +321 ms → offset 0 (below the 250 ms minimum after the 150 ms lead). The packaged candidate measured Viva La Vida at +1000 ms → offset +850.
- **Language detection.** `detectLyricsLanguage` now ignores credit lines and the middle dot ・, and calls a text English when Latin words outnumber twice the Han characters. NetEase's "作词 : …" lines had made Viva La Vida "zh-Hans". Already-cached documents keep their stored language; the listener treats zh and en the same way.
- **Still open:** English words inside Japanese lines still end the line (Shout Baby, Pre-Romance). Korean is not listened to. Per-segment drift (Mix) is unchanged.

## 2026-11-12 / 0.4.52 deployed: listening calibration of lyric timing, consensus-outlier fix

- `release/current` = **0.4.52** (asar SHA256 `fe963c0ad09395f7446857001dd141b20aae6070dc1d8e4b7e9688365dffc53a`, verifier 71/71). Rollback: `release/current-0.4.51-backup-20261112`; the 0.4.50 backup went to the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0452`. Packaged isolated test: 修羅 decided after 3 blocks (+418 ms on the NetEase file chosen from SMTC metadata, spread 10 ms, offset +270) and persisted.

- **Root cause of "lyrics too early" (measured, not assumed).**
  - Method: a WASAPI loopback recorder (scratchpad tooling, not committed). Pause, seek to P, resume; the audio onset is position P. This agrees with raw SMTC to ±65 ms (SMTC runs ~50–60 ms ahead of the audio).
  - Lines are located with the repo's RomajiASR CTC model by forced alignment of the known lyric text: an HMM with filler between lines, skippable lines and a mild timing prior.
  - Demucs-separated vocal onsets agree with the CTC onsets: median +10 ms, IQR 0–90 ms, n=67.
  - Whisper word times were too coarse (±1 s) to be useful here.
  - Syllable adds no display lead.
  - Over 20+ songs, community files are often a constant 0.6–1.8 s early on Spotify's audio, frequently in all three providers. Examples: 春泥棒 +1.78, 斜陽 +1.3, Shout Baby (LRCLIB exact) +1.0, 残酷になりますように +2.8.
  - Others are within ±0.2 s.
  - Two durations-related cases:
    - Spotify plays a 305 s recording of ケセラセラ while its catalog says 272 s; every file runs 12.2 s early.
    - 春泥棒 SMTC reports 297.8 s versus 290.3 s in the catalog.
- **Listening calibration.** The listener is on by default when the local CTC runtime exists (`.tools/audio-sync`).
  - Files: `electron/audio-sync/lyric-offset.ts` (aligner + estimator), `lyric-offset-session.ts`, `src/lib/listen-controller.ts`, `src/lib/listened-offset.ts`.
  - **When it runs:** a playing song with a Japanese timed original that has not been measured for its current timing key, with no manual offset and no manual audio-sync mode active.
  - **Capture:** the renderer captures 12 s loopback blocks (`prepare('listen')`). Main analyses each block with a 3 s tail of the previous one (15 s, the runner's limit) and maps it to media time via the SMTC transport (`CAPTURE_LATENCY_MS` = 45, measured).
  - **Search:** ±30 s until an estimate exists, then ±6 s around it. The timing prior is 0.05 nats/phone/s.
  - **Decision:** at least 6 lines from at least 2 windows, MAD ≤ 160 ms, and 70% of lines within 350 ms. The offset is `median − 150 ms`; corrections under 250 ms become 0.
  - **Stops when:** a decision is made, playback pauses, the song changes, or 12 blocks pass. Two inconclusive or failed measurements per song per session also stop it.
  - **Storage:** `LyricsDocument.listenedOffset {timingKey, state, offsetMs, measuredDeltaMs, …}`. It is carried across provider refreshes, and applies only while the original timing key matches.
  - **Override:** a manual `offsetMs` wins. "本曲归零" marks it `dismissed`. A switch in the right panel turns it off.
  - **Verified in-app (isolated dev profile + parallel independent recording):**
    - 春泥棒: decided after 4 blocks. In-app +1886 vs offline +1793 at that point (93 ms = SMTC lead + capture latency).
    - ケセラセラ: +12.27 s in-app vs +12.16 s offline.
    - シンデレラ: offset 0.
    - After the 春泥棒 correction, CDP-observed line activations sit −31…+169 ms relative to the sung onsets (they were ~1.85 s early).
- **Consensus outlier removal** (provider revision **43**): `isTimelineConsensusOutlier` only reopened the pool. A shifted file that won on line density stayed selected (10月無口な君を忘れる: LRCLIB search file 1.5→4 s late; NetEase/Kugou within 0.4 s of the audio). Such outliers are now dropped when a consistent alternative remains.
  - A/B (157 songs, paced): 152 same.
  - 4 diffs were Kugou flakiness; replaying the same HTTP responses gave identical picks.
  - 1 intended change.
- Tests: 1033 pass. Package verifier: 71 checks (`listenedOffset`, `consensusOutlierDropped`, `providerRevision43`).

## 2026-11-11 / 0.4.51 deployed: NetEase-first timeline, next-song prefetch, romaji cache

- `release/current` = **0.4.51** (asar SHA256 `63430291604a1705e96ca0fb83ec1676f5179e28e72e1c651474e9c2a66eea0b`, verifier 69/69). Rollback: `release/current-0.4.50-backup-20261111`; the 0.4.49 backup went to the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0451`. Provider revision **42**. 1011 tests pass.
- **NetEase-first timeline** (user: NetEase's library is more complete and better). `preferredNeteaseTimeline` replaces a non-exact base (Kugou or LRCLIB search hit) with the NetEase entry when it is the same song (alignment-text similarity >= 0.85, no less content), complete, not proven incomplete or a consensus outlier, within 5 identity points, and on the same clock: `onsetDistance` (rows that begin the same sentence) median <= 600 ms. Containment-based `timelineDistance` was fooled by split lines: a 3 s shifted NetEase file looked aligned because Kugou's second half-line sat 3.5 s later. Exact LRCLIB records and Spotify timelines are never overridden.
  - Audit vs 0.4.50 (159 songs, paced): 18 songs moved to NetEase; Chinese coverage better on 5, slightly lower on 1 (夏霞 1.00 → 0.97, NetEase's own translation skips a line); no new missing/transient results. Playlist zh mean 0.988 → 0.989.
- **Next-song prefetch** (`electron/next-track-prefetch.ts`): when connected and the local song is <= 60 s from its end (SMTC duration, which in a Mix context is the hand-off point), one `/me/player/queue` call with `Accept-Language` = app locale (names then match SMTC: 緑黄色社会, not "Ryokuoushoku Shakai"). Skips when the Web API is playing something else (another device), the queue is empty, repeat-one, episodes/local files; retries a transient result once after 15 s. `lyrics:fetch` takes a prefetched result for the same recording (title + duration ±2 s + artist or album, or title + artist + album when Mix durations differ) that is timed and not transient; an explicit retry bypasses it.
  - End-to-end (isolated profile with a plain QA session, Mix playlist started 50 s before a song end): dev and packaged builds both logged `lyrics prefetch: next=… usable=true … translation:zh-Hans` and, at the change, `prefetched before the song change` with **elapsed 0 ms** (was 1.3–3.4 s); the window showed original + romaji + Chinese.
- **Romaji cache:** `romanizeLines` caches completed per-line readings (LRU 4000; snapshot of the input; short/failed answers never cached) and returns the shared job promise as before. Prefetch warms it with the exact renderer lines when the provider romaji is missing or sparse.
- **Partial LRCLIB failure:** when a /get lookup fails (429/5xx/timeout) and no timed exact record was found, the result is now `transient` (not cached, retried) instead of persisting a search fallback. Found in the e2e run right after an audit.
- **SMTC vs Web API durations in a Mix context differ by several seconds** (修羅 235.6 vs 233.1 s, 花も騒めく 216.8 vs 220.7 s): SMTC reports the Mix hand-off point. Positions still match audio (earlier ±11 ms measurement). Consequence: LRCLIB's precise /get (±2 s) misses during Mix playback, so most Mix songs still query every variant; prefetch hides that latency.
- Bundling note: an exported `remainingMs` collided with a local in `vocal-sync.ts` and made the bundler rename it, failing the `boundedReadingFallback` text check; renamed to `playbackRemainingMs`.

## 2026-11-11 / 0.4.50 deployed: provider request budget (LRCLIB throttling, Kugou silent empties)

- `release/current` = **0.4.50** (asar SHA256 `7e06f8cc00c6306910c9c7b9bb264bf8310d397f4644f50aa6d1a64112dba623`, verifier 67/67, Electron 44.2.0). Rollback: `release/current-0.4.49-backup-20261111`; the 0.4.48 backup went to the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0450`. Packaged smoke test (isolated profile, 8 forced back-to-back fetches over CDP): 8/8 found with Chinese translation, none transient. With the strict LRCLIB stop rule most songs still send 7 requests, so rapid skipping can still hit 429 (2.5 s); see TODO.
- Cold lyric fetches took ~2.5 s on most songs. Tracing showed no slow HTTP request: LRCLIB answered our ~7 parallel lookups per song with **429** after about three quick song changes (burst ~20, refill ~3/s), so each later lookup waited two retry rounds or failed and fell back to a weaker provider.
  - `fetchLrcLib` is now staged: the precise `/get` (title, artist, album, duration) plus one title + artist `/search` first; the other `/get` and search variants run only when that does not give a synced exact record that would not reopen the quality race (`lrclibTimelineHealthy`, the inverse of the "top tier looks truncated" test). `searchLyrics` (manual search UI) is unchanged, now built from the same helpers.
  - Corpus A/B (201 songs: Mix playlist, play history, saved library; paced, 0 throttled): **200/201 identical**; the one difference is 風を食む (創作 edition, 265.9 s) now taking the 266 s 創作 record instead of the 269 s single. Requests 1433 → 1290 (29 songs stop after 2).
  - Not shipped: also ignoring long interludes in the stop rule would stop 109/201 songs after 2 requests, but 10 then chose a different same-song upload (`ab-lrclib-relaxed.mjs`). Needs per-case review before it can save more requests.
- Kugou: `songsearch.kugou.com/song_search_v2` returns an empty list for ~40% of requests even at one query every 6 s, and the response is byte-identical to a genuine miss, so Kugou-only songs were often cached as "no lyrics". `lyrics.kugou.com/search?keyword=&duration=` is not throttled (45 rapid queries consistent) and returns lyric candidates with title, singer and duration.
  - `fetchKugou` asks that keyword search first (shapes "artist - title", "title artist", cleaned; it is literal about shape), applies the same edition gate and identity score >= 58, downloads the top 3 in parallel and runs `bestLyricsCandidate`. The old file-hash route remains the fallback; it is the only one that resolves Latin artist aliases (Atarayo for あたらよ, yama's romanized titles).
  - A Kugou hash hit named "(Piano ver.)" only in its untimed `[ti:]` tag (10 s longer than the release) and won the merge without a translation. `kugouTitleTagNamesOtherVersion` rejects a file whose tag names a version descriptor absent from the Spotify title/album (all 107 keyword-found songs kept).
  - Corpus A/B (157 songs): found 57 → 107; every new result matches the NetEase reference text (none < 0.5, median 1.0). The 6 "found → null" rows were alias songs whose fallback was throttled because the old route had just run; rechecked alone, 4/6 found and the remaining 2 depend on the same throttled song search as before.
- End-to-end A/B (60 songs, old vs new `fetchLyrics`): 50 identical, 0 transient, 0 null. The rest: 風を食む edition fix, and songs without an LRCLIB exact record where the now-available Kugou timeline wins the existing quality race (NetEase translation re-timed onto it).
- `LYRICS_PROVIDER_REVISION` 41 refreshes automatic documents. Verifier check `providerRequestBudget` (67 checks). 988 tests pass.

## 2026-11-11 / 0.4.49 deployed: overlay shows even when ready-to-show never arrives

- `release/current` = **0.4.49** (asar SHA256 `16168981348bf2456bdbe9effa262482058767be736b23ece43dbc1a7e9fcc6b`, verifier 66/66, Electron 44.2.0). Profile backup: `.qa-user-data-preupdate-0449`.
- Reproduced "desktop overlay broken after restart": start with the overlay hidden, then toggle it on via `window.syllable.overlay.show()` over CDP (the user cannot be driven by computer-use). Deployed 0.4.48 failed **1/6** (`overlay show failed: no first painted frame`, show() → false for the session).
- Fix: `paintRecovery()` (`electron/first-paint.ts`) presents a loaded, healthy renderer after the bounded wait and reloads only a crashed, failed or still-loading one, confirmed by `waitForLoad` (`did-finish-load`).
- Result: fixed dev build 8/8 shown, packaged candidate 6/6 shown, including 3 runs where ready-to-show was missed. After showing, the hit regions immediately reflect the 3 rendered rows, so the window is not blank.
- Disabling `CalculateNativeWinOcclusion` made the missed paint *more* frequent (5/6 vs 1/6), so occlusion tracking is not the trigger.
- Scripts (scratchpad): `qa-late-show.sh`, `qa-overlay-shown.sh`, `qa-overlay-runs.sh`.

## 2026-11-11 / 0.4.48 deployed: romanized-title identity, namesake-aware translation lookup

- `release/current` = **0.4.48** (asar SHA256 `3fc77787c8cfed677fc2ad628f9ebeb664168ff86242ed4a52bb3337bca1f797`, verifier 66/66). Rollback is `release/current-0.4.47-backup-20261111`; the 0.4.46 backup is in the Recycle Bin. Profile backup: `.qa-user-data-preupdate-0448`. Provider revision **40** refreshes automatic documents.
- Found by auditing the user's saved library (42 docs; read from a copied profile through a sandboxed renderer): 3 songs without translation. "Haru wo Tsugeru / yama" had NetEase pick **another yama song** on artist + duration (text similarity 0.07). The merge discarded it, but its presence suppressed the lyric-text lookup.
  - The lookup gate is now "NetEase text disagrees with the chosen original" (≥0.75 similarity counts as agreement).
  - `weightedScore`: when the Latin title `looksLikeRomaji`, the native title's kana must appear in order (`kanaSkeletonMatches`; 春を告げる ↔ "wo", "geru"). A mismatch rejects; a match gives title evidence. English titles (Fig Smoke, Shout Baby) are unchanged.
  - Result: Haru wo Tsugeru NetEase pick 0.07 → 0.97, and Kugou now finds it too. All 3 library songs now have translations.
- 981 tests pass. Candidate smoke-tested in an isolated profile over CDP: Haru wo Tsugeru shows the right lyrics + romaji + Chinese.

## 2026-11-11 / 0.4.47 deployed: confirmed instrumentals, romaji revision 3

- `release/current` = **0.4.47** (asar SHA256 `cbb3430a6a217734855a2d3e5408935f18ef916b3f83328141cc6e904d3e5170`, verifier 66/66). Rollback is `release/current-0.4.46-backup-20261111`. The 0.4.45 backup went to the Recycle Bin. The profile was backed up after a clean stop to `.qa-user-data-preupdate-0447`.
- Instrumentals: LRCLIB's verified `instrumental` record, or a provider "纯音乐" notice, now produce `instrumental: true` when no provider has any lyric. The lyric view shows 纯音乐 instead of "暂时没有同步歌词 / 重新匹配歌词", and the source badge reads 纯音乐 (or 未找到歌词 for a definitive miss) instead of "Searching". Verified on 10 instrumental interludes from the user's play history; a sung track is unaffected. The candidate was smoke-tested in an isolated profile over CDP.
- Romaji revision 3 (commit e671e02): lexicalized wa (実は→jitsuwa), loanword digraphs (ファ/ティ/ドゥ/ヴィ), common lyric readings (春風 harukaze, 身体 karada, 獣 kemono …), and no raw kanji in romaji. NetEase agreement 0.885 → 0.898.
- Spotify state: no Mix recipe key (`speed_automation`, `fade_in_cuepoint`, `fade_overlap`) exists anywhere on disk outside the encrypted audio cache. A passive recorder (session scratchpad `ab/passive-mix.cjs`, ≤4 captures of 75 s, 6 h) waits for a user-started MixedPlaylist transition. `ab/tempo.cjs` estimates the incoming track's rate profile without a reference: an onset-autocorrelation template plus a Viterbi smooth-ramp path. Validation: a synthetic 0.954→1.0 ramp was estimated at 0.946→1.0 with ~1.28 s lag (true 1.03 s); a real no-ramp transition gave 61 ms.

## 2026-11-11 / 0.4.46 deployed: translation + romaji quality, instrumentals, Spotify state change

- Work moved from Codex to Claude Code. **0.4.46 is deployed** to `release/current/Syllable.exe` (asar SHA256 `3afeba4cf049e8e5233eecb2a5889590f12a3a2f54be096032aac87cc23c9c4f`); `scripts/verify-package.cjs` passes **66/66**, including new checks for revision 39, the alignment variants, sibling/lyric-text translation, instrumental handling and romanization revision 2.
  - Rollback: `release/current-0.4.45-backup-20261111`. The normal profile was backed up after a clean close to ignored `.qa-user-data-preupdate-0446`.
  - Older release backups (0.4.38/0.4.42/0.4.43/0.4.44) and empty candidate folders went to the Windows Recycle Bin, so they are recoverable.
  - Shortcuts (`C:\Desktop\Syllable.lnk`, Start Menu) still point at `release/current`, no arguments.
  - The 0.4.45 instance was force-stopped (its writes are synchronous) and 0.4.46 relaunched without arguments.
  - The real profile then saved a revision-39 document (LRCLIB exact original + NetEase translation). Locally, SMTC reports the Japanese artist 緑黄色社会, while the Web API reports "Ryokuoushoku Shakai".
  - The packaged candidate was smoke-tested in an isolated profile first; it showed 0.4.46 and Shout Baby with romaji + Chinese.
  - Computer-use access to Syllable was declined by the user; verification used storage and process checks instead.
- **Spotify changed its local storage.** The Store build no longer writes `context_player_state_restore`; it uses `list_player_*` files (play request/history/queue). Those files carry the context (`MixedPlaylist` attribution) but **no per-track Mix recipe** (`audio.speed_automation`, cue points). So `spotify-transition.ts` now finds nothing: no Mix label and no local `spotifyId`. Impact is small: `spotifyId` only feeds the OAuth `color-lyrics` request, which returns **403 for developer-app tokens** anyway.
- **Transition measurement (Web API–started playback of the user's Mix playlist `5UPnI4RSDBZ4ORr5hj7Gy8`).** Raw SMTC and Web API progress advanced at 1.000 through the first 26 s of the incoming track. Loopback audio of the transition, aligned against a clean album-context recording of the same track (spectral-flux envelope, 4 s windows, rate grid 0.90–1.10), gave **content = reported position ±11 ms, rate 1.000** from 2.5 s onward. Loudness showed fade-out → ~3 s silence → new track from 0 (no crossfade) on the transitions scanned. API-started playback therefore did not reproduce a Mix crossfade. The old speed-ramp hypothesis is still untested: historical recipes ramped 0.954→1.0 over ~26 s, which would leave ~1.0 s early lyrics if SMTC is output time. Next evidence must come from a user-started Mix transition. Scripts are in the session scratchpad and were not added to the repo.
- **Translation alignment** (`alignSupplementalTimeline`): alignment text strips furigana `（くらげ）`, folds katakana→hiragana, and uses a small kana/kanji variant table (皆/みんな, 塵/ごみ, 1人/一人 …) that is used only for matching. Rows accept bigram similarity ≥0.8. Merged↔split grouping no longer requires a pre-existing anchor. Empty "♪" rows can no longer create duplicate candidates. Back-to-back repeated merged choruses align phrase by phrase, monotonically. The whole translation is still repeated on each phrase row; it is never split by spaces, because translators reorder clauses.
- **NetEase sibling translation**: when the chosen NetEase entry (e.g. a "[K-Bridge] Rising Hits Mix" compilation) lacks `tlyric`, borrow it from a sibling candidate with the same recording (Δduration ≤3 s, text similarity ≥0.75), re-timed via the aligner.
- **Lyric-text lookup** `enrichTranslationByLyricText`: only when NetEase identity search returned nothing (romanized Spotify metadata such as "Shout Baby / Ryokuoushoku Shakai", "Fig Smoke / ZUTOMAYO" = イチジク煙). It searches NetEase lyrics (type 1006) with two distinctive lines and accepts a match only at Δduration ≤15 s and whole-text similarity ≥0.75. Budget 4 s, silent failure, never transient.
- **Instrumentals**: an LRCLIB 200 record without text used to throw "LRCLIB 暂时不可用 (200)", so every instrumental was transient, uncached and retried. It now returns null. "纯音乐，请欣赏"-style notices from any provider are discarded (`isInstrumentalPlaceholder`).
- **Generated romaji** (`japanese-romaji.ts`): reading-first, with particles still by pronunciation (taiyou/chou, not taiyoo/choo). Number+counter and split compounds (一人→hitori, 二人, 一回, 精々, 幽体, 夜風). 々 is never printed. 波/土 standalone, あんな風→fuu, 何だ/何で→nan. Inflection stays in one word (mitasarenai, nareba, nandakke, contracted hirogeteta/utatteru/wasureteku). In romanize mode the worker uses printed furigana 翅（はね）/本気（マジ） as the reading (`applyFuriganaReadings`). `ROMANIZATION_REVISION` 2 and `LYRICS_PROVIDER_REVISION` 39 regenerate caches; user edits are preserved.
- **Measured on real data**:
  - Mix playlist (84 songs): Chinese translation present on 84/84, mean row coverage 0.988. Before: 盗作 and 雨とカプチーノ had none, and several songs were at 0.62–0.80.
  - Generated romaji vs NetEase human romaji, exact line match over 3,022 lines: 0.678 → 0.886. Most of the remainder is genuine kanji-reading ambiguity, and NetEase itself is inconsistent (何でも→nanidemo).
  - Play history (75 more songs): romanized-title songs now get translations.
  - Remaining audit flags are verified outros (TAIL-GAP), scat lines, LRCLIB rate limiting caused by the audit itself, and NetEase's own partial translation (オリイト).
- Tests: **975 passed / 39 opt-in skipped**, `tsc` and build pass. Added `.github/workflows/ci.yml` (windows-latest: build, test, verify:repo). Root `qa-0445-*` logs moved to ignored `.qa-history/root-qa-0445/`.
- Live check of the source build in an isolated profile (`--user-data-dir` in the scratchpad, CDP on port 9333; the normal profile was not touched): 盗作 shows Chinese, 櫂 shows `yuutai ridatsu`, and the overlay renders lyric + romaji + Chinese. Electron working set is about 408 MB across 4 processes.

## 2026-10-27 / 0.4.45 deployed: remove paint masks; verify cold starts

- Current/source **0.4.45**, `release/current/Syllable.exe`, mainPID76316 at launch, no arguments, asarSHA256 `54697e5e010ce6b45f59902c37dacf0a5cb10eaff16164d957f9897b6d3f874d`. Desktop/StartMenu shortcuts remain current/noargs. Prior0.4.44 is local `release/current-0.4.44-backup-20261027`; full normal-profile backup `.qa-user-data-preupdate-0445-final`. Deployment preserved saved x815/y93/920×230; do NOT restore the older test-profile location(-1453,-25). Normal app was opened after deployment through its existing second-instance action; restored desktop-overlay visibility is currently hidden by the user's saved setting, not a failed show. Leave it unless explicitly showing for testing/handoff.
- Production overlay now **never calls setShape**, not even `setShape([])`. Full transparent painting is independent of validated text regions. Pure `overlayShape` remains only for comparison fixture. `overlay-input` owns cursor hit policy (text/background+8DIP edges, locked/unready/explicit pass-through always ignored); forwarded DOM movement immediately reads actual DIP cursor, bounded native fallback24msnear/200msfar, stopshidden. Hold from pointerdown before6DIP drag threshold and through drag/native-size capture; all forced cancellations restore controls opacity. No WM_NCHITTEST return hack.
- First presentation waits for actual ready-to-show via bounded `waitForFirstPaint` (10s; load/renderer failure/close settlefalse; once-only reload retry). It is NOT proof of the final restored frame. Native inspection now reads DWM cloak but remains read-only diagnostic, not pixel acceptance. Whole-window original startup setting/position restoration is retained.
- Final regression **959passed/39explicit-local skipped**, TypeScript/build passed, **62/62 package identity checks** passed. Final package cold boots5/5 completedexit0 on the same cloned profile,6checks/3compositor captures perboot, all initial images visually inspected full Japanese/romaji/Chinese. Files `.qa-overlay-clip/restart-0445-final-*`. Final packaged display9checks exit0 (`qa-0445-package-display-final.*`); actual ComputerUse physical lock/underlay input test passedcenter1/edge1/wheel6/trusted/exit0 (`qa-0445-package-physical-final.log`). No Spotify transport/audio operations. Actual normal-profile desktop overlay remains hidden by its savedvisibility; the visible client shows0.4.45 and connected native playback.
- Keep failures: initial .44 had valid native region but actual strips (`.qa-overlay-clip/live-native-before-0445.json`). Early .45 mask-reset batch had5statepasses but2blank desktopimages, so it was NOT accepted and led to total removal of native mask calls + real firstpaint barrier. v2boot2 was manually dragged toprimary and testaborted; do NOT call5/5. Cross-DPI drag still caused many true resizes; not proven fixed. The first physical test onlycenterpassed and userfinished early; finalphysicalabove is the passingrecord. Fixture first150%DPI narrowromaji failed0.70countthreshold despite1.0positioncoverage; inspectedimage, changedcounttolerance0.65 with strip/missing-row/blank fault-injection tests, retainedfailedreport. Later20phase pixel fixturepassed; do not conflate region/no-region with paint proof.
- Publication: user explicitly requires old versions removed OR kept offline. Backups are offline/ignored; no additional old-version deletion this turn. `scripts/verify-repo-clean.cjs` + installed `scripts/git-hooks/pre-push` inspect both Gitindex and all added/modified paths in outgoing history (including committed-then-deleted artifacts, sameblob aliases, merge/newrefs); failclosed. `.gitattributes` keeps hookLF. Keep user untracked `docs/preview.png`, `docs/overlay-preview.png`, `output/` untouched/uncommitted. Never upload profiles/QAimages/logs/models/audio/releases/installers. See `docs/overlay-startup-2026-10-27.md`.
- General audible lyric synchronization remains **incomplete**; this turn changes only overlay rendering/input/startup and publication safety, not audio/source/transport. Next display tasks: real hardware wake/hotplug observation, cross-DPI drag size feedback, near-instant entry/click race. Do not mark the old overall goal achieved.
