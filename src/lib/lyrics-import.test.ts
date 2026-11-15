import { describe, expect, it } from 'vitest'
import type { LyricsDocument, TrackInfo } from '../types'
import { decodeLyricFile, importLyricFiles, importMessage } from './lyrics-import'
import { mergeLibraryBackup } from './library-backup'
import { retimeLines, visibleTracks } from './lyrics'
import { mergeUserEditedTracks } from '../hooks/usePlayback'

// Regressions from the eighth review (0.4.73). Synthetic text only.

const song = { id: 'song', name: 'Song', artist: 'Artist', album: '', coverUrl: '', durationMs: 200_000 } as TrackInfo
const english: LyricsDocument = { trackId: 'song', track: song, updatedAt: 1, tracks: [
  { id: 'song-original', language: 'en', label: 'English', kind: 'original', source: 'LRCLIB · 精确匹配', lines: [{ startMs: 1000, text: 'the wrold is wide' }, { startMs: 5000, text: 'second line' }] },
  { id: 'song-zh', language: 'zh-Hans', label: '中文', kind: 'translation', source: '网易云音乐 · 翻译', lines: [{ startMs: 1000, text: '世界很大' }] }
] }

describe('importing lyric files', () => {
  it('takes a file in the song\'s own language as its original', () => {
    // Exported from the editor as "<title>.en.lrc", corrected, dropped back.
    const result = importLyricFiles(english, song, [{ name: 'Song.en.lrc', text: '[00:01.00]the world is wide\n[00:05.00]second line' }], 100)
    const original = result.document!.tracks.filter(track => track.kind === 'original')
    expect(original).toHaveLength(1)
    expect(original[0].lines[0].text).toBe('the world is wide')
    expect(original[0].id).toBe('local-100-0')
    // The translation stays, the provider's original is replaced, the file is the user's.
    expect(result.document!.tracks.map(track => track.kind).sort()).toEqual(['original', 'translation'])
    expect(result.document!.userEditedTrackIds).toEqual(['local-100-0'])
  })

  it('keeps a file in another language as a translation', () => {
    const result = importLyricFiles(english, song, [{ name: 'Song.zh.lrc', text: '[00:01.00]世界如此广阔' }], 100)
    expect(result.document!.tracks.find(track => track.kind === 'original')?.id).toBe('song-original')
    expect(result.document!.tracks.filter(track => track.language === 'zh-Hans').map(track => track.lines[0].text)).toEqual(['世界如此广阔'])
  })

  it('does not import a file without a timed line', () => {
    const result = importLyricFiles(english, song, [{ name: 'Song.en.txt', text: 'the world is wide\nsecond line' }], 100)
    expect(result.document).toBeNull()
    expect(result.skipped).toEqual(['Song.en.txt'])
    expect(importMessage(result)).toContain('没有导入')
    // One good file and one without stamps: the good one is imported, the other reported.
    const mixed = importLyricFiles(english, song, [{ name: 'Song.zh.lrc', text: '[00:01.00]世界如此广阔' }, { name: 'notes.txt', text: 'no stamps here' }], 100)
    expect(mixed.imported).toHaveLength(1)
    expect(mixed.document!.tracks.find(track => track.kind === 'original')?.id).toBe('song-original')
    expect(importMessage(mixed)).toBe('已导入 1 条歌词轨道，1 个文件没有时间轴，未导入')
  })

  it('makes an unsuffixed file the original of a song that has no timed lyrics', () => {
    const untimed: LyricsDocument = { trackId: 'song', track: song, tracks: [], untimedOriginal: { text: '夜の街を歩いていた', source: 'Spotify · Musixmatch', language: 'ja' } }
    const result = importLyricFiles(untimed, song, [{ name: 'song.lrc', text: '[00:01.00]夜の街を歩いていた\n[00:05.00]君の声が聞こえた' }], 100)
    const [track] = result.document!.tracks
    expect([track.kind, track.language]).toEqual(['original', 'ja'])
    expect(result.document!.untimedOriginal).toBeUndefined()
    expect(visibleTracks(result.document, ['ja'], false)).toHaveLength(1)
    // With a timed original already there, an unsuffixed file stays a custom translation.
    const extra = importLyricFiles(english, song, [{ name: 'song.lrc', text: '[00:01.00]another wording' }], 100)
    expect(extra.imported[0].kind).toBe('translation')
    expect(extra.document!.tracks.find(track => track.kind === 'original')?.id).toBe('song-original')
  })

  it('adds a second file to the scratch document when nothing is playing', () => {
    const first = importLyricFiles(null, undefined, [{ name: 'a.ja.lrc', text: '[00:01.00]夜の街' }], 100)
    const second = importLyricFiles(first.document, undefined, [{ name: 'a.zh.lrc', text: '[00:01.00]夜晚的街道' }], 200)
    expect(second.document!.trackId).toBe('local')
    expect(second.document!.tracks.map(track => track.language)).toEqual(['ja', 'zh-Hans'])
  })
})

