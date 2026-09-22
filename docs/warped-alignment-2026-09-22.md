# Nonlinear acoustic path research checkpoint (not enabled in the app)

## Motivation and implementation

A custom transition can change playback rate during one captured block. One fitted constant rate cannot describe both elapsed recording time and the velocity needed to project the current lyric position. The new **research-only** `electron/audio-sync/warped-match.ts` implements a piecewise-affine subsequence path solver:

- One-second blocks advance 0.8–1.2 reference seconds each; dynamic programming chooses the best bounded, monotonic sequence without any Spotify position prior.
- Frame affinities are cached once; input bounds limit the matrix to a 15-second query / 10-minute reference. Paths contain capture offsets and reference positions, with a separate endpoint rate.
- The retained experimental frontend combines spectral shape with deviations from its causal two-second mean. This is a candidate feature representation, not a trained or validated recognition model.
- Path-independent whole-recording competition and two endpoint challenges remain required. Scores are heuristic similarities, never probabilities.
- The first two seconds lack complete causal context; the reported source start is extrapolated from the first fitted segment. Changes inside that initial interval are therefore an explicit limitation.

This module is **not imported by the production worker, main process or renderer**. It is reachable only from unit tests and `scripts/evaluate-acoustic-sync.mjs --warped`. The normal 0.4.31 matcher and installed package are unchanged.

## Experiments / why it is not enabled

All experiments used the same two existing local recordings, derived test audio only in memory, and the strict matrix introduced in 0.4.31. No new audio capture, Spotify commands, upload or large dependency/model download occurred.

1. Spectral shape alone: most correct positions had very high similarities but competing positions also scored similarly. All positive cases rejected as ambiguous; 10/24 total cases passed, no false acceptances. High similarity did not establish identity of a passage.
2. Original short-delta features + flexible path: 13/24 passed, four positive cases accepted correctly, one seek-tail false acceptance; constant and changing-tempo examples still insufficiently confident.
3. Causal two-second feature context + independent endpoint checks (retained research code): **13/24 passed**, four positive cases accepted correctly, **one false acceptance remains** on recording 0's same-recording seek tail. Adding a short-context endpoint challenge did not resolve it. Do not bypass the existing matcher with this code.

One 0.88→1.12 tempo-step example improved end-position error from the production affine solver's −1309 ms to −11.7 ms; estimated endpoint rate 1.12195. Its score was only 0.5978, so it was rejected. The other had −18.4 ms end error but rate 1.10 instead of 1.12 and score 0.7426, also rejected. These are **localization observations, not successful synchronization**.

The final matrix stays exit **1**. Reports are local ignored files: `.qa-acoustic/matrix-warped-20260922.json`, `matrix-warped-delta-20260922.json`, `matrix-warped-causal-20260922.json`, `matrix-warped-final-20260922.json`. The runner now records matcher identity, expected endpoint/rate and complete estimated path for new reports. It does not include source paths or audio.

```powershell
node scripts/evaluate-acoustic-sync.mjs <reference1.wav> <reference2.wav> --warped --report=.qa-acoustic/warped.json
```

## Verification / delivery

Seven deterministic feature-space tests verify constant rate, a 0.9→1.1 tempo step with endpoint velocity distinct from the average, bounded monotonic path, repeated passages, silence, silent tail and malformed input. These isolate the solver from real audio and must not be cited as proof of sung-lyric accuracy.

Full unit suite: **309 passed / 36 skipped**. TypeScript/build passed. Production bundles do not include `matchWarped`. Installed `release/current` remains 0.4.31, app.asar SHA256 `b3b46756299908afecaa59ea5514550ee8812142304c8e6e996540ef65de4b3b`; no replacement/restart this turn.

## Next actions

- Improve and independently evaluate music features and path ambiguity before enabling nonlinear matching. Do not lower the score threshold just to accept these two recordings. Include the remaining false-positive seek as a required negative, then expand to a larger labeled corpus.
- A path with plausible endpoint position is not sufficient: quantify endpoint-rate uncertainty before allowing future extrapolation. The existing production clock assumes an affine relation and has not been changed to accept this research path.
- Manual complete reference import still fails the desired everyday workflow. Investigate a separate local audio-to-known-lyrics backend, or legitimate same-version reference acquisition, instead of treating fingerprint tuning alone as completion.
- Environment read-only check: RTX 5070 Ti Laptop GPU reports 12227 MiB VRAM; Python 3.13 currently has no torch, transformers, faster_whisper, librosa or numpy. `ffmpeg` available. Existing base-model transcription artifacts contain only `(音楽)`; they are not usable lyric evidence. No Whisper CLI is currently on PATH or under `.tools` (the base model file remains).
- [whisper.cpp's official repository](https://github.com/ggml-org/whisper.cpp) documents Windows and NVIDIA support plus local inference. It is a possible independently benchmarked backend, **not** evidence that ASR can recognize these songs or satisfy the app's latency/resource budget. Benchmark transcription and actual lyric-word anchors before installing it as an always-on feature; do not infer confidence merely from supplied lyric prompts.

The user's full synchronization and broader client objective remains active and incomplete.
