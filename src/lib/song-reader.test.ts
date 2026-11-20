import { describe, expect, it } from 'vitest'
import { documentPlainText, hitDuration, hitTrack, readingDocument, type SongHit } from './song-reader'

const hit = (extra: Partial<SongHit> = {}): SongHit =>
  ({ key: 'netease-1', name: '群青', artist: 'YOASOBI', album: 'THE BOOK', durationMs: 248_000, sources: ['netease'], ...extra })
const LRC = '[00:10.00]嗚呼、いつもの様に\n[00:14.00]過ぎる日々にあくびが出る'
const ZH = '[00:10.00]啊 一如往常地\n[00:14.00]对流逝的日子打起哈欠'

describe('the lyrics shown for a found song', () => {
  it('gives the lookup a track that can never be mistaken for a played one', () => {
    expect(hitTrack(hit())).toEqual({ id: 'browse:netease-1', name: '群青', artist: 'YOASOBI', album: 'THE BOOK', coverUrl: '', durationMs: 248_000 })
  })

  it('uses the lookup: original plus its translation', () => {
    const document = readingDocument(hit(), { syncedLyrics: LRC, plainLyrics: null, source: '网易云音乐',
      additionalTracks: [{ language: 'zh-Hans', label: '中文', kind: 'translation', syncedLyrics: ZH, source: '网易云音乐' }] }, 1)
    expect(document?.tracks.map(track => [track.kind, track.language, track.lines.length])).toEqual([['original', 'ja', 2], ['translation', 'zh-Hans', 2]])
    expect(document?.trackId).toBe('browse:netease-1')
    expect(document?.tracks[0].source).toBe('网易云音乐')
  })

  it("falls back to the catalogue entry's own timed lyrics when the lookup found none", () => {
    const document = readingDocument(hit({ key: 'lrclib-9', sources: ['lrclib'], syncedLyrics: LRC }), null, 1)
    expect(document?.tracks).toHaveLength(1)
    expect(document?.tracks[0].source).toBe('LRCLIB')
  })

  it('shows plain words when nobody has timed ones', () => {
    const document = readingDocument(hit({ plainLyrics: '一行\n两行' }), { syncedLyrics: null, plainLyrics: null, source: 'LRCLIB' }, 1)
    expect(document?.tracks).toEqual([])
    expect(document?.untimedOriginal).toEqual({ text: '一行\n两行', language: 'zh-Hans', source: 'LRCLIB' })
  })

  it('ignores a "timed" file without a single timed row', () => {
    expect(readingDocument(hit({ syncedLyrics: 'no timestamps here' }), null, 1)).toBeNull()
  })

  it('reports an instrumental, but not on an unfinished lookup', () => {
    expect(readingDocument(hit(), { syncedLyrics: null, plainLyrics: null, source: 'LRCLIB', instrumental: true }, 1)?.instrumental).toBe(true)
    expect(readingDocument(hit(), { syncedLyrics: null, plainLyrics: null, source: 'LRCLIB', instrumental: true, transient: true }, 1)).toBeNull()
  })

  it('has nothing to show when neither has lyrics', () => {
    expect(readingDocument(hit(), { syncedLyrics: null, plainLyrics: '  ', source: 'none' }, 1)).toBeNull()
    expect(readingDocument(hit(), null, 1)).toBeNull()
  })
})

describe('copying and labels', () => {
  it('copies the original rows as plain text', () => {
    const document = readingDocument(hit(), { syncedLyrics: LRC, plainLyrics: null, source: 'x' }, 1)
    expect(documentPlainText(document)).toBe('嗚呼、いつもの様に\n過ぎる日々にあくびが出る')
    expect(documentPlainText(readingDocument(hit({ plainLyrics: 'a\nb' }), null, 1))).toBe('a\nb')
    expect(documentPlainText(null)).toBe('')
  })

  it('formats a length, and leaves an unknown one out', () => {
    expect(hitDuration(248_000)).toBe('4:08')
    expect(hitDuration(59_600)).toBe('1:00')
    expect(hitDuration(0)).toBe('')
  })
})

describe('which saved songs can be opened for reading', () => {
  it('needs at least one row, timed or plain', async () => {
    const { hasReadableLyrics } = await import('./song-reader')
    const track = (lines: Array<{ startMs: number; text: string }>) => ({ id: 't', language: 'en', label: 'English', kind: 'original' as const, source: 'x', lines })
    expect(hasReadableLyrics({ tracks: [track([{ startMs: 0, text: 'a' }])] })).toBe(true)
    expect(hasReadableLyrics({ tracks: [track([])] })).toBe(false)
    expect(hasReadableLyrics({ tracks: [] })).toBe(false)
    expect(hasReadableLyrics({ tracks: [], untimedOriginal: { text: 'words', language: 'en', source: 'x' } })).toBe(true)
    expect(hasReadableLyrics({ tracks: [], untimedOriginal: { text: '  ', language: 'en', source: 'x' } })).toBe(false)
  })
})
