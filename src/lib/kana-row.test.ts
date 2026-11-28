import { describe, expect, it } from 'vitest'
import { kanaRequest, kanaSource, kanaTrack, withKanaTrack } from './kana-row'
import { alignSecondaryTrack, visibleTracks } from './lyrics'
import type { LyricsDocument, LyricTrack } from '../types'

// Sentences written for this test, not lyrics.
const TEXTS = ['今日は天気がいい', 'ねえ ねえ', '駅まで歩いて行く', 'Good morning', '作词 : someone']
const READINGS = ['きょうはてんきがいい', 'ねえ ねえ', 'えきまであるいていく', 'Good morning', '作词 : someone']
const track = (id: string, language: string, kind: LyricTrack['kind'], texts: string[]): LyricTrack =>
  ({ id, language, label: language, kind, source: 'test', lines: texts.map((text, index) => ({ startMs: index * 4000, text })) })
const original = track('o', 'ja', 'original', TEXTS)
const song = (...tracks: LyricTrack[]) => ({ trackId: 't', tracks } as LyricsDocument)

describe('the kana row', () => {
  it('is made for a Japanese original when the listener switched it on', () => {
    expect(kanaSource(song(original), ['ja', 'kana'])).toBe(original)
    expect(kanaSource(song(original), ['ja', 'romaji'])).toBeUndefined()
    expect(kanaSource(song(track('o', 'en', 'original', ['a'])), ['kana'])).toBeUndefined()
    expect(kanaSource(song(track('o', 'zh-Hans', 'original', ['今天天气很好'])), ['kana'])).toBeUndefined()
    expect(kanaSource({ ...song(original), untimedOriginal: { text: 'x', language: 'ja', source: 's' } }, ['kana'])).toBeUndefined()
    expect(kanaSource(null, ['kana'])).toBeUndefined()
  })

  it('asks for exactly the lines a romaji request sends', () => {
    expect(kanaRequest(original)).toEqual(TEXTS)
  })

  it('sits on the times of the original and skips lines that read the same in kana', () => {
    const row = kanaTrack(original, READINGS)!
    expect(row).toMatchObject({ id: 'o-kana', language: 'kana', kind: 'kana' })
    expect(row.lines.map(line => line.startMs)).toEqual(original.lines.map(line => line.startMs))
    expect(row.lines.map(line => line.text)).toEqual(['きょうはてんきがいい', '', 'えきまであるいていく', '', ''])
  })

  it('is not made from an answer of another length, or when nothing differs', () => {
    expect(kanaTrack(original, READINGS.slice(1))).toBeNull()
    expect(kanaTrack(track('o', 'ja', 'original', ['ねえ', 'ラララ']), ['ねえ', 'ラララ'])).toBeNull()
  })

  it('is shown under the original and above the romaji, by its own switch', () => {
    const romaji = track('r', 'romaji', 'romanization', ['kyou wa tenki ga ii', 'nee nee', 'eki made aruite iku', 'Good morning'])
    const chinese = track('z', 'zh-Hans', 'translation', ['今天天气很好', '喂 喂', '走到车站', '早上好'])
    const shown = withKanaTrack(song(original, chinese, romaji), kanaTrack(original, READINGS)!)
    expect(visibleTracks(shown, ['ja', 'kana', 'romaji', 'zh-Hans'], true).map(item => item.kind)).toEqual(['original', 'kana', 'romanization', 'translation'])
    // The romaji switch-row does not hide kana, and the kana switch does not show romaji.
    expect(visibleTracks(shown, ['ja', 'kana', 'romaji'], false).map(item => item.kind)).toEqual(['original', 'kana'])
    expect(visibleTracks(shown, ['ja', 'romaji', 'zh-Hans'], true).map(item => item.kind)).toEqual(['original', 'romanization', 'translation'])
  })

  it('leaves a row without kanji without a kana line, and the credit line too', () => {
    const shown = withKanaTrack(song(original), kanaTrack(original, READINGS)!)
    const [base, kana] = visibleTracks(shown, ['kana'], true)
    expect(alignSecondaryTrack(base.lines, kana.lines).map(line => line?.text)).toEqual(['きょうはてんきがいい', undefined, 'えきまであるいていく', undefined])
  })

  it('replaces an earlier kana row instead of adding a second one', () => {
    const first = withKanaTrack(song(original), kanaTrack(original, READINGS)!)
    const again = withKanaTrack(first, kanaTrack(original, READINGS)!)
    expect(again.tracks.filter(item => item.kind === 'kana')).toHaveLength(1)
  })
})
