export interface NativeClockSample {
  artist: string
  title: string
  album: string
  positionMs: number
  durationMs: number
  statusName: string
}

export interface NativeClockAnchor {
  trackIdentity: string
  positionMs: number
  /** The raw position of the sample this anchor came from, when `positionMs` is a projection of it. */
  rawPositionMs?: number
  durationMs: number
  statusName: string
  observedAtMs: number
}

/** Consume raw snapshots only. libspotifyctl's positionChanged and
 * positionSmoothMs retain errors below 1500 ms, so neither is a time source.
 * Repeated metadata/poll snapshots carry an old position: do not timestamp
 * them again. Every distinct raw position corrects both early and late clocks.
 * These self-contained functions are also injected into the native Worker.
 */
export function observeNativeClock(previous: NativeClockAnchor | null, sample: NativeClockSample | null, now: number): NativeClockAnchor | null {
  if (!sample?.title) return null
  const trackIdentity = `${sample.artist || ''}\0${sample.title}\0${sample.album || ''}`
  const positionMs = Math.max(0, Number(sample.positionMs) || 0)
  const durationMs = Math.max(0, Number(sample.durationMs) || 0)
  if (previous && previous.trackIdentity === trackIdentity && (previous.rawPositionMs ?? previous.positionMs) === positionMs) {
    if (previous.statusName === sample.statusName) return { ...previous, durationMs }
    // The status changed and the position is the one already seen: this is a
    // notification, not a new measurement. Pausing then holds the clock where
    // it has run to. Anchoring at the old raw position (up to 4.5 s back)
    // showed an earlier line for the 4-70 ms until the paused position came.
    // (Kept free of calls to other functions: the source is injected into the worker.)
    if (previous.statusName === 'PLAYING') {
      const heldMs = Math.min(durationMs || Infinity, previous.positionMs + Math.max(0, now - previous.observedAtMs))
      return { trackIdentity, positionMs: heldMs, rawPositionMs: positionMs, durationMs, statusName: sample.statusName, observedAtMs: now }
    }
    // Playing again within moments, still without a new measurement (a status
    // flap, or a quick pause and play): go on from where the clock was held;
    // the old raw position restarted it late by the whole time since that
    // sample. After a longer pause the raw position is taken as before: by
    // then it may be a real one (a track that ended and starts again at 0).
    if (sample.statusName === 'PLAYING' && now - previous.observedAtMs <= 1500) {
      return { trackIdentity, positionMs: previous.positionMs, rawPositionMs: positionMs, durationMs, statusName: sample.statusName, observedAtMs: now }
    }
  }
  return { trackIdentity, positionMs, durationMs, statusName: sample.statusName, observedAtMs: now }
}

export function nativeClockPosition(anchor: NativeClockAnchor | null, now: number): number {
  if (!anchor) return 0
  const elapsed = anchor.statusName === 'PLAYING' ? Math.max(0, now - anchor.observedAtMs) : 0
  return Math.min(anchor.durationMs || Infinity, anchor.positionMs + elapsed)
}
