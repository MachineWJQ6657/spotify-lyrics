import type { LyricsDocument, TrackInfo } from '../types'
import { detectLyricsLanguage, makeTrack } from './lyrics'

/** A song found by the search page (see electron/song-search.ts). */
export interface SongHit {
  key: string
  name: string
  artist: string
  album: string
  durationMs: number
  sources: Array<'lrclib' | 'netease'>
  instrumental?: boolean
  syncedLyrics?: string | null
  plainLyrics?: string | null
}

/** What the lyric lookup answers (the part the reader uses). */
export interface ReadLookup {
  syncedLyrics: string | null
  plainLyrics: string | null
  source: string
  instrumental?: boolean
  transient?: boolean
  additionalTracks?: Array<{ language: string; label: string; kind: 'translation' | 'romanization'; syncedLyrics: string; source: string }>
}

/** The metadata the lyric lookup is given for a found song. The id never equals a played track's. */
export const hitTrack = (hit: SongHit): TrackInfo =>
  ({ id: `browse:${hit.key}`, name: hit.name, artist: hit.artist, album: hit.album, coverUrl: '', durationMs: hit.durationMs })

const originalLabel = (language: string) =>
  language === 'ja' ? '日本語' : language === 'ko' ? '한국어' : language === 'zh-Hans' ? '中文原文' : language === 'en' ? 'English' : 'Original' // i18n-ignore: track labels stored in the document (shown through localizeLabel)

/**
 * The lyrics to read for a found song: the lookup's answer (the same original,
 * translation and romaji playback would show); failing that, the catalogue
 * entry's own lyrics. null when there is nothing to show.
 */
export function readingDocument(hit: SongHit, lookup: ReadLookup | null, now = Date.now()): LyricsDocument | null {
  const track = hitTrack(hit)
  const base = { trackId: track.id, track, updatedAt: now }
  const timed = (lrc: string, source: string, extras: ReadLookup['additionalTracks'] = []): LyricsDocument | null => {
    const language = detectLyricsLanguage(lrc)
    const original = makeTrack(`${track.id}-original`, language, originalLabel(language), 'original', lrc, source)
    if (!original.lines.length) return null
    return { ...base, tracks: [original, ...extras.map((item, index) =>
      makeTrack(`${track.id}-${item.language}-${index}`, item.language, item.label, item.kind, item.syncedLyrics, item.source)).filter(item => item.lines.length)] }
  }
  const fromLookup = lookup?.syncedLyrics ? timed(lookup.syncedLyrics, lookup.source, lookup.additionalTracks) : null
  if (fromLookup) return fromLookup
  const fromEntry = hit.syncedLyrics ? timed(hit.syncedLyrics, 'LRCLIB') : null
  if (fromEntry) return fromEntry
  const lookupText = lookup?.plainLyrics?.trim()
  const text = lookupText || hit.plainLyrics?.trim()
  if (text) return { ...base, tracks: [], untimedOriginal: { text, language: detectLyricsLanguage(text), source: lookupText ? lookup!.source : 'LRCLIB' } }
  if ((lookup?.instrumental && !lookup.transient) || (!lookup && hit.instrumental)) return { ...base, tracks: [], instrumental: true }
  return null
}

/** A saved song that can be opened for reading: it has at least one row, timed or not. */
export const hasReadableLyrics = (document: Pick<LyricsDocument, 'tracks' | 'untimedOriginal'>) =>
  document.tracks.some(track => track.lines.length > 0) || Boolean(document.untimedOriginal?.text.trim())

/** The words of a document as plain text, one row per line (what "复制歌词" copies). */
export function documentPlainText(document: LyricsDocument | null): string {
  if (!document) return ''
  if (document.untimedOriginal) return document.untimedOriginal.text.trim()
  const original = document.tracks.find(track => track.kind === 'original') ?? document.tracks[0]
  return original ? original.lines.map(line => line.text.trim()).filter(Boolean).join('\n') : ''
}

/** "3:41" for a known length, '' otherwise. */
export const hitDuration = (durationMs: number) => {
  if (!(durationMs > 0)) return ''
  const seconds = Math.round(durationMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
