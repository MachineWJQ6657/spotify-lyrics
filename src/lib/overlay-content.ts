import type { LyricLine, LyricsDocument, PlaybackSnapshot } from '../types'

/**
 * What the desktop overlay shows when there is no lyric line to sing:
 * - `lyric`: the active line (rendered by the caller with its secondaries)
 * - `interlude`: an empty timed row inside the song (♪)
 * - `title`: before the first line, while lyrics load, or when the song has
 *   none: the song title and artist instead of a lone ♪
 * - `idle`: nothing is playing
 */
export type OverlayContent =
  | { kind: 'lyric' }
  | { kind: 'interlude' }
  | { kind: 'title'; title: string; subtitle: string }
  | { kind: 'idle' }

export function overlayContent(playback: PlaybackSnapshot | null, document: LyricsDocument | null, line: LyricLine | undefined): OverlayContent {
  if (line) return line.text.trim() || line.words?.length ? { kind: 'lyric' } : { kind: 'interlude' }
  const track = playback?.track
  if (!track?.name) return { kind: 'idle' }
  const artist = track.artist?.trim() ?? ''
  const subtitle = document?.instrumental ? (artist ? `${artist} · 纯音乐` : '纯音乐') : artist
  return { kind: 'title', title: track.name.trim(), subtitle }
}

/**
 * The next line that has words, for the optional preview row under the line
 * being sung. Empty rows (interludes) are skipped, so the preview during an
 * interlude or the intro is the line that comes after it.
 */
export function upcomingLine(lines: LyricLine[] | undefined, index: number): LyricLine | undefined {
  if (!lines) return undefined
  for (let next = Math.max(-1, index) + 1; next < lines.length; next++) if (lines[next].text.trim()) return lines[next]
  return undefined
}

/** How long playback stays paused before the "hide while paused" option takes the lyrics off the desktop. */
export const PAUSED_HIDE_DELAY_MS = 10_000

/**
 * Whether the optional "hide while paused" applies. Only a locked overlay
 * hides: an unlocked one is being moved or resized and must stay visible, and
 * a short pause (a skip, a queue boundary) never hides it.
 */
export function hidesWhilePaused(input: { enabled: boolean; locked: boolean; playing: boolean; pausedForMs: number }): boolean {
  return input.enabled && input.locked && !input.playing && input.pausedForMs >= PAUSED_HIDE_DELAY_MS
}

/** Smallest scale a long line may be shrunk to before it is clipped instead. */
export const MIN_OVERLAY_FIT = .6

/**
 * Largest font scale at which the overlay content fits, found by bisection:
 * the caller renders at `value`, measures, and steps with whether it fitted.
 * Wrapping makes height a step function of the scale (a smaller font can drop
 * a whole row), so a proportional guess overshoots; about five renders reach
 * a 2% bracket. Runs once per line change, before paint (layout effect).
 */
export interface FitSearch { value: number; lo: number; hi: number; done: boolean }
export const FIT_START: FitSearch = Object.freeze({ value: 1, lo: MIN_OVERLAY_FIT, hi: 1, done: false })

export function fitSearchStep(search: FitSearch, fits: boolean): FitSearch {
  if (search.done) return search
  if (fits && search.value >= 1) return { ...search, done: true }
  const lo = fits ? search.value : search.lo
  const hi = fits ? search.hi : search.value
  if (hi - lo <= .02 + 1e-9) return { value: lo, lo, hi, done: true }
  return { value: Math.round((lo + hi) / 2 * 100) / 100, lo, hi, done: false }
}
