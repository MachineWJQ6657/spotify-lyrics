import type { AcousticAnchor, PlaybackSnapshot } from '../../src/types'

export interface OnsetPoint { lineIndex: number; heardMs: number; sourceMs: number; score: number }
export interface OnsetObservation {
  trackId: string
  capturedAtMs: number
  captureDurationMs: number
  lyricTimingKey: string
  reason: 'matched' | 'insufficient-words' | 'ambiguous' | 'inconsistent-timing'
  points: OnsetPoint[]
}
export type OnsetDecisionReason = 'unavailable' | 'inactive' | 'stale-input' | 'invalid-input'
  | 'lyrics-changed' | 'overlapping-capture' | 'insufficient-words' | 'ambiguous'
  | 'inconsistent-timing' | 'insufficient-baseline' | 'evidence-gap' | 'expired' | 'matched'

interface TimedPoint extends OnsetPoint { observedAtMs: number }
interface EvidenceBlock { capturedAtMs: number; points: TimedPoint[] }
const MAX_HOLDOVER_MS = 48_000
const MAX_PREDICTED_UNCERTAINTY_MS = 1000
const MAX_RESIDUAL_MS = 300
const MIN_RATE = .85
const MAX_RATE = 1.15

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

/** Clock fitted to independently recognized line onsets, never to Spotify's
 * absolute position or invented rate-1 endpoints. Text and repeated-phrase
 * disambiguation belong to the extractor; this class validates time evidence. */
export class OnsetClock {
  private previous: PlaybackSnapshot | null = null
  private history: EvidenceBlock[] = []
  private anchor: AcousticAnchor | null = null
  private timingKey = ''
  private invalidatedAt = 0
  private latestCapture = 0
  private latestCaptureEnd = 0
  private latestDecisionReason: OnsetDecisionReason = 'unavailable'
  revision = 0

  get decisionReason(): OnsetDecisionReason { return this.latestDecisionReason }

  private decision<Result extends 'locked' | 'confirming' | 'rejected'>(result: Result, reason: OnsetDecisionReason): Result {
    this.latestDecisionReason = reason
    return result
  }

  private discardEvidence() { this.history = []; this.anchor = null }

  clear(now = Date.now()) {
    this.discardEvidence(); this.timingKey = ''; this.invalidatedAt = now
    this.latestCapture = 0; this.latestCaptureEnd = 0; this.revision++
    this.latestDecisionReason = 'unavailable'
  }

  observePlayback(snapshot: PlaybackSnapshot | null, now = Date.now()) {
    const before = this.previous
    if (!snapshot?.isPlaying || !snapshot.track || snapshot.track.id !== before?.track?.id || !before.isPlaying
      || ![snapshot.positionMs, snapshot.observedAtMs, before.positionMs, before.observedAtMs].every(Number.isFinite)
      || Math.abs(snapshot.positionMs - before.positionMs - Math.max(0, snapshot.observedAtMs - before.observedAtMs)) > 2000) this.clear(now)
    this.previous = snapshot
  }

