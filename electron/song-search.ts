import { fetchWithTimeout } from './lyrics-provider'
import { t } from '../src/lib/i18n'

/**
 * Finding a song by what the user types, without anything playing: the two
 * public catalogues the lyric lookup already asks (LRCLIB and NetEase) are
 * searched with the free text, and their entries are merged into one list of
 * songs. Opening a hit runs the normal lyric lookup with its metadata, so the
 * lyrics, translation and romaji are the ones playback would show.
 */
export type SongCatalogue = 'lrclib' | 'netease'

export interface SongHit {
  /** Stable within one result list; also the reader's cache key. */
  key: string
  name: string
  artist: string
  album: string
  durationMs: number
  /** The catalogues that list this song. */
  sources: SongCatalogue[]
  instrumental?: boolean
  /** LRCLIB's own lyrics of the entry: shown when the full lookup finds nothing. */
  syncedLyrics?: string | null
  plainLyrics?: string | null
}

export interface SongSearchResult { hits: SongHit[]; failed: SongCatalogue[] }

export interface LrcLibEntry {
  id: number; trackName?: string; artistName?: string; albumName?: string; duration?: number
  instrumental?: boolean; syncedLyrics?: string | null; plainLyrics?: string | null
}
export interface NeteaseEntry {
  id: number; name?: string; duration?: number; dt?: number
  artists?: Array<{ name?: string }>; ar?: Array<{ name?: string }>
  album?: { name?: string }; al?: { name?: string }
}

const LRCLIB_API = 'https://lrclib.net/api'
const NETEASE_API = 'https://music.163.com/api'
const headers = { 'User-Agent': 'Syllable/0.4.19 (desktop lyrics client)' }

/** Case, width, spacing and punctuation do not tell two spellings of a name apart. */
export const foldName = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