describe('reading lyric files in other encodings', () => {
  const lrc = '[00:01.00]夜の街を歩いていた'
  it('reads UTF-8 with and without a byte-order mark', () => {
    const bytes = new TextEncoder().encode(lrc)
    expect(decodeLyricFile(bytes.buffer)).toBe(lrc)
    expect(decodeLyricFile(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]).buffer)).toBe(lrc)
  })

  it('reads UTF-16 with a byte-order mark', () => {
    const units = [...lrc].flatMap(char => { const code = char.charCodeAt(0); return [code & 0xff, code >> 8] })
    expect(decodeLyricFile(new Uint8Array([0xff, 0xfe, ...units]).buffer)).toBe(lrc)
  })

  it('reads GBK and Shift_JIS files', () => {
    // "[00:01.00]我的世界" in GBK, "[00:01.00]よるのまち" in Shift_JIS.
    const stamp = [...'[00:01.00]'].map(char => char.charCodeAt(0))
    expect(decodeLyricFile(new Uint8Array([...stamp, 0xce, 0xd2, 0xb5, 0xc4, 0xca, 0xc0, 0xbd, 0xe7]).buffer)).toBe('[00:01.00]我的世界')
    expect(decodeLyricFile(new Uint8Array([...stamp, 0x82, 0xe6, 0x82, 0xe9, 0x82, 0xcc, 0x82, 0xdc, 0x82, 0xbf]).buffer)).toBe('[00:01.00]よるのまち')
  })
})

describe('user-owned tracks and lookups', () => {
  it('an empty user-owned original no longer displaces the provider\'s lyrics', () => {
    const baseline: LyricsDocument = { trackId: 'song', tracks: [{ id: 'local-1-0', language: 'ja', label: '日本語', kind: 'original', source: 'song.ja.txt', lines: [] }], userEditedTrackIds: ['local-1-0'] }
    const provider = [{ id: 'song-original', language: 'ja', label: '日本語', kind: 'original' as const, source: 'LRCLIB', lines: [{ startMs: 1000, text: '歌詞' }] }]
    expect(mergeUserEditedTracks(provider, baseline).map(track => track.id)).toEqual(['song-original'])
  })

  it('a custom-language track is shown without a language switch', () => {
    const document: LyricsDocument = { trackId: 'song', tracks: [...english.tracks, { id: 'translation-1', language: 'custom-1', label: '自定义翻译', kind: 'translation', source: '本地编辑', lines: [{ startMs: 1000, text: 'mine' }] }] }
    expect(visibleTracks(document, [], false).map(track => track.id)).toEqual(['song-original', 'translation-1'])
  })

  it('word timings move with a shifted line', () => {
    const [line] = retimeLines([{ startMs: 1000, text: 'a b', words: [{ text: 'a ', startMs: 1000 }, { text: 'b', startMs: 1500 }] }], 250)
    expect(line.words).toEqual([{ text: 'a ', startMs: 1250 }, { text: 'b', startMs: 1750 }])
  })
})

describe('restoring a backup', () => {
  const doc = (updatedAt: number, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({ ...english, updatedAt, ...extra })
  it('prefers the copy with the user\'s own lyrics over a newer automatic one', () => {
    // After a reinstall the song was looked up again; the backup holds the edited lyrics.
    const merged = mergeLibraryBackup({ song: doc(900) }, [doc(100, { userEditedTrackIds: ['song-original'] })])
    expect(merged.updated).toBe(1)
    expect(merged.library.song.userEditedTrackIds).toEqual(['song-original'])
  })

  it('prefers a copy with a manual offset over one without, and the newer of two equals', () => {
    expect(mergeLibraryBackup({ song: doc(900) }, [doc(100, { offsetMs: 300 })]).library.song.offsetMs).toBe(300)
    expect(mergeLibraryBackup({ song: doc(900, { userEditedTrackIds: ['song-original'] }) }, [doc(100, { offsetMs: 300 })]).kept).toBe(1)
    expect(mergeLibraryBackup({ song: doc(900, { offsetMs: 100 }) }, [doc(950, { offsetMs: 300 })]).library.song.offsetMs).toBe(300)
    expect(mergeLibraryBackup({ song: doc(900, { offsetMs: 100 }) }, [doc(100, { offsetMs: 300 })]).library.song.offsetMs).toBe(100)
  })
})
