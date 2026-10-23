import type { NativeClockSample } from './native-clock'

export interface NativeBoundaryPending<T extends NativeClockSample> {
  trackIdentity: string
  firstSeenAtMs: number
  observedAtMs: number
  sample: T
}
export interface NativeBoundaryResult<T extends NativeClockSample> {
  sample: T | null
  pending: NativeBoundaryPending<T> | null
  held: boolean
  /** A persistent same-title reset, released after the bounded quarantine. */
  resetConfirmed: boolean
  observedAtMs: number
}

/** Raw SMTC metadata is not atomic at queue boundaries. On 2026-10-23 it
 * reported the outgoing title at zero with either zero or NEXT-song duration
 * 1..153 ms before the new title. Quarantine only this combined shape, before
 * observing the clock or applying a Mix duration. A timer MUST revisit the
 * pending sample at firstSeenAtMs + 250 even if no native event follows.
 *
 * This is not a correction to Spotify's song/lyric rate. Real same-duration
 * seeks and pause/resume are immediate. Unknown-duration sessions and small
 * corrections are not held. A persistent reset becomes authoritative after
 * 250 ms using its ORIGINAL observation time, not the timer's wake-up time.
 * Self-contained: this function is injected into the native Worker.
 */
export function guardNativeBoundary<T extends NativeClockSample>(previous: T | null, incoming: T | null,
  pending: NativeBoundaryPending<T> | null, now: number): NativeBoundaryResult<T> {
  const identity = (sample: NativeClockSample) => `${sample.artist || ''}\0${sample.title || ''}\0${sample.album || ''}`
  const accept = (sample: T | null, observedAtMs = now, resetConfirmed = false): NativeBoundaryResult<T> =>
    ({ sample, pending: null, held: false, resetConfirmed, observedAtMs })
  if (!previous?.title || !incoming?.title || identity(previous) !== identity(incoming)) return accept(incoming)
  const previousPosition = Number(previous.positionMs), position = Number(incoming.positionMs)
  const previousDuration = Number(previous.durationMs), duration = Number(incoming.durationMs)
  const suspicious = previous.statusName === 'PLAYING' && incoming.statusName === 'PLAYING'
    && [previousPosition, position, previousDuration, duration, now].every(Number.isFinite)
    && previousPosition - position > 2500 && position >= 0 && position <= 2500
    && previousDuration > 0 && (duration === 0 || Math.abs(duration - previousDuration) > 2500)
  if (!suspicious) return accept(incoming)
  const samePending = pending?.trackIdentity === identity(incoming) && now >= pending.firstSeenAtMs
  const next: NativeBoundaryPending<T> = samePending
    ? { ...pending, sample: incoming,
      // A repeated zero/metadata-only notification still contains the original
      // raw position. Do not timestamp it again after the quarantine.
      observedAtMs: pending.sample.positionMs === incoming.positionMs ? pending.observedAtMs : now }
    : { trackIdentity: identity(incoming), firstSeenAtMs: now, observedAtMs: now, sample: incoming }
  if (now - next.firstSeenAtMs >= 250) return accept(incoming, next.observedAtMs, true)
  return { sample: previous, pending: next, held: true, resetConfirmed: false, observedAtMs: now }
}
