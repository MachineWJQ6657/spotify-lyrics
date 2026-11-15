import { describe, expect, it } from 'vitest'
import { isLyricCredit } from './lyric-metadata'
import { parseLrc, visibleTracks } from './lyrics'
import { parseTimedRows, stripTimedTrackMetadata } from '../../electron/lyrics-provider'
import type { LyricsDocument } from '../types'

describe('shared lyric credit recognition', () => {
  it.each(['母带工程师 : raku', '混音工程师：raku', '母帶工程師：name', '錄音工程師: name', 'Mastering Engineer: Name', '词：Name'])('removes precise credit label %s at the end as well as the start', label => {
    expect(isLyricCredit(label)).toBe(true)
    const lrc = `[00:00.00]${label}\n[00:12.00]actual lyric\n[04:20.00]${label}`
    expect(parseLrc(lrc).map(row => row.text)).toEqual(['actual lyric'])
    expect(parseTimedRows(lrc).map(row => row.text)).toEqual(['actual lyric'])
    expect(stripTimedTrackMetadata(lrc, { name: 'Song', artist: 'Artist' })).not.toContain(label)
  })
  it.each(['母带着我走', '混音般的夜晚', 'The mastering engineer sings', '作曲する君', '词：'])('preserves ordinary or incomplete text %s', text => {
    expect(isLyricCredit(text)).toBe(false)
  })
  it.each(['作詞/作曲/編曲：MIMI', '作词 / 作曲：n-buna', '歌唱：CIEL', 'Vocal: suis', 'Lyrics & Music: Ayase', '作詞・作曲：米津玄師', '唄：初音ミク'])('recognises combined and singer credits %s', label => {
    expect(isLyricCredit(label)).toBe(true)
  })
  it.each(['歌唱しよう今', '唄う君の声', 'Music is my life', 'vocal cords tremble', '作詞/作曲', '歌：'])('preserves sung text that only begins like a credit %s', text => {
    expect(isLyricCredit(text)).toBe(false)
  })
  it('removes a bracketed title header but keeps a sung title refrain', () => {
    const lrc = '[00:00.00]「空中散歩」\n[00:01.00]歌唱：CIEL\n[00:02.00]作詞/作曲/編曲：MIMI\n[00:12.00]空中散歩\n[00:16.00]ふわり浮かんだ'
    expect(parseTimedRows(stripTimedTrackMetadata(lrc, { name: '空中散歩', artist: 'CIEL' })).map(row => row.text)).toEqual(['空中散歩', 'ふわり浮かんだ'])
    // Brackets around other words, or the title in brackets late in the song, stay.
    const kept = '[00:05.00]「さよなら」\n[01:30.00]「空中散歩」'
    expect(parseTimedRows(stripTimedTrackMetadata(kept, { name: '空中散歩', artist: 'CIEL' })).map(row => row.text)).toEqual(['「さよなら」', '「空中散歩」'])
  })
  it('removes cached romanized credit rows by original timestamp without mutating storage', () => {
    const original = { id: 'original', language: 'ja', label: 'JA', kind: 'original' as const, source: 'provider', lines: [{ startMs: 1000, text: '歌う' }, { startMs: 260000, text: '母带工程师 : raku' }] }
    const romaji = { ...original, id: 'romaji', language: 'romaji', kind: 'romanization' as const, lines: [{ startMs: 1000, text: 'utau' }, { startMs: 260000, text: 'haha 带 kootei 师 : raku' }] }
    const document: LyricsDocument = { trackId: 'test', updatedAt: 0, tracks: [original, romaji] }
    const tracks = visibleTracks(document, ['ja', 'romaji'], true)
    expect(tracks.map(track => track.lines.length)).toEqual([1, 1])
    expect(original.lines).toHaveLength(2)
    expect(romaji.lines).toHaveLength(2)
  })
})
