import type { LyricsDocument, LyricsSourceId } from '../types'

/** Providers offered in the source menu, in the order they are listed. */
export const LYRICS_SOURCES: ReadonlyArray<{ id: LyricsSourceId; label: string; prefix: string }> = [
  { id: 'lrclib', label: 'LRCLIB', prefix: 'LRCLIB' },
  { id: 'netease', label: '网易云音乐', prefix: '网易云音乐' },
  { id: 'kugou', label: '酷狗音乐', prefix: '酷狗音乐' },
  { id: 'spotify', label: 'Spotify', prefix: 'Spotify' }
]

/** Which provider a track's `source` label came from (labels may carry suffixes such as "· 搜索候选"). */
export function lyricsSourceIdOf(source: string | undefined): LyricsSourceId | undefined {
  return source ? LYRICS_SOURCES.find(item => source.startsWith(item.prefix))?.id : undefined
}

export interface SourceOption {
  id: LyricsSourceId
  label: string
  /** Timed lines this provider has for the song; undefined when not looked up yet. */
  lines?: number
  /** False only when a lookup showed the provider has no timed lyrics for this song. */
  available: boolean
  /** The user's saved choice. */
  chosen: boolean
  /** The provider whose timeline is on screen now. */
  inUse: boolean
}

/**
 * Rows of the source menu for one song. Spotify is listed only when it actually
 * returned timed lyrics (it needs the optional Web API connection); the three
 * community providers are always listed, disabled once known to have nothing.
 */
export function sourceOptions(document: LyricsDocument | null): SourceOption[] {
  const known = document?.availableSources
  const original = document?.untimedOriginal ? undefined : document?.tracks.find(track => track.kind === 'original')
  const inUse = lyricsSourceIdOf(original?.source)
  return LYRICS_SOURCES.flatMap(item => {
    const found = known?.find(entry => entry.id === item.id)
    if (item.id === 'spotify' && !found && document?.sourcePreference !== 'spotify') return []
    return [{ id: item.id, label: item.label, lines: found?.lines, available: known ? Boolean(found) : true,
      chosen: document?.sourcePreference === item.id, inUse: inUse === item.id }]
  })
}

/** Order in which listening tries other providers after one proved inconsistent. */
const TRIAL_ORDER: readonly LyricsSourceId[] = ['netease', 'lrclib', 'kugou', 'spotify']

/**
 * The next provider listening calibration should try for this song: one that
 * has timed lyrics, is not on screen now and has no verdict yet. Undefined
 * when every available source has been tried.
 */
export function nextSourceToTry(document: LyricsDocument | null): LyricsSourceId | undefined {
  if (!document?.availableSources?.length) return undefined
  const original = document.untimedOriginal ? undefined : document.tracks.find(track => track.kind === 'original')
  const current = lyricsSourceIdOf(original?.source)
  const available = new Set(document.availableSources.map(item => item.id))
  return TRIAL_ORDER.find(id => available.has(id) && id !== current && !document.sourceTrials?.[id])
}
