# 0.4.31 — acoustic endpoint safety and reproducible evaluation

## Scope

Continues the user's priority: actual audible position independent of Spotify's potentially incorrect post-transition clock. This is a concrete safety fix to the opt-in reference-based experiment, **not** a universal solution. Default playback is unchanged when the experiment is disabled. Full same-version reference files are still required.

## Reproduced defect

A 12-second capture with ten seconds matching the reference followed by two seconds of silence, unrelated sound or a seek could pass the old whole-window score/margin gates. In particular, silent frames were omitted from the score denominator. The code then anchored at the end of the capture, effectively treating an unverified tail as evidence of continued playback along the old path.

Two existing local recordings produced **six false acceptances** (all three tail mutations on each recording) in the initial 22-case matrix. This is not speculation based on Spotify timestamps.

## Fix

- Validate the final two seconds separately, including silence in that local denominator. Keep the existing 0.8 whole-window score and 0.075 ambiguity margin thresholds.
- Search the tail independently at the proposed rate; reject if a recording position at least 500 ms away explains it over 0.05 score better. This catches a tail spliced from another part of the same recording despite its strong overall average.
- Report `unconfirmed-end` instead of presenting the whole-window average as confirmation of the current audible position.
- Revoke an existing anchor on fresh rejected evidence, rather than extrapolating it for the remaining 20-second TTL. Stale results or a different track cannot revoke a newer anchor.
- Unit regressions cover all three mutations, fresh rejection reasons, and stale/wrong-track invalidation boundaries.

These thresholds are conservative heuristics, not statistical accuracy guarantees. An exactly indistinguishable repeat cannot establish unique audible position; broader testing is still needed. A mismatch is only recognized when a 12-second block finishes; this patch does not eliminate detection latency within that block.

## Results

| Matrix | Cases | Passed | Correctly accepted positive cases | False acceptances |
| --- | ---: | ---: | ---: | ---: |
| Before, two local recordings | 22 | 8 | 4 / 12 | 6 |
| Endpoint fix, same cases | 22 | 14 | 4 / 12 | 0 |
| Final, adds 0.88→1.12 tempo step per recording | 24 | 14 | 4 / 14 | 0 |

The command intentionally exits **1**: eight constant-tempo positives and two variable-tempo positives remain unsupported. They must not be reclassified as passing merely because rejection is safe. A 350 ms smoothing / 500 ms spectral-delta experiment produced worse positions and one false acceptance; it was reverted. Current features retain 150 ms smoothing / 250 ms delta.

```powershell
node scripts/evaluate-acoustic-sync.mjs <reference1.wav> <reference2.wav> --report=.qa-acoustic/matrix.json
```

The script derives labeled local excerpts, gain fades, pitch-preserving tempo variants, a tempo step, three tail mutations, noise and other-recording negatives. It never changes Spotify playback or captures/uploads audio. Reports contain metrics and recording indices, not source paths or audio. The fixture corpus is only two short recordings: these numbers do not establish generalization to a music catalog.

Offline tests: **302 passed, 36 opt-in tests skipped**. TypeScript/build passed. Packaged secondary-display audio panel QA: all four checks passed, exit 0; default capture off, start/stop disabled without a reference, panel fully scrollable. This is not a complete import→capture→lock end-to-end acceptance.

`release/current/Syllable.exe`: **0.4.31**, package verifier passed, app.asar SHA256 `b3b46756299908afecaa59ea5514550ee8812142304c8e6e996540ef65de4b3b`. `C:/Desktop/Syllable.lnk` verified to target it. Previous executable retained in `release/current-0.4.30-backup`. No ZIP/Setup regenerated. No app was running before deployment; QA process exited and no normal app was launched. Spotify playback was not altered.

## Next synchronization work

1. Replace constant-rate-window assumptions with a validated time-varying alignment path. A tempo-step case already shows why a single average rate cannot reliably establish the endpoint or its future speed. The `AcousticClock` contract currently assumes `end − start ≈ duration × rate`; a nonlinear matcher will require a separate endpoint velocity and path-quality contract.
2. Investigate multi-resolution spectral/chroma features and constrained alignment, with these negatives retained. [Librosa's official music synchronization example](https://librosa.org/doc/0.11.0/auto_examples/plot_music_sync.html) demonstrates DTW for recordings with different tempos; this app does not yet implement it and that example is not evidence that our live mixed-stream problem is solved.
3. Reduce detection latency with carefully validated overlapping evidence; do not count overlapping windows as independent confirmation. Measure endpoint/device latency.
4. Solve reference acquisition or reliable audio-to-lyrics alignment without manual complete audio imports. This remains essential for the user's desired everyday behavior, not an optional polish item.
5. Audio/recording alignment cannot itself repair missing lines or wrong lyric-source timing. Keep provider completeness and actual live-song listening acceptance separate.
