import type { PlaybackSnapshot, SpotifyTransitionProfile } from '../types'

/**
 * The transport clock is independent from lyric transitions. Each Spotify sample
 * is anchored to the midpoint of its HTTP request, then projected locally.
 */
export class TransportClock {
  private anchor: PlaybackSnapshot | null = null
  private rawAnchor: PlaybackSnapshot | null = null
  update(snapshot: PlaybackSnapshot | null) {
    if (snapshot && this.anchor && snapshot.observedAtMs < this.anchor.observedAtMs && snapshot.track?.id === this.anchor.track?.id) return
    const raw = snapshot
    if (snapshot && this.anchor && this.rawAnchor
      && snapshot.track?.id === this.rawAnchor.track?.id
      && snapshot.observedAtMs === this.rawAnchor.observedAtMs
      && snapshot.positionMs === this.rawAnchor.positionMs
      && snapshot.isPlaying === this.rawAnchor.isPlaying) {
      // Metadata/snapshot broadcasts are not new transport observations. Keep
      // the once-corrected position while accepting updated duration/profile.
      this.anchor = { ...snapshot, positionMs: this.anchor.positionMs }
      this.rawAnchor = raw
      return
    }
    if (snapshot && snapshot.playbackSource !== 'local' && this.anchor && snapshot.track?.id === this.anchor.track?.id && snapshot.isPlaying && this.anchor.isPlaying) {
      const projected = this.position(snapshot.observedAtMs)
      const drift = snapshot.positionMs - projected
      // Native SMTC samples can arrive a few hundred milliseconds late. Small
      // corrections are blended so the lyric clock never visibly hops behind;
      // large changes remain immediate because they represent an actual seek.
      if (Math.abs(drift) < 1200) snapshot = { ...snapshot, positionMs: projected + drift * .55 }
    }
    this.anchor = snapshot
    this.rawAnchor = raw
  }
  position(now = Date.now()) {
    if (!this.anchor) return 0
    const elapsed = this.anchor.isPlaying ? Math.max(0, now - this.anchor.observedAtMs) : 0
    const reportedDuration = this.anchor.track?.durationMs
    // SMTC can briefly (and on some media sessions permanently) report a
    // zero duration while still providing a valid live position. Zero means
    // unknown here, not "the song ended at 0ms".
    const upperBound = reportedDuration && reportedDuration > 0 ? reportedDuration : Infinity
    return Math.min(upperBound, this.anchor.positionMs + elapsed)
  }
}

export function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Map Spotify's media-session position to the recording clock used by LRC.
 * Automix cue points describe where two songs should align during a transition;
 * they are not a hidden trim at the beginning of every song. Only Spotify's
 * explicit speed curve changes elapsed recording time, so the curve is
 * integrated from the native zero-based SMTC position.
 */
export function spotifySourcePosition(positionMs: number, transition?: SpotifyTransitionProfile) {
  if (!transition || transition.kind !== 'spotify-mix') return Math.max(0, positionMs)
  const outputPosition = Math.max(0, positionMs)
  const points = transition.speedAutomation
  if (!points.length) return outputPosition
  const malformed = points.some((point, index) => !Number.isFinite(point.fromPositionMs)
    || point.fromPositionMs < 0 || !Number.isFinite(point.speed) || point.speed < .5 || point.speed > 2
    || (index > 0 && point.fromPositionMs <= points[index - 1].fromPositionMs))
  if (malformed) return outputPosition

  let travelled = Math.min(outputPosition, points[0].fromPositionMs)
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    if (point.fromPositionMs >= outputPosition) break
    const nextBoundary = points[index + 1]?.fromPositionMs ?? outputPosition
    const end = Math.min(outputPosition, nextBoundary)
    travelled += Math.max(0, end - point.fromPositionMs) * point.speed
  }
  return Number.isFinite(travelled) ? Math.max(0, travelled) : outputPosition
}

/**
 * Duration differences do not establish playback speed: fades, silence and
 * alternate edits can all change an endpoint without changing sung timing.
 * Never infer a global tempo ratio from two durations. Retained as an API
 * compatibility helper; only explicit speed automation maps recording time.
 */
export function lyricDurationScale(_transportDurationMs?: number, _sourceDurationMs?: number, _transition?: SpotifyTransitionProfile) {
  return 1
}

export function lyricSourcePosition(positionMs: number, transportDurationMs?: number, sourceDurationMs?: number, transition?: SpotifyTransitionProfile) {
  const explicitPosition = spotifySourcePosition(positionMs, transition)
  return Math.max(0, explicitPosition * lyricDurationScale(transportDurationMs, sourceDurationMs, transition))
}

/** Positive calibration delays lyrics; Spotify transport itself remains untouched. */
export function calibratedPosition(positionMs: number, offsetMs: number) {
  return Math.max(0, positionMs - offsetMs)
}

/** An accepted audio anchor is already in recording coordinates. Never apply
 * Spotify Mix speed automation to it a second time. Transport controls retain
 * their original media-session clock; this helper is for lyric surfaces only.
 */
export function lyricPlaybackPosition(positionMs: number, playback: PlaybackSnapshot | null, sourceDurationMs?: number, now = Date.now()) {
  const anchor = playback?.acousticAnchor
  if (anchor && playback?.isPlaying && anchor.trackId === playback.track?.id
    && [anchor.sourcePositionMs, anchor.observedAtMs, anchor.expiresAtMs, anchor.rate, anchor.score].every(Number.isFinite)
    && anchor.rate >= .8 && anchor.rate <= 1.2 && anchor.score >= .8
    && now >= anchor.observedAtMs && now < anchor.expiresAtMs) {
    return Math.max(0, anchor.sourcePositionMs + (now - anchor.observedAtMs) * anchor.rate)
  }
  return lyricSourcePosition(positionMs, playback?.track?.durationMs, sourceDurationMs, playback?.transition)
}
