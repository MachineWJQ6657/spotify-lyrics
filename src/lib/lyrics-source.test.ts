import { describe, expect, it } from 'vitest'
import type { LyricsDocument } from '../types'
import { lyricsSourceIdOf, sourceOptions } from './lyrics-source'

const document = (source: string, extra: Partial<LyricsDocument> = {}): LyricsDocument => ({
  trackId: 't', tracks: [{ id: 'o', language: 'ja', label: '日本語', kind: 'original', source, lines: [{ startMs: 1, text: 'a' }] }], ...extra })

describe('lyrics source menu', () => {
  it('recognizes providers from decorated source labels', () => {
    expect(lyricsSourceIdOf('LRCLIB · 元数据匹配')).toBe('lrclib')
    expect(lyricsSourceIdOf('网易云音乐 · 搜索候选 + 酷狗音乐 补全')).toBe('netease')
    expect(lyricsSourceIdOf('酷狗音乐 · 搜索候选')).toBe('kugou')
    expect(lyricsSourceIdOf('Spotify · Musixmatch')).toBe('spotify')
    expect(lyricsSourceIdOf('song.zh.lrc')).toBeUndefined()
    expect(lyricsSourceIdOf(undefined)).toBeUndefined()
  })

  it('lists the community providers before a lookup, without Spotify', () => {
    const options = sourceOptions(document('LRCLIB · 元数据匹配'))
    expect(options.map(option => option.id)).toEqual(['lrclib', 'netease', 'kugou'])
    expect(options.every(option => option.available)).toBe(true)
    expect(options.find(option => option.inUse)?.id).toBe('lrclib')
    expect(options.some(option => option.chosen)).toBe(false)
  })

  it('shows line counts, disables providers known to have nothing, and marks the choice', () => {
    const options = sourceOptions(document('网易云音乐 · 搜索候选', { sourcePreference: 'netease',
      availableSources: [{ id: 'lrclib', lines: 41 }, { id: 'netease', lines: 44 }, { id: 'spotify', lines: 40 }] }))
    expect(options.map(option => [option.id, option.available, option.lines])).toEqual([
      ['lrclib', true, 41], ['netease', true, 44], ['kugou', false, undefined], ['spotify', true, 40]])
    expect(options.find(option => option.chosen)?.id).toBe('netease')
    expect(options.find(option => option.inUse)?.id).toBe('netease')
  })

  it('marks a provider whose lyrics differ from the automatic choice', () => {
    const options = sourceOptions(document('LRCLIB · 精确匹配', {
      availableSources: [{ id: 'lrclib', lines: 41, agrees: true }, { id: 'netease', lines: 60, agrees: false }, { id: 'kugou', lines: 41 }] }))
    expect(options.map(option => [option.id, option.differs])).toEqual([['lrclib', false], ['netease', true], ['kugou', false]])
    // It stays selectable: the user may want that version.
    expect(options.find(option => option.id === 'netease')?.available).toBe(true)
  })

  it('has no provider in use for untimed or missing lyrics', () => {
    expect(sourceOptions(null).some(option => option.inUse)).toBe(false)
    expect(sourceOptions({ trackId: 't', tracks: [], untimedOriginal: { text: 'x', language: 'ja', source: 'Spotify' } }).some(option => option.inUse)).toBe(false)
  })
})