/** "A, B" / "A feat. B" / "A & B" are the same performer entry as "A" when matching catalogues. */
const primaryArtistOf = (value: string) => value.split(/\s*(?:,|、|;|\/|／|&|＆|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0] || value

/** Two entries of one recording differ by a second or two between catalogues. */
const SAME_RECORDING_MS = 3000
const MAX_HITS = 40

interface Draft extends SongHit { rank: number; foldedName: string }

/**
 * One list from both catalogues: entries with the same title, first performer
 * and length (within 3 s) are one song. LRCLIB alone often lists a song five
 * times (per album and uploader); a live cut or a remix has another length or
 * title and stays separate. Ordered by how well the title answers the query,
 * then by the catalogues' own order.
 */
export function mergeSongHits(query: string, lrclib: readonly LrcLibEntry[], netease: readonly NeteaseEntry[]): SongHit[] {
  const drafts: Draft[] = []
  const add = (entry: { name: string; artist: string; album: string; durationMs: number; source: SongCatalogue; rank: number
    instrumental?: boolean; syncedLyrics?: string | null; plainLyrics?: string | null; id: number }) => {
    const name = entry.name.trim()
    if (!name) return
    const foldedName = foldName(name)
    const foldedArtist = foldName(primaryArtistOf(entry.artist))
    const same = drafts.find(item => item.foldedName === foldedName && foldName(primaryArtistOf(item.artist)) === foldedArtist
      && (!item.durationMs || !entry.durationMs || Math.abs(item.durationMs - entry.durationMs) <= SAME_RECORDING_MS))
    if (!same) {
      drafts.push({ key: `${entry.source}-${entry.id}`, name, artist: entry.artist.trim(), album: entry.album.trim(), durationMs: entry.durationMs,
        sources: [entry.source], rank: entry.rank, foldedName,
        ...(entry.instrumental ? { instrumental: true } : {}),
        ...(entry.syncedLyrics ? { syncedLyrics: entry.syncedLyrics } : {}), ...(entry.plainLyrics ? { plainLyrics: entry.plainLyrics } : {}) })
      return
    }
    if (!same.sources.includes(entry.source)) same.sources.push(entry.source)
    same.rank = Math.min(same.rank, entry.rank)
    if (!same.durationMs) same.durationMs = entry.durationMs
    if (!same.album) same.album = entry.album.trim()
    // Keep the entry's own lyrics when one of the merged entries has them (timed before plain).
    if (!same.syncedLyrics && entry.syncedLyrics) { same.syncedLyrics = entry.syncedLyrics; delete same.instrumental }
    if (!same.plainLyrics && entry.plainLyrics) same.plainLyrics = entry.plainLyrics
  }
  // NetEase first: its names carry the native script and its order is by popularity.
  netease.forEach((song, rank) => add({ id: song.id, source: 'netease', rank, name: song.name ?? '',
    artist: (song.artists ?? song.ar ?? []).map(artist => artist.name ?? '').filter(Boolean).join(', '),
    album: (song.album ?? song.al)?.name ?? '', durationMs: Math.round(song.duration ?? song.dt ?? 0) }))
  lrclib.forEach((record, rank) => add({ id: record.id, source: 'lrclib', rank, name: record.trackName ?? '', artist: record.artistName ?? '',
    album: record.albumName ?? '', durationMs: Math.round((record.duration ?? 0) * 1000), instrumental: Boolean(record.instrumental),
    syncedLyrics: record.syncedLyrics, plainLyrics: record.plainLyrics }))

  const foldedQuery = foldName(query)
  const words = query.normalize('NFKC').toLowerCase().split(/\s+/).map(foldName).filter(Boolean)
  const score = (hit: Draft) => {
    const everything = hit.foldedName + foldName(hit.artist)
    let value = 60 - Math.min(20, hit.rank) * 3
    if (hit.sources.length > 1) value += 20
    if (hit.foldedName === foldedQuery) value += 40
    else if (words.length > 0 && words.every(word => everything.includes(word))) value += 25
    else if (foldedQuery && (hit.foldedName.includes(foldedQuery) || foldedQuery.includes(hit.foldedName))) value += 10
    if (hit.syncedLyrics) value += 6
    if (hit.instrumental) value -= 30
    return value
  }
  return drafts.map((hit, index) => ({ hit, index, value: score(hit) }))
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .slice(0, MAX_HITS)
    .map(({ hit }) => {
      const { rank: _rank, foldedName: _folded, ...rest } = hit
      return rest
    })
}

async function searchLrcLib(query: string, signal?: AbortSignal): Promise<LrcLibEntry[]> {
  const response = await fetchWithTimeout(`${LRCLIB_API}/search?${new URLSearchParams({ q: query })}`, { headers }, 7000, 1, signal)
  if (!response.ok) throw new Error(`LRCLIB ${response.status}`)
  const payload = await response.json() as unknown
  return Array.isArray(payload) ? payload as LrcLibEntry[] : []
}

async function searchNetease(query: string, signal?: AbortSignal): Promise<NeteaseEntry[]> {
  const form = new URLSearchParams({ s: query, type: '1', limit: '30', offset: '0' })
  const response = await fetchWithTimeout(`${NETEASE_API}/search/get`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' }, body: form
  }, 6000, 1, signal)
  if (!response.ok) throw new Error(`NetEase ${response.status}`)
  const payload = await response.json() as { result?: { songs?: NeteaseEntry[] } }
  return Array.isArray(payload.result?.songs) ? payload.result.songs : []
}

/** Songs matching free text (a title, a performer, or both). Throws only when neither catalogue answered. */
export async function searchSongs(text: unknown, signal?: AbortSignal): Promise<SongSearchResult> {
  const query = typeof text === 'string' ? text.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  if (!query) return { hits: [], failed: [] }
  const [lrclib, netease] = await Promise.allSettled([searchLrcLib(query, signal), searchNetease(query, signal)])
  const failed: SongCatalogue[] = [...(lrclib.status === 'rejected' ? ['lrclib' as const] : []), ...(netease.status === 'rejected' ? ['netease' as const] : [])]
  if (failed.length === 2) throw new Error(t('歌曲搜索暂时不可用'))
  return { hits: mergeSongHits(query, lrclib.status === 'fulfilled' ? lrclib.value : [], netease.status === 'fulfilled' ? netease.value : []), failed }
}
