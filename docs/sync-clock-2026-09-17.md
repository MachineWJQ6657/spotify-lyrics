# Playback clock correction — 0.4.29

## Evidence

- User reported Syllable ahead of Spotify; supplied screenshot shows 2:31 vs 2:30 (integer display alone does not establish the exact offset).
- Spotify accessibility output cached its earlier timestamp, even while its screenshot advanced. Do not use the cached accessibility tree as a live clock.
- A live `libspotifyctl` observer on 準透明少年 held its smooth position about 545–547 ms behind each new raw position. On the following track ただ君に晴れ it held about 195–197 ms ahead. These errors persisted through multiple updates.
- Upstream `src/position.h` uses a 1500 ms anchor snap threshold and keeps the old anchor below that threshold. Reusing its smooth position cannot correct persistent sub-threshold errors.

## Change

- Own a monotonic clock from distinct raw `stateChanged`/`latestState` observations. Repeated cached positions do not reset the anchor timestamp.
- Do not consume the library's synthesized `positionChanged` or `positionSmoothMs` as observations.
- Project once at worker publication, then timestamp that projected value. Correct fresh positions immediately; renderer local playback accepts those corrections exactly.
- Accept authoritative paused positions even when they are behind the previous extrapolation.
- Preserve reported positions on a new track rather than inventing zero, which is invalid for a transition or resume beginning inside a recording.

## Verification and remaining limits

- Full suite: 266 passed, 36 skipped (online/live tests are opt-in).
- `node scripts/verify-native-clock.mjs` runs a bounded read-only integration check of the real worker/main service against an independent native observer.
- First live run on 冬眠: four comparisons, errors 0, 0, -1, +1 ms.
- Packaged 0.4.29: four comparisons on 冬眠 had max absolute error 1 ms; after natural transition to 夏、バス停、君を待つ, four comparisons had max absolute error 6 ms.
- Pause/resume on 八月、某、月明かり: the status notification briefly carried the previous raw position; the accurate paused position replaced it 10 ms later. The independent observer saw one delivery-race error of -1061 ms, resolved in the next app log 1 ms later. Following resume the library smooth clock retained ~291 ms lag, while later app errors were -18, 0, -3 ms.
- Use `--log=<app QA log>` to compare the running executable, or `--pause-resume` to opt into a bounded two-second pause. Reports keep both immediate errors and errors after 200 ms; do not call event-delivery races persistent drift.
- This verifies agreement with SMTC, not agreement with audio or every lyric provider. Provider timestamp mistakes and Spotify's own SMTC vs audible playback offset remain separate possibilities.
- Do not claim all lyric synchronization issues fixed without a live reproduction of the remaining reported cases.
