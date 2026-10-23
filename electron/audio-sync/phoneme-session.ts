import type { PlaybackSnapshot } from '../../src/types'
import type { VocalCapture } from '../../src/lib/vocal-sync-types'
import type { PhonemeDiagnosticResult } from '../../src/lib/phoneme-diagnostic-types'
import { lyricTimingKey } from '../../src/lib/lyric-timing-key'
import { captureQuality } from './capture-quality'
import { OnsetHypotheses } from './onset-hypotheses'
import type { CtcOutput } from './ctc-tokens'
import { analyzeJapaneseLines, type JapaneseWord } from '../romanizer'
import type { extractCtcLandmarks } from './ctc-landmarks'

interface PhonemeEngine {
  recognize(pcm: Float32Array, options?: { signal?: AbortSignal }): Promise<CtcOutput>
  cancel(): void
}
export type PhonemeMatcher = (output: CtcOutput, lines: VocalCapture['lines'], words: JapaneseWord[][],
  durationMs: number, signal: AbortSignal) => Promise<ReturnType<typeof extractCtcLandmarks>>

/** Owns a live diagnostic session, separate from VocalSync/OnsetClock. Until
 * singing-onset and competitor coverage are validated this cannot apply time.
 * Model PCM is memory-only; neither audio nor lyric text is returned to UI. */
export class PhonemeSession {
  private owner = ''
  private startedAtMs = 0
  private revision = 0
  private latestCapture = 0
  private latestEnd = 0
  private pending = false
  private sourceKey = ''
  private readings: JapaneseWord[][] | null = null
  private playback: PlaybackSnapshot | null = null
  private abort: AbortController | null = null
  private hypotheses = new OnsetHypotheses()

  constructor(private engine: PhonemeEngine, private match: PhonemeMatcher, private analyze = analyzeJapaneseLines) {}
  start(trackId: string, now = Date.now()) { this.clear(); this.owner = trackId; this.startedAtMs = now }
  clear() {
    this.revision++; this.owner = ''; this.latestCapture = 0; this.latestEnd = 0
    this.sourceKey = ''; this.readings = null; this.hypotheses.clear()
    this.abort?.abort(); this.abort = null; this.engine.cancel()
  }
  observePlayback(next: PlaybackSnapshot | null) {
    const before = this.playback
    if (!next?.isPlaying || next.track?.id !== before?.track?.id || !before?.isPlaying
      || ![next.positionMs, next.observedAtMs, before.positionMs, before.observedAtMs].every(Number.isFinite)
      || Math.abs(next.positionMs - before.positionMs - Math.max(0, next.observedAtMs - before.observedAtMs)) > 2000) this.clear()
    this.playback = next
    // Media position is used for discontinuity only, never matching.
  }

