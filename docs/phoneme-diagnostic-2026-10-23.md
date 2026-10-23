# Local phoneme diagnostics (0.4.43)

This is an optional **shadow backend**, not an accepted audible synchronization
fix. The normal media fallback and existing Whisper experiment remain separate.
Do not turn CTC peaks, a zero-regret phrase, or a resolved timing hypothesis into
a clock anchor without measuring real singing-onset error and competitor coverage.

## Runtime and privacy

- One explicit opt-in in Preferences selects continuous Japanese phoneme checks;
  no per-line user clicks, reference recording or lyric prompt is required.
- System output includes other applications. No microphone, upload or automatic
  model/runtime download. Product PCM/posteriors are memory-only; diagnostic QA
  recordings under ignored `.qa*` directories are separate, explicitly invoked.
- The shipped Python helper is `resources/audio-sync/romaji-ctc-runner.py`.
  It discovers an existing `ctc-runtime/Scripts/python.exe` and
  `romajiasr-v1.0.0/unpacked/{model.onnx,model.with-logits.onnx,phoneme_vocab.json}`
  beneath an audio-sync root. Local checkout `.tools/audio-sync`, fixed current
  and nested candidate builds are supported. Models and Python are NOT bundled.
- All three model/vocabulary files are verified against pinned SHA256 values
  before inference. Derived logits expose the original model's pre-ArgMax output;
  the original predicted IDs are independently checked. Input is raw mono 16 kHz
  float32, no mean/variance normalization; stride320 samples, receptive field400.
- Two CPU threads, one task, 15-second analysis budget; cleanup may take up to
  another2 seconds. Cancellation releases owned resources; replacement is refused
  if prior exit is unconfirmed. No process-name killing or queued inference.
  Idle model release is30 seconds. ORT memory arenas/patterns and idle spinning
  are disabled. Dictionary expansion and inference do not run concurrently.

## Matching and ownership

Every supplied lyric row is searched independently of media position. Complete
dictionary pronunciation branches use a DAG, not a truncated product. Repeated
rows, weak explanations and known internal-word windows remain competitors.
An unknown span is marked unsupported, never silently skipped into certainty.
Any graph/work/candidate overflow abstains as a whole. Matching runs in a bounded
disposable worker, not on the Electron main/UI thread.

The coordinator invalidates on track/source change, pause, seek, lost capture or
device suspension. Continuous PCM uses one sample-clock-to-wall-time mapping;
per-block receipt jitter is not a tempo observation. Cross-capture hypotheses
retain original capture/receipt times; UI summaries contain no audio/lyric text.
The result type has `clockApplied: false` and no position/rate/anchor field.

## Evidence and limits

- Saved12-second PCM adapter smoke: cold1831 ms, hot742 ms, cancel46 ms,
  close4 ms; no overlapping or leftover launcher descendants. Measured model
  resident memory about451 MB/private461 MB, peak688 MB (not entire app memory).
- Twelve saved same-song clips: whole54-row search prepares868 graphs per active
  clip, around23.2–23.5 million DP work,311–389 ms. Eight clips yield groups and
  six yield diagnostic eligible choices. **Zero accepted clocks.** Coverage is
  incomplete for near-cost/word-interior competitors, unsupported readings and
  uncalibrated acoustic onsets. CPU latency is not audible timing accuracy.
- Hidden source-build live QA:5 captures/5 analyses, stopped cleanly, all
  `clockApplied=false`. That proves pipeline liveness, not synchronization.
- Actual SMTC evidence showed old title with next-song duration/zero position
  1–153 ms before a new title. The raw native boundary guard now quarantines
  only that combined shape for at most250 ms before observing the clock. Real
  same-duration seeks are immediate, persistent resets retain their original
  observation time. This prevents false seek resets; it does NOT correct a
  song-wide media-versus-vocal rate error.

Next acceptance work: measure onset bias and whole-song recall/false takeover on
independent songs (including mixes and repeats), retain all competing mappings,
distinguish source timing errors from transport/recognizer timing, then decide
whether acoustic evidence can safely drive a piecewise lyric clock. Do not lower
gates just to get a lock or fit a duration ratio from Spotify's shortened mix.

Official model provenance: [RomajiASR](https://github.com/Xiantaidu/RomajiASR),
[v1.0.0 release](https://github.com/Xiantaidu/RomajiASR/releases/tag/v1.0.0).
