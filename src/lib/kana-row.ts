import type { LyricsDocument, LyricTrack } from '../types'

/**
 * The kana row: a Japanese lyric line as it is written in kana, shown under
 * the line like romaji. It is made from the original each time a song is shown
 * (the main process analyses the lines, see electron/romanizer.ts) and is not
 * part of the saved document: nothing to migrate, nothing a lookup can lose.
 */
export const KANA_LANGUAGE = 'kana'

/** The Japanese original a kana row can be made for, when the listener asked for one. */
export function kanaSource(document: LyricsDocument | null | undefined, enabled: readonly string[]): LyricTrack | undefined {
  if (!document || document.untimedOriginal || !enabled.includes(KANA_LANGUAGE)) return undefined
  const original = document.tracks.find(track => track.kind === 'original')
  return original?.language === 'ja' && original.lines.length ? original : undefined
}

/** What the analysis is asked for: exactly the texts a romaji request sends, so both are answered by one analysis. */
export const kanaRequest = (original: LyricTrack) => original.lines.map(line => line.text)

const compact = (text: string) => text.replace(/\s+/g, '')

/**
 * The row for each line of the original, on the original's own times. A line
 * that reads the same in kana (no kanji in it) gets no row: it would only
 * repeat the line above it. Null when no line of the song differs.
 */
export function kanaTrack(original: LyricTrack, readings: readonly string[]): LyricTrack | null {
  if (readings.length !== original.lines.length) return null
  const lines = original.lines.map((line, index) => {
    const reading = (readings[index] ?? '').replace(/\s+/g, ' ').trim()
    return { startMs: line.startMs, endMs: line.endMs, text: reading && compact(reading) !== compact(line.text) ? reading : '' }
  })
  if (!lines.some(line => line.text)) return null
  return { id: `${original.id}-kana`, language: KANA_LANGUAGE, label: 'かな', kind: 'kana', source: 'Kuromoji', lines } // i18n-ignore: a track label in its own script
}

/** The document as it is shown: with the kana row next to the tracks it has. */
export function withKanaTrack(document: LyricsDocument, track: LyricTrack): LyricsDocument {
  return { ...document, tracks: [...document.tracks.filter(item => item.kind !== 'kana'), track] }
}
