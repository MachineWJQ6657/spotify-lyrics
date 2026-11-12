import type { LyricLine } from '../types'
import { activeLineIndex } from './lyrics'

/**
 * Lyric-time milliseconds until what a lyric surface shows changes: the next
 * line starts, or the next word of a word-timed active line. Undefined when
 * nothing further changes (after the last line). Lines must be sorted, as
 * parseLrc and visibleTracks produce them.
 */
export function msUntilNextLyricChange(lines: readonly LyricLine[], lyricMs: number): number | undefined {
  if (!lines.length || !Number.isFinite(lyricMs)) return undefined
  const index = activeLineIndex(lines as LyricLine[], lyricMs)
  let next = lines[index + 1]?.startMs ?? Infinity
  const words = index >= 0 ? lines[index].words : undefined
  if (words) for (const word of words) if (word.startMs > lyricMs) { next = Math.min(next, word.startMs); break }
  return Number.isFinite(next) ? next - lyricMs : undefined
}

/** Wall-clock delay for a lyric-time distance on a clock running at `rate` (audio anchors: 0.8–1.2). */
export function wallDelayMs(lyricDeltaMs: number | undefined, rate = 1) {
  if (lyricDeltaMs === undefined || !Number.isFinite(lyricDeltaMs)) return undefined
  return lyricDeltaMs / (rate > 0 ? rate : 1)
}
