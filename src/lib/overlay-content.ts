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