  async process(value: VocalCapture): Promise<PhonemeDiagnosticResult> {
    const started = Date.now()
    const rejected = (reason: string): PhonemeDiagnosticResult => ({ clockApplied: false, reason,
      groups: 0, candidates: 0, commonRows: 0, coverageComplete: false, coverageReasons: [reason],
      elapsedMs: Date.now() - started, inferenceMs: 0, matchingMs: 0 })
    if (this.pending) return rejected('busy')
    if (!this.owner || !value || value.trackId !== this.owner || value.trackId !== this.playback?.track?.id || !this.playback?.isPlaying) return rejected('inactive')
    if (value.language !== 'ja') return rejected('unsupported-language')
    if (value.sampleRate !== 16000 || !(value.pcm instanceof Float32Array)
      || value.pcm.length < 96000 || value.pcm.length > 240000
      || !Number.isFinite(value.capturedAtMs) || value.capturedAtMs <= this.latestCapture
      || value.capturedAtMs > started + 200 || started - value.capturedAtMs > 1500
      || !Number.isFinite(value.captureDurationMs) || Math.abs(value.captureDurationMs - value.pcm.length / 16) > 1
      || !Array.isArray(value.lines) || value.lines.length < 2 || value.lines.length > 400
      || Array.from(value.lines).some((line, i) => !line || typeof line.text !== 'string' || line.text.length > 500
        || !Number.isFinite(line.startMs) || line.startMs < 0 || line.startMs > 600000
        || (i > 0 && line.startMs < value.lines[i - 1].startMs))
      || value.lines.reduce((n, line) => n + line.text.length, 0) > 16000) return rejected('invalid-input')
    const captureStart = value.capturedAtMs - value.captureDurationMs
    if (captureStart < this.startedAtMs) return rejected('stale-input')
    if (this.latestEnd && captureStart < this.latestEnd) { this.clear(); return rejected('overlapping-capture') }
    this.latestCapture = value.capturedAtMs; this.latestEnd = value.capturedAtMs
    const key = lyricTimingKey(value.lines)
    if (this.sourceKey && this.sourceKey !== key) { this.clear(); return rejected('lyrics-changed') }
    if (!this.sourceKey) {
      this.sourceKey = key
      this.hypotheses.start(value.trackId, key, this.startedAtMs)
    }
    const quality = captureQuality(value.pcm)
    if (quality !== 'usable') {
      // Empty evidence never renews the resolver's heard-point timestamps.
      this.hypotheses.receive({ trackId: value.trackId, lyricTimingKey: key,
        capturedAtMs: value.capturedAtMs, captureDurationMs: value.captureDurationMs, groups: [] })
      return rejected(quality)
    }
    this.pending = true
    const revision = this.revision, abort = new AbortController()
    this.abort = abort
    const timeout = setTimeout(() => abort.abort(), 15000)
    const current = () => !abort.signal.aborted && revision === this.revision && this.owner === value.trackId
    try {
      if (!this.readings) {
        const words = await this.analyze(value.lines.map(line => line.text), { signal: abort.signal })
        if (!current()) return rejected('cancelled')
        if (words.length !== value.lines.length) return rejected('invalid-readings')
        this.readings = words
      }
      const inferAt = Date.now()
      const output = await this.engine.recognize(value.pcm, { signal: abort.signal })
      const inferenceMs = Date.now() - inferAt
      if (!current()) return rejected('cancelled')
      const matchAt = Date.now()
      const evidence = await this.match(output, value.lines, this.readings, value.captureDurationMs, abort.signal)
      const matchingMs = Date.now() - matchAt
      if (!current()) return rejected('cancelled')
      const receivedAt = Date.now()
      if (evidence.reason === 'work-budget' || evidence.reason === 'invalid-input') {
        // A failed exhaustive search cannot reuse old apparent uniqueness.
        this.hypotheses.start(value.trackId, key, value.capturedAtMs)
      }
      const hypothesis = this.hypotheses.receive({ trackId: value.trackId, lyricTimingKey: key,
        capturedAtMs: value.capturedAtMs, captureDurationMs: value.captureDurationMs, groups: evidence.groups }, receivedAt)
      // Even a resolved timing hypothesis remains a DIAGNOSTIC. Incomplete
      // competitor search or CTC peaks cannot silently become a clock anchor.
      return { clockApplied: false, reason: evidence.reason, hypothesisDecision: hypothesis.decision,
        hypothesisReason: hypothesis.reason, groups: evidence.groups.length, candidates: evidence.candidates.length,
        commonRows: hypothesis.window.reduce((n, block) => n + block.points.length, 0),
        coverageComplete: evidence.coverage.complete, coverageReasons: evidence.coverage.reasons,
        elapsedMs: receivedAt - started, inferenceMs, matchingMs }
    } catch (error) {
      if (!current()) return rejected(abort.signal.aborted && revision === this.revision ? 'timeout' : 'cancelled')
      this.clear()
      throw error
    } finally {
      clearTimeout(timeout)
      if (this.abort === abort) this.abort = null
      this.pending = false
    }
  }
}