  accept(value: OnsetObservation, now = Date.now()): 'locked' | 'confirming' | 'rejected' {
    // Late, duplicate, foreign and future replies cannot overwrite evidence
    // belonging to a newer capture. Recognition latency is not audio time.
    if (!value || !Number.isFinite(now) || !Number.isFinite(value.capturedAtMs)) return this.decision('rejected', 'invalid-input')
    if (!this.previous?.isPlaying || !this.previous.track) return this.decision('rejected', 'inactive')
    if (value.trackId !== this.previous.track.id || value.capturedAtMs <= this.latestCapture
      || value.capturedAtMs > now + 200 || now - value.capturedAtMs > 15_000) return this.decision('rejected', 'stale-input')
    this.latestCapture = value.capturedAtMs
    if (!Number.isFinite(value.captureDurationMs) || value.captureDurationMs < 6000 || value.captureDurationMs > 15_000
      || typeof value.lyricTimingKey !== 'string' || !value.lyricTimingKey || value.lyricTimingKey.length > 200
      || !Array.isArray(value.points) || value.points.length > 40) {
      this.discardEvidence(); return this.decision('rejected', 'invalid-input')
    }
    const captureStart = value.capturedAtMs - value.captureDurationMs
    if (captureStart < this.invalidatedAt) return this.decision('rejected', 'stale-input')
    let resetReason: OnsetDecisionReason | undefined
    if (this.timingKey && this.timingKey !== value.lyricTimingKey) {
      this.discardEvidence(); resetReason = 'lyrics-changed'
    }
    this.timingKey = value.lyricTimingKey
    // No confidence renewal from missing vocals; an expired sequence must
    // establish three independent blocks again instead of reviving its fit.
    if (this.anchor && now >= this.anchor.expiresAtMs) {
      this.discardEvidence(); resetReason = 'expired'
    }
    if (this.latestCaptureEnd && captureStart < this.latestCaptureEnd - 50) {
      this.discardEvidence(); this.latestCaptureEnd = value.capturedAtMs
      return this.decision('rejected', 'overlapping-capture')
    }
    this.latestCaptureEnd = value.capturedAtMs
    if (value.reason === 'insufficient-words' && value.points.length === 0) return this.decision('rejected', resetReason ?? 'insufficient-words')
    if (value.reason !== 'matched') {
      this.discardEvidence()
      return this.decision('rejected', value.reason === 'ambiguous' || value.reason === 'inconsistent-timing' ? value.reason : 'invalid-input')
    }
    if (value.points.length === 0
      || value.points.some(point => !point || ![point.lineIndex, point.heardMs, point.sourceMs, point.score].every(Number.isFinite)
        || !Number.isInteger(point.lineIndex) || point.lineIndex < 0 || point.lineIndex >= 400
        || point.heardMs < 150 || point.heardMs > value.captureDurationMs - 150
        || point.sourceMs < 0 || point.sourceMs > 600_000 || point.score < .88 || point.score > 1)) {
      this.discardEvidence(); return this.decision('rejected', 'invalid-input')
    }
    if (value.points.some((point, index) => index > 0 && (point.lineIndex <= value.points[index - 1].lineIndex
      || point.heardMs <= value.points[index - 1].heardMs || point.sourceMs <= value.points[index - 1].sourceMs))) {
      this.discardEvidence(); return this.decision('rejected', 'inconsistent-timing')
    }
    const block: EvidenceBlock = { capturedAtMs: value.capturedAtMs,
      points: value.points.map(point => ({ ...point, observedAtMs: captureStart + point.heardMs })) }
    const previousBlock = this.history.at(-1)
    if (previousBlock) {
      const last = previousBlock.points.at(-1)!, first = block.points[0]
      const elapsed = first.observedAtMs - last.observedAtMs, sourceElapsed = first.sourceMs - last.sourceMs
      // Two individually plausible endpoints cannot rescue a repeated line or
      // an impossible direction/speed. Failed blocks are not seeded as truth.
      if (first.lineIndex <= last.lineIndex || elapsed <= 0 || sourceElapsed <= 0
        || sourceElapsed < elapsed * MIN_RATE - MAX_RESIDUAL_MS * 2
        || sourceElapsed > elapsed * MAX_RATE + MAX_RESIDUAL_MS * 2) {
        this.discardEvidence(); return this.decision('rejected', 'inconsistent-timing')
      }
      if (value.capturedAtMs - previousBlock.capturedAtMs > 36_000) {
        this.discardEvidence(); resetReason = 'evidence-gap'
      }
    }
    this.history = [...this.history, block]
      .filter(item => value.capturedAtMs - item.capturedAtMs <= 72_000).slice(-7)
    const points = this.history.flatMap(item => item.points)
    const origin = points[0].observedAtMs, latest = points.at(-1)!
    const baseline = latest.observedAtMs - origin
    if (this.history.length < 3 || points.length < 3 || baseline < 20_000) {
      this.anchor = null; return this.decision('confirming', resetReason ?? 'insufficient-baseline')
    }

    // Give each independent pair of blocks one slope vote, so many words in
    // one capture cannot outweigh the other captures. Never force slope 1 to
    // manufacture a position at the end of a partially recognized clip.
    const slopes = this.history.flatMap((left, index) => this.history.slice(index + 1).map(right => median(
      left.points.flatMap(a => right.points.map(b => (b.sourceMs - a.sourceMs) / (b.observedAtMs - a.observedAtMs))))))
    const rate = median(slopes)
    const intercept = median(this.history.map(item => median(item.points.map(point => point.sourceMs - (point.observedAtMs - origin) * rate))))
    const residual = Math.max(...points.map(point => Math.abs(point.sourceMs - intercept - (point.observedAtMs - origin) * rate)))
    if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE || !Number.isFinite(intercept) || residual > MAX_RESIDUAL_MS) {
      this.discardEvidence(); return this.decision('rejected', 'inconsistent-timing')
    }
    const positionUncertainty = Math.max(200, residual)
    const rateUncertainty = Math.max(.005, 2 * positionUncertainty / baseline)
    const holdoverMs = Math.min(MAX_HOLDOVER_MS,
      Math.floor((MAX_PREDICTED_UNCERTAINTY_MS - positionUncertainty) / rateUncertainty))
    const expiresAtMs = latest.observedAtMs + holdoverMs
    if (now >= expiresAtMs) { this.discardEvidence(); return this.decision('rejected', 'expired') }
    this.anchor = { trackId: value.trackId, coordinate: 'lyrics', lyricTimingKey: value.lyricTimingKey,
      sourcePositionMs: intercept + baseline * rate, observedAtMs: latest.observedAtMs,
      expiresAtMs, rate, score: Math.min(...points.map(point => point.score)) }
    return this.decision('locked', 'matched')
  }

  decorate<T extends PlaybackSnapshot>(snapshot: T | null, now = Date.now()): T | null {
    if (!snapshot) return null
    const anchor = this.anchor
    return anchor && snapshot.isPlaying && snapshot.track?.id === anchor.trackId
      && now >= anchor.observedAtMs && now < anchor.expiresAtMs ? { ...snapshot, acousticAnchor: anchor } : snapshot
  }
}
