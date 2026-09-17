# Independent acoustic synchronization — 0.4.30 experiment

## Why this is separate from the native clock fix

The user reproduced audible lyric offsets even when Spotify's own position/lyrics are wrong after custom transitions. Agreement with SMTC is therefore not evidence of agreement with the recording. No additional constant offset, duration ratio, or Spotify lyric pointer is used as acoustic ground truth.

## Implemented

- Opt-in local reference import for the current track only: complete, same-version recording, 12–600 seconds, at most 60 MB input. No reference acquisition, download or cloud inference.
- Electron system-output loopback with an explicit one-use main-renderer grant. A screen stream is required by Chromium; its video track is stopped immediately, never rendered/stored. No microphone. Current capture includes other applications, not just Spotify.
- AudioWorklet collects 12-second mono blocks at 8 kHz; matching runs in a dedicated on-demand worker. Audio and reference features stay in memory and are never persisted by the product.
- 48 log-frequency FFT bands plus temporal differences. Independent position search over the reference and local rates 0.8–1.2, with coarse search and refinement. This is **not** DTW, speech recognition or a proven general fingerprinting system.
- Conservative score/margin gates; sustained tones, silence and ambiguous repeats rejected. Two non-overlapping consistent observations required; capture time, not computation completion, anchors position. Anchors expire after 20 seconds.
- Only lyric surfaces use this recording coordinate; player seek/progress remains in Spotify coordinates. No double application of Spotify Mix curves. Existing user lyric offsets still apply.
- Pause, track change and discontinuity invalidate capture. Main process additionally rejects old blocks spanning invalidation, including explicit small seeks. Stream shutdown cannot recursively restart cleanup when its own IPC broadcasts state.
- Default off: no audio worker, reference decoding or capture during ordinary playback. Reference cleared on song change. On pause/seek the user must start again.

## Evidence and limits

- Real production-worklet loopback smoke test: 12,000 ms, all finite PCM, RMS 0.067499 at 8 kHz. Only the explicit diagnostic script saves local PCM under ignored `.qa-acoustic/`; the application does not. This proves capture, **not synchronization of the currently reported song**.
- Saved real recording test: unknown excerpt starting at 3,000 ms and gain 0.2 recovered at exactly 3,000 ms; score 0.999802.
- Same excerpt transformed with ffmpeg `atempo=1.08`: estimate 2,969.88 ms and rate 1.08, but score 0.715210 is below the 0.8 gate, so it correctly remains **unaccepted**. The positive tempo acceptance test still fails (exit 1). Another saved sample also fails the tempo confidence gate. Do not claim robust custom-transition support.
- A 10-minute repeated-feature search took approximately 491 ms in Node on this machine; reference feature arrays about 4.37 MiB. This is an isolated matcher measurement, not the full app's CPU/RAM or Electron worker latency. Repeated data correctly rejected as ambiguous.
- Unit coverage includes confidence, stale results, capture duration, non-overlap, seek/pause/song change, expiry, malformed anchors, rendering coordinates, sustained tones, end-of-reference bounds and async capture lifecycle.
- Full offline suite: 294 passed, 36 skipped; TypeScript/build passed. Real Electron bundled-worker smoke test recovered a held-out captured slice at 2,000 ms exactly, score 0.999556, 29.7 ms worker preparation + matching. This is a same-recording plumbing test, not an independent audio reference.
- Packaged UI on secondary display: experimental panel present, default off, start/stop disabled without a reference, full panel scrolls into view; all four checks passed and process exited 0. Fixed the center grid's minimum height so settings no longer extend beneath the player. Actual reference import/start/lock remains separately pending.
- `release/current` passes the package identity/feature verifier, version 0.4.30, app.asar SHA256 `905bcc0b6a5ff4f0cc63c554652d8337baf90e8f8f7961c38a7b9419eb2fbeee`. Desktop shortcut still targets this location. Old current retained as `release/current-0.4.29-backup`; no new ZIP/Setup generated. One normal app instance (four Chromium processes) restarted on the secondary display; default audio capture remains off.

## Reproduce

```powershell
npm test
npm run build
node scripts/verify-acoustic-sync.mjs <reference.wav> [query.wav]
# Explicit diagnostic capture, saves 12 seconds of system output locally:
# Remove ELECTRON_RUN_AS_NODE from this process environment before launching.
node_modules/electron/dist/electron.exe scripts/capture-audio-probe.cjs
```

## Next work / not solved

1. Obtain a legitimate, same-version reference or develop a reliable reference-free alignment backend; needing manual audio imports is not a universal solution.
2. Broader labeled tests of pitch-preserving variable tempo, cross-song overlap, repeated choruses, codec changes, wrong recordings and unrelated system sound. Improve features/model without simply lowering acceptance thresholds.
3. Prefer Windows per-process Spotify loopback to whole-system capture. Explicitly account for endpoint latency and device changes. Validate actual listening alignment, not only media progress.
4. Reference/lyric recording identity and erroneous/incomplete provider timestamps are separate problems; audio alignment cannot repair a wrongly timed or missing lyric line by itself.
5. Test UI import/start/stop and simultaneous main/overlay alignment end-to-end with a known full recording and a controlled audio reproduction. Current tests do not establish this on the user's live song.

Official references used: [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer), [Electron session display-media handler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts), [Microsoft process-loopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/).
