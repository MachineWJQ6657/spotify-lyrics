import { afterEach, describe, expect, it, vi } from 'vitest'
import { foldName, mergeSongHits, searchSongs, type LrcLibEntry, type NeteaseEntry } from './song-search'

const lrc = (id: number, trackName: string, artistName: string, duration: number, extra: Partial<LrcLibEntry> = {}): LrcLibEntry =>
  ({ id, trackName, artistName, albumName: 'Album', duration, instrumental: false, syncedLyrics: null, plainLyrics: null, ...extra })
const net = (id: number, name: string, artists: string[], duration: number, album = 'Album'): NeteaseEntry =>
  ({ id, name, duration, artists: artists.map(artist => ({ name: artist })), album: { name: album } })

describe('one list of songs from two catalogues', () => {
  it('folds case, width, spaces and punctuation', () => {
    expect(foldName('ＹＯＡＳＯＢＩ')).toBe('yoasobi')
    expect(foldName('Blinding  Lights!')).toBe('blindinglights')
    expect(foldName('夜に駆ける')).toBe('夜に駆ける')
  })

  it('merges the same recording listed by both, and LRCLIB duplicates of it', () => {
    const hits = mergeSongHits('夜に駆ける', [
      lrc(11, '夜に駆ける', 'YOASOBI', 261.2, { syncedLyrics: '[00:01.00]沈むように' }),
      lrc(12, '夜に駆ける', 'YOASOBI', 261.9, { albumName: 'THE BOOK' }),
      lrc(13, '夜に駆ける', 'yoasobi', 260.4)
    ], [net(901, '夜に駆ける', ['YOASOBI'], 261_000)])
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ name: '夜に駆ける', artist: 'YOASOBI', sources: ['netease', 'lrclib'], durationMs: 261_000, syncedLyrics: '[00:01.00]沈むように' })
  })

  it('keeps another cut of the song (a different length) as its own entry', () => {
    const hits = mergeSongHits('夜に駆ける', [lrc(11, '夜に駆ける', 'YOASOBI', 261), lrc(14, '夜に駆ける', 'YOASOBI', 285)], [])
    expect(hits.map(hit => hit.durationMs)).toEqual([261_000, 285_000])
  })

  it('matches "A, B" and "A feat. B" to the first performer', () => {
    const hits = mergeSongHits('stay', [lrc(21, 'STAY', 'The Kid LAROI feat. Justin Bieber', 141.8)], [net(902, 'STAY', ['The Kid LAROI', 'Justin Bieber'], 141_000)])
    expect(hits).toHaveLength(1)
    expect(hits[0].artist).toBe('The Kid LAROI, Justin Bieber')
  })

  it('puts the song whose title is the query before songs that only mention it', () => {
    const hits = mergeSongHits('晴天', [], [
      net(1, '晴天娃娃', ['某人'], 200_000), net(2, '晴天', ['周杰伦'], 269_000), net(3, '不是晴天', ['另一人'], 210_000)
    ])
    expect(hits[0]).toMatchObject({ name: '晴天', artist: '周杰伦' })
  })

  it('finds a song by title and performer typed together', () => {
    const hits = mergeSongHits('yoasobi 群青', [], [net(1, '群青', ['神山羊'], 240_000), net(2, '群青', ['YOASOBI'], 248_000)])
    expect(hits[0].artist).toBe('YOASOBI')
  })

  it('drops entries without a title and marks an instrumental', () => {
    const hits = mergeSongHits('x', [lrc(31, '', 'Nobody', 100), lrc(32, 'Interlude', 'Band', 61, { instrumental: true })], [])
    expect(hits).toHaveLength(1)
    expect(hits[0].instrumental).toBe(true)
  })
})

describe('asking the catalogues', () => {
  afterEach(() => vi.unstubAllGlobals())
  const respond = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer, body: null }) as unknown as Response

  it('returns nothing for an empty query without asking anyone', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await searchSongs('   ')).toEqual({ hits: [], failed: [] })
    expect(await searchSongs(42)).toEqual({ hits: [], failed: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still answers when one catalogue is down, and says which', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('lrclib')
      ? respond([], false)
      : respond({ result: { songs: [net(5, '群青', ['YOASOBI'], 248_000)] } })))
    const result = await searchSongs('群青')
    expect(result.failed).toEqual(['lrclib'])
    expect(result.hits.map(hit => hit.name)).toEqual(['群青'])
  })

  it('fails only when neither catalogue answered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(null, false)))
    await expect(searchSongs('群青')).rejects.toThrow('歌曲搜索暂时不可用')
  })
})
