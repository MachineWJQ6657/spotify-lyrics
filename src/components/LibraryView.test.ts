import { describe, expect, it } from 'vitest'
import { listenTimingKey } from '../lib/listened-offset'
import { coverTile, librarySourceTag, libraryTimingTag, matchesLibraryQuery } from './LibraryView'

const document = (name: string, artist: string, album = '') => ({ trackId: name, track: { id: name, name, artist, album, coverUrl: '', durationMs: 1 } })

describe('library filter', () => {
  it('matches title, artist or album, ignoring case, width and spaces', () => {
    expect(matchesLibraryQuery(document('Shape of You', 'Ed Sheeran', '÷'), 'shapeof')).toBe(true)
    expect(matchesLibraryQuery(document('春泥棒', 'ヨルシカ', '盗作'), 'ヨルシカ')).toBe(true)
    expect(matchesLibraryQuery(document('春泥棒', 'ヨルシカ', '盗作'), '盗作')).toBe(true)
    expect(matchesLibraryQuery(document('ＤＲＯＰ', '美波'), 'drop')).toBe(true)
    expect(matchesLibraryQuery(document('Let It Be', 'The Beatles'), 'queen')).toBe(false)
  })
  it('shows everything for an empty query', () => {
    expect(matchesLibraryQuery(document('a', 'b'), '  ')).toBe(true)
    expect(matchesLibraryQuery({ trackId: 'local' }, '')).toBe(true)
    expect(matchesLibraryQuery({ trackId: 'local' }, 'x')).toBe(false)
  })
})

describe('library timing tag', () => {
  const original = { id: 'o', language: 'en', label: 'English', kind: 'original' as const, source: 'test',
    lines: Array.from({ length: 9 }, (_, index) => ({ startMs: 5000 + index * 3000, text: `line ${index}` })) }
  it('names manual and listened corrections', () => {
    expect(libraryTimingTag({ trackId: 'a', tracks: [original], offsetMs: 1000 })).toBe('手动 · 延后 1.00 秒')
    expect(libraryTimingTag({ trackId: 'a', tracks: [original],
      listenedOffset: { timingKey: listenTimingKey(original), state: 'decided', offsetMs: 7120, measuredDeltaMs: 7265, lines: 7, measuredAt: 1 } })).toBe('听音 · 延后 7.12 秒')
    expect(libraryTimingTag({ trackId: 'a', tracks: [original] })).toBe('')
  })
  it('names the provider, or says the lyrics are local', () => {
    expect(librarySourceTag({ trackId: 'a', tracks: [{ ...original, source: '网易云音乐 · 搜索候选' }] })).toBe('网易云音乐')
    expect(librarySourceTag({ trackId: 'a', tracks: [{ ...original, source: 'LRCLIB · 精确匹配' }] })).toBe('LRCLIB')
    expect(librarySourceTag({ trackId: 'a', tracks: [{ ...original, source: '网易云音乐 · 搜索候选' }], userEditedTrackIds: [original.id] })).toBe('本地')
    expect(librarySourceTag({ trackId: 'a', tracks: [{ ...original, source: 'song.ja.lrc' }] })).toBe('')
    expect(librarySourceTag({ trackId: 'a', tracks: [] })).toBe('')
  })
  it('makes a tile from the title for a song without a cover', () => {
    expect(coverTile('心に穴が空いた').initial).toBe('心')
    expect(coverTile(' prologue').initial).toBe('P')
    expect(coverTile('𠮷野家').initial).toBe('𠮷')
    expect(coverTile(undefined)).toEqual({ initial: '♪', hue: 0 })
    // The same title always gets the same colour; different titles usually differ.
    expect(coverTile('春泥棒').hue).toBe(coverTile('春泥棒').hue)
    expect(coverTile('春泥棒').hue).not.toBe(coverTile('夜行').hue)
    const hue = coverTile('Shape of You').hue
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })
})
