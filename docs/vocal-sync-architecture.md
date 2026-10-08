# Local vocal alignment (0.4.35, experimental)

This is an implemented alternative clock, not a claim of universal musical ASR accuracy.

## Why another clock

Spotify's own lyric cursor and media position can disagree with audible singing after custom transitions. Copying that position cannot establish correctness. The new path searches the entire current original lyric using independently recognized words. It does not use Spotify's seconds to choose between repeated choruses.

System output → 12-second mono/16 kHz block → local whisper.cpp child → timestamped tokens → whole-lyric text matches → onset regression → two-block confirmation → short-lived lyric-only anchor.

Spotify remains responsible for song identity, pause/seek invalidation and transport controls. An accepted audio anchor bypasses Spotify Mix mapping; it never changes the actual playback position or issues playback commands.

## Implementation and safety

- `electron/audio-sync/local-asr.ts`: one child at a time, 4 threads, 15-second inference timeout; no shell, ffmpeg dependency, network or lyric prompt. Model paths are selected through native dialogs and persisted separately. The existing ignored developer cache is discoverable on this machine; binaries/models are NOT bundled or downloaded automatically.
- Temporary WAV and token JSON live in a unique subdirectory of `os temp/syllable-local-asr`; removed in `finally`. Abrupt process/OS termination may leave files. The app does not upload recordings or use the microphone. It captures all system output, not exclusively Spotify.
- `lyric-aligner.ts`: normalized spelling match, probabilities, token onset validation, line-order checks, bounded work, local tempo regression and repeated-passage ambiguity rejection. Segment-only timestamps cannot establish a line onset. No uniform word-time interpolation.
- `lyric-clock.ts`: two non-overlapping blocks with at least four distinct complete lines; rates must agree and source position predictions must agree within 550 ms. Recording capture time is retained throughout inference so compute latency does not become lyric delay. Anchor expires 28 seconds after the latest captured block, not after inference finishes.
- `vocal-sync.ts`: current-track ownership, serialized observations, lyric-version hashing, stale-result and cancellation guards. Pause, seek, track change, renderer failure and quit invalidate evidence.
- `acoustic-controller.ts`: lazy capture, no concurrent fingerprint/ASR jobs, no queue of old recordings. Switching/pause stops the session; subsequent songs require explicit restart during this experimental phase.

## Current limitations / next validation

Packaged live check on 2026-09-25 (secondary monitor, Byoushinwo Kamu): the full
capture/child/IPC/UI path ran and returned `insufficient-words`; no lock was
claimed. Observed child working set approximately733MB. Stop removed the child
and temporary files; Spotify returned to paused. This is evidence of a working
experimental pipeline and safe abstention, NOT evidence of synchronization accuracy.

- Recognition of Japanese singing is not proven by synthetic alignment tests. Whisper token probabilities are not calibrated confidence in lyric synchronization. Singing, accompaniment, repeated choruses, spelling/kanji differences and inaccurate LRC onsets can all force abstention.
- A 12-second sample plus model inference cannot provide immediate first-word lock. CPU model startup has a substantial transient memory cost; default is OFF and the process releases its model after each job. Do not enable continuous capture on app start.
- If there is no reliable match, keep the existing media clock and state that calibration failed. Do not claim this fallback is audibly correct.
- No song-specific magic offsets. No automatic retention of inferred offsets across recordings/transitions.
- Real vocal runs must measure false acceptance and audible onset error across held-out songs and custom transitions before promoting this path out of experimental mode.

Whisper CLI token JSON / arguments were checked against the [official v1.9.2 CLI source](https://github.com/ggml-org/whisper.cpp/blob/v1.9.2/examples/cli/cli.cpp). The timing estimates still require real-song validation.
