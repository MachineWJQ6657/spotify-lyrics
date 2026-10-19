import type { AcousticAnchor, PlaybackSnapshot } from '../../src/types'
import type { LyricMatch } from './lyric-aligner'

export interface HeardObservation extends LyricMatch { trackId: string; capturedAtMs: number; captureDurationMs: number; lyricTimingKey?: string }

const MAX_HOLDOVER_MS = 48_000
const MAX_PREDICTED_UNCERTAINTY_MS = 1000

/** Independent, short-lived lyric clock. Recognition completion time never
 * becomes the audio timestamp. Spotify's absolute position is never an anchor. */
export class LyricClock {
  private previous: PlaybackSnapshot | null = null
  private history: HeardObservation[] = []
  private anchor: AcousticAnchor | null = null
  private invalidatedAt = 0
  private latestCapture = 0
  revision = 0
  clear(now = Date.now()) { this.history = []; this.anchor = null; this.invalidatedAt = now; this.latestCapture = 0; this.revision++ }
  observePlayback(snapshot: PlaybackSnapshot | null, now = Date.now()) {
    const before = this.previous
    if (!snapshot?.isPlaying || !snapshot.track || snapshot.track.id !== before?.track?.id || !before.isPlaying
      || Math.abs(snapshot.positionMs - before.positionMs - Math.max(0, snapshot.observedAtMs - before.observedAtMs)) > 2000) this.clear(now)
    this.previous = snapshot
  }
  accept(value: HeardObservation, now = Date.now()): 'locked' | 'confirming' | 'rejected' {
    if (!value || !Number.isFinite(now) || !this.previous?.isPlaying || value.trackId !== this.previous.track?.id
      || !Number.isFinite(value.capturedAtMs) || !Number.isFinite(value.captureDurationMs)
      || value.capturedAtMs <= this.latestCapture || value.capturedAtMs > now + 200
      || now - value.capturedAtMs > 15000 || value.captureDurationMs < 6000 || value.captureDurationMs > 15000
      || value.capturedAtMs - value.captureDurationMs < this.invalidatedAt) return 'rejected'
    this.latestCapture = value.capturedAtMs
    const lastEvidence = this.history.at(-1)
    if ((lastEvidence && lastEvidence.lyricTimingKey !== value.lyricTimingKey)
      || (this.anchor && now >= this.anchor.expiresAtMs)) {
      this.history = []; this.anchor = null
    }
    // Silence or too few recognizable words supplies no new clock evidence.
    // Only the aligner's canonical empty result may hold an existing fit;
    // neither its capture time nor repeated misses can extend that fit's TTL.
    // Ambiguity, contradictory timing and malformed results revoke it below.
    if (value.accepted === false && value.reason === 'insufficient-words'
      && value.sourceEndMs === 0 && value.rate === 1 && value.score === 0 && value.residualMs === 0
      && Array.isArray(value.lineIndices) && value.lineIndices.length === 0) return 'rejected'
    if (!value.accepted || value.reason !== 'matched' || ![value.rate, value.score, value.sourceEndMs, value.residualMs].every(Number.isFinite)
      || value.rate < .85 || value.rate > 1.15 || value.score < .88 || value.score > 1 || value.sourceEndMs < 0 || value.sourceEndMs > 600000
      || value.residualMs < 0 || value.residualMs > 300 || !Array.isArray(value.lineIndices) || value.lineIndices.length < 2
      || value.lineIndices.some((index, order) => !Number.isInteger(index) || index < 0 || index >= 400
        || (order > 0 && index <= value.lineIndices[order - 1]))) {
      this.history = []; this.anchor = null
      return 'rejected'
    }
    const before = this.history.at(-1), elapsed = before ? value.capturedAtMs - before.capturedAtMs : 0
    // Every block remains independently gated. Discontinuity starts a new
    // candidate sequence instead of allowing old evidence to influence it.
    if (!before || before.lyricTimingKey !== value.lyricTimingKey || elapsed < value.captureDurationMs - 50 || elapsed > 36000
      || before.lineIndices.at(-1)! >= value.lineIndices[0] || Math.abs(before.rate - value.rate) > .04
      || Math.abs(value.sourceEndMs - before.sourceEndMs - elapsed * (value.rate + before.rate) / 2) > 550) {
      this.history = [value]
      this.anchor = null
      return 'confirming'
    }
    // Six-second captures need five endpoints for the twenty-second baseline.
    // Slow inference can skip a 12-second block, yielding a 24-second cadence;
    // retain three such endpoints rather than making a lock impossible. The
    // per-pair continuity gate still rejects gaps longer than 36 seconds.
    this.history = [...this.history, value].filter(item => value.capturedAtMs - item.capturedAtMs <= 72_000).slice(-7)
    const first = this.history[0]
    if (this.history.length < 3 || value.capturedAtMs - first.capturedAtMs < 20_000) {
      this.anchor = null
      return 'confirming'
    }

    // A 12-second ASR block can estimate its local slope poorly even when its
    // position is useful. Fit rate from at least three independent endpoint
    // observations spanning at least 20 seconds, using pairwise medians so one
    // noisy block cannot make the clock drift farther during extrapolation.
    const origin = first.capturedAtMs
    const slopes = this.history.flatMap((left, index) => this.history.slice(index + 1).map(right =>
      (right.sourceEndMs - left.sourceEndMs) / (right.capturedAtMs - left.capturedAtMs)))
    const middle = (numbers: number[]) => {
      const sorted = [...numbers].sort((left, right) => left - right), half = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
    }
    const rate = middle(slopes)
    const localRate = middle(this.history.map(item => item.rate))
    const intercept = middle(this.history.map(item => item.sourceEndMs - (item.capturedAtMs - origin) * rate))
    const residual = Math.max(...this.history.map(item => Math.abs(item.sourceEndMs - intercept - (item.capturedAtMs - origin) * rate)))
    if (!Number.isFinite(rate) || rate < .85 || rate > 1.15 || Math.abs(rate - localRate) > .04
      || this.history.some(item => Math.abs(item.rate - rate) > .06) || residual > 300) {
      this.history = [value]
      this.anchor = null
      return 'confirming'
    }
    const fittedEnd = intercept + (value.capturedAtMs - origin) * rate
    // Short blocks have timing uncertainty even when their fitted residual is
    // zero. Budget extrapolation error from the weakest endpoint and baseline,
    // with a 200ms position floor and at least 0.5% rate uncertainty. These are
    // conservative operating limits, not a calibrated accuracy guarantee.
    // A 24s capture cadence plus up to 15s inference needs >39s of holdover;
    // a well-supported long baseline permits that, but no fit survives 48s
    // without new audible evidence, and noisy fits expire sooner.
    const positionUncertainty = Math.max(200, residual, ...this.history.map(item => item.residualMs))
    const rateUncertainty = Math.max(.005, 2 * positionUncertainty / (value.capturedAtMs - origin))
    const holdoverMs = Math.min(MAX_HOLDOVER_MS,
      Math.floor((MAX_PREDICTED_UNCERTAINTY_MS - positionUncertainty) / rateUncertainty))
    this.anchor = { trackId: value.trackId, sourcePositionMs: fittedEnd, observedAtMs: value.capturedAtMs,
      ...(value.lyricTimingKey ? { coordinate: 'lyrics' as const, lyricTimingKey: value.lyricTimingKey } : {}),
      expiresAtMs: value.capturedAtMs + holdoverMs, rate, score: Math.min(...this.history.map(item => item.score)) }
    return 'locked'
  }
  decorate<T extends PlaybackSnapshot>(snapshot: T | null, now = Date.now()): T | null {
    if (!snapshot) return null
    // Capture timestamps allow a small producer clock skew, but an accepted
    // future observation must not become visible before that time is reached.
    return this.anchor && snapshot.isPlaying && snapshot.track?.id === this.anchor.trackId
      && now >= this.anchor.observedAtMs && now < this.anchor.expiresAtMs
      ? { ...snapshot, acousticAnchor: this.anchor } : snapshot
  }
}
