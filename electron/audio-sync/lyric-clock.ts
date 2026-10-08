import type { AcousticAnchor, PlaybackSnapshot } from '../../src/types'
import type { LyricMatch } from './lyric-aligner'

export interface HeardObservation extends LyricMatch { trackId: string; capturedAtMs: number; captureDurationMs: number }

/** Independent, short-lived lyric clock. Recognition completion time never
 * becomes the audio timestamp. Spotify's absolute position is never an anchor. */
export class LyricClock {
  private previous: PlaybackSnapshot | null = null
  private candidate: HeardObservation | null = null
  private anchor: AcousticAnchor | null = null
  private invalidatedAt = 0
  private latestCapture = 0
  revision = 0
  clear(now = Date.now()) { this.candidate = null; this.anchor = null; this.invalidatedAt = now; this.latestCapture = 0; this.revision++ }
  observePlayback(snapshot: PlaybackSnapshot | null, now = Date.now()) {
    const before = this.previous
    if (!snapshot?.isPlaying || !snapshot.track || snapshot.track.id !== before?.track?.id || !before.isPlaying
      || Math.abs(snapshot.positionMs - before.positionMs - Math.max(0, snapshot.observedAtMs - before.observedAtMs)) > 2000) this.clear(now)
    this.previous = snapshot
  }
  accept(value: HeardObservation, now = Date.now()): 'locked' | 'confirming' | 'rejected' {
    if (!this.previous?.isPlaying || value.trackId !== this.previous.track?.id
      || !Number.isFinite(value.capturedAtMs) || !Number.isFinite(value.captureDurationMs)
      || value.capturedAtMs <= this.latestCapture || value.capturedAtMs > now + 200
      || now - value.capturedAtMs > 15000 || value.captureDurationMs < 6000 || value.captureDurationMs > 15000
      || value.capturedAtMs - value.captureDurationMs < this.invalidatedAt) return 'rejected'
    this.latestCapture = value.capturedAtMs
    if (!value.accepted || value.reason !== 'matched' || ![value.rate, value.score, value.sourceEndMs, value.residualMs].every(Number.isFinite)
      || value.rate < .85 || value.rate > 1.15 || value.score < .88 || value.sourceEndMs < 0 || value.sourceEndMs > 600000
      || value.residualMs > 300 || value.lineIndices.length < 2) {
      this.candidate = null; this.anchor = null
      return 'rejected'
    }
    const before = this.candidate, elapsed = before ? value.capturedAtMs - before.capturedAtMs : 0
    this.candidate = value
    // Non-overlapping independent samples, four or more distinct complete
    // lines, matching speed and predicted location; no single-sentence lock.
    if (!before || elapsed < value.captureDurationMs - 50 || elapsed > 36000
      || before.lineIndices.at(-1)! >= value.lineIndices[0] || Math.abs(before.rate - value.rate) > .04
      || Math.abs(value.sourceEndMs - before.sourceEndMs - elapsed * (value.rate + before.rate) / 2) > 550) {
      this.anchor = null
      return 'confirming'
    }
    this.anchor = { trackId: value.trackId, sourcePositionMs: value.sourceEndMs, observedAtMs: value.capturedAtMs,
      expiresAtMs: value.capturedAtMs + 28000, rate: (value.rate + before.rate) / 2, score: Math.min(value.score, before.score) }
    return 'locked'
  }
  decorate<T extends PlaybackSnapshot>(snapshot: T | null, now = Date.now()): T | null {
    if (!snapshot) return null
    return this.anchor && snapshot.isPlaying && snapshot.track?.id === this.anchor.trackId && now < this.anchor.expiresAtMs
      ? { ...snapshot, acousticAnchor: this.anchor } : snapshot
  }
}
