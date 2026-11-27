import type { LyricsDocument } from '../types'

/**
 * What a language switch can do for one song.
 *
 * The switches are one setting for all songs, but most of them have nothing to
 * act on in a given song: its own language is always shown, and a translation
 * exists only where a source had one (in the library of 2026-11-27 no song
 * out of 283 had English, so switching English on changed nothing on screen).
 */
export type LanguageAvailability =
  /** A translation or reading in this language: the switch shows and hides it. */
  | 'switchable'
  /** The language the song is in: shown whatever the switch says. */
  | 'original'
  /** The song has no lyrics in this language. */
  | 'missing'
  /** No song, or readings that are still being made: nothing to say yet. */
  | 'unknown'

export function languageAvailability(document: LyricsDocument | null | undefined, code: string): LanguageAvailability {
  if (!document || document.untimedOriginal || !document.tracks.length) return 'unknown'
  const inLanguage = document.tracks.filter(track => track.language === code && track.lines.some(line => line.text.trim()))
  if (inLanguage.some(track => track.kind !== 'original')) return 'switchable'
  if (inLanguage.length) return 'original'
  // Romaji is generated a moment after a Japanese song's lyrics arrive.
  if (code === 'romaji' && document.tracks.some(track => track.kind === 'original' && track.language === 'ja')) return 'unknown'
  return 'missing'
}
