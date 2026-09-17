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
  if (previous && previous.trackIdentity === trackIdentity
    && previous.positionMs === positionMs && previous.statusName === sample.statusName) {
    return { ...previous, durationMs }
  }
  return { trackIdentity, positionMs, durationMs, statusName: sample.statusName, observedAtMs: now }
}

export function nativeClockPosition(anchor: NativeClockAnchor | null, now: number): number {
  if (!anchor) return 0
  const elapsed = anchor.statusName === 'PLAYING' ? Math.max(0, now - anchor.observedAtMs) : 0
  return Math.min(anchor.durationMs || Infinity, anchor.positionMs + elapsed)
}
