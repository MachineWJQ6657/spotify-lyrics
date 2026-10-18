import type { AcousticAnchor, PlaybackSnapshot } from '../../src/types'
import type { AcousticMatch } from './fingerprint'

export interface AcousticObservation extends AcousticMatch { trackId: string; capturedAtMs: number; captureDurationMs: number }

/** Audio supplies the lyric position; Spotify supplies identity, pause and seek
 * invalidation only. Two non-overlapping agreeing windows are required to lock.
 */
export class AcousticClock {
  private previousPlayback: PlaybackSnapshot | null = null
  private candidate: AcousticObservation | null = null
  private anchor: AcousticAnchor | null = null
  private invalidatedAtMs = 0
  private latestCaptureMs = 0

  clear(now = Date.now()) { this.candidate = null; this.anchor = null; this.invalidatedAtMs = now; this.latestCaptureMs = 0 }

  observePlayback(snapshot: PlaybackSnapshot | null, now = Date.now()) {
    const previous = this.previousPlayback
    if (!snapshot?.track || !snapshot.isPlaying || previous?.track?.id !== snapshot.track.id
      || previous.isPlaying !== snapshot.isPlaying) this.clear(now)
    else if (previous) {
      const elapsed = Math.max(0, snapshot.observedAtMs - previous.observedAtMs)
      if (Math.abs(snapshot.positionMs - previous.positionMs - elapsed) > 2000) this.clear(now)
    }
    this.previousPlayback = snapshot
  }

  accept(value: AcousticObservation, now = Date.now()): 'locked' | 'confirming' | 'rejected' {
    // Replies outside the current capture history cannot mutate its evidence.
    // Keeping only the anchor is insufficient: clearing its candidate would
    // make the next fresh match revoke an otherwise continuous lock.
    if (!value || !this.previousPlayback?.isPlaying || value.trackId !== this.previousPlayback.track?.id
      || !Number.isFinite(value.capturedAtMs) || value.capturedAtMs < this.latestCaptureMs
      || now - value.capturedAtMs > 5000 || value.capturedAtMs > now + 200
      || (Number.isFinite(value.captureDurationMs) && value.capturedAtMs - value.captureDurationMs < this.invalidatedAtMs)) return 'rejected'
    if (value.capturedAtMs === this.latestCaptureMs) {
      // Preserve the existing response for a repeated accepted candidate,
      // without treating it as a second sample or extending an anchor's TTL.
      return value.accepted && value.reason === 'matched' && this.candidate?.capturedAtMs === value.capturedAtMs
        ? this.anchor ? 'locked' : 'confirming' : 'rejected'
    }
    this.latestCaptureMs = value.capturedAtMs
    const numbers = [value?.sourceEndMs, value?.sourceStartMs, value?.rate, value?.score, value?.margin, value?.capturedAtMs, value?.captureDurationMs]
    if (!value || numbers.some(number => !Number.isFinite(number)) || !value.accepted
      || value.reason !== 'matched' || value.score < .8 || value.margin < .075
      || value.rate < .8 || value.rate > 1.2 || value.sourceStartMs < -150 || value.sourceEndMs > 600000
      || value.sourceEndMs <= value.sourceStartMs || now - value.capturedAtMs > 5000 || value.capturedAtMs > now + 200
      || value.captureDurationMs < 6000 || value.captureDurationMs > 15000
      || value.capturedAtMs - value.captureDurationMs < this.invalidatedAtMs
      || Math.abs(value.sourceEndMs - value.sourceStartMs - value.captureDurationMs * value.rate) > 100
      || !this.previousPlayback?.isPlaying || value.trackId !== this.previousPlayback.track?.id) {
      this.candidate = null
      // A fresh rejected block no longer supports the old path. Do not continue
      // that rate for the remaining TTL while the UI says calibration failed.
      this.anchor = null
      return 'rejected'
    }
    const previous = this.candidate
    const elapsed = previous ? value.capturedAtMs - previous.capturedAtMs : 0
    const consistent = previous && previous.trackId === value.trackId
      && elapsed >= value.captureDurationMs - 50 && elapsed <= 22000
      && Math.abs(previous.rate - value.rate) < .035
      && Math.abs(value.sourceEndMs - previous.sourceEndMs - elapsed * (value.rate + previous.rate) / 2) < 450
    this.candidate = value
    if (!consistent) { this.anchor = null; return 'confirming' }
    this.anchor = { trackId: value.trackId, sourcePositionMs: value.sourceEndMs, observedAtMs: value.capturedAtMs,
      rate: value.rate, expiresAtMs: value.capturedAtMs + 20000, score: value.score }
    return 'locked'
  }

  decorate<T extends PlaybackSnapshot>(snapshot: T | null, now = Date.now()): T | null {
    if (!snapshot) return null
    const valid = this.anchor && snapshot.isPlaying && snapshot.track?.id === this.anchor.trackId && now < this.anchor.expiresAtMs
    return { ...snapshot, acousticAnchor: valid ? this.anchor! : undefined }
  }
}
