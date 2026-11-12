import type { LyricLine, LyricTrack, LyricsDocument } from '../types'
import { lyricTimingKey } from './lyric-timing-key'

/** The lines a listening measurement is made against (blank rows excluded). */
export function listenLines(lines: Pick<LyricLine, 'text' | 'startMs'>[]) {
  return lines.filter(line => line.text.trim()).map(line => ({ text: line.text, startMs: line.startMs }))
}

const keys = new WeakMap<LyricTrack, string>()
/** Memoized per immutable track: the overlay asks on every clock tick. */
export function listenTimingKey(original: LyricTrack) {
  let key = keys.get(original)
  if (key === undefined) { key = lyricTimingKey(listenLines(original.lines)); keys.set(original, key) }
  return key
}

/** Listened offset that applies to this document's current original timing, else 0. */
export function listenedLyricsOffset(document: LyricsDocument | null | undefined) {
  const listened = document?.listenedOffset
  if (!document || !listened || listened.state !== 'decided' || !listened.offsetMs || document.untimedOriginal) return 0
  const original = document.tracks.find(track => track.kind === 'original')
  return original && listenTimingKey(original) === listened.timingKey ? listened.offsetMs : 0
}

/** A manual per-song offset wins; otherwise a matching listened offset; otherwise the fallback. */
export function displayLyricsOffset(document: LyricsDocument | null | undefined, fallbackMs: number, listenEnabled = true) {
  if (document?.offsetMs) return document.offsetMs
  const listened = listenEnabled ? listenedLyricsOffset(document) : 0
  if (listened) return listened
  return document?.offsetMs ?? fallbackMs
}
