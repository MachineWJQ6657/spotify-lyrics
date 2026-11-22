import type { ListenedOffset } from '../types'

/**
 * A large listened offset is trusted for good only when a second play agrees.
 *
 * One play can be off as a whole: after the crossfade setting was changed in
 * the middle of a song, Spotify's position ran 4.2 s ahead of its audio until
 * the song ended (measured 2026-11-22). Listening then measured 4.2 s,
 * consistently, and the song would have kept that offset: a decided song is
 * not listened to again. Most songs measure within a few tenths of a second,
 * so a result of 1.5 s or more is applied at once but checked on the song's
 * next play; when the two agree it is confirmed, otherwise the newer one
 * replaces it.
 */
export const CONFIRM_OFFSET_MS = 1500
/** Two plays of one file measure within this of each other (spread of a single play: 30 to 110 ms). */
export const CONFIRM_AGREE_MS = 350

export function awaitsConfirmation(listened: ListenedOffset | null | undefined): boolean {
  return Boolean(listened && listened.state === 'decided' && Math.abs(listened.offsetMs) >= CONFIRM_OFFSET_MS && !listened.confirmed)
}

/** Whether `next`, measured on a later play, confirms the large offset `previous`. */
export function confirmedBy(previous: ListenedOffset | null | undefined, next: ListenedOffset): boolean {
  if (!awaitsConfirmation(previous) || next.state !== 'decided' || previous!.timingKey !== next.timingKey) return false
  const before = previous!.measuredDeltaMs ?? previous!.offsetMs
  const now = next.measuredDeltaMs ?? next.offsetMs
  return Math.abs(before - now) <= CONFIRM_AGREE_MS
}
