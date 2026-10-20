import { describe, expect, it } from 'vitest'
import { toRomaji } from 'wanakana'
import { romanizeJapaneseWords } from './japanese-romaji'
import type { JapaneseWord } from './romanizer'

const word = (surface_form: string, pronunciation: string, pos = '名詞', pos_detail_1 = '一般'): JapaneseWord => ({ surface_form, pronunciation, pos, pos_detail_1 })

describe('Japanese readings composed before romanization', () => {
  it.each([
    [[word('待っ', 'マッ', '動詞'), word('て', 'テ', '助詞', '接続助詞')], 'matte'],
    [[word('なっ', 'ナッ', '動詞'), word('た', 'タ', '助動詞')], 'natta'],
    [[word('行っ', 'イッ', '動詞'), word('た', 'タ', '助動詞')], 'itta'],
    [[word('ずっ', 'ズッ', '副詞'), word('と', 'ト', '助詞', '格助詞')], 'zutto'],
  ] as Array<[JapaneseWord[], string]>)('preserves the closure across dictionary tokens: %j', (tokens, expected) => {
    expect(romanizeJapaneseWords(tokens, toRomaji)).toBe(expected)
  })
  it('keeps ordinary word boundaries, punctuation, Latin text and particle pronunciation', () => {
    expect(romanizeJapaneseWords([word('君', 'キミ'), word('は', 'ワ', '助詞'), word('君', 'キミ'),
      word('を', 'ヲ', '助詞'), word('待っ', 'マッ', '動詞'), word('て', 'テ', '助詞', '接続助詞'),
      word('。', '。', '記号'), word('Love', 'Love')], toRomaji)).toBe('kimi wa kimi wo matte. Love')
  })
  it('does not join an unfinished Japanese closure into unrelated Latin text', () => {
    const calls: string[] = []
    romanizeJapaneseWords([word('あっ', 'アッ'), word('Love', 'Love')], reading => { calls.push(reading); return reading })
    expect(calls).toEqual(['アッ', 'Love'])
  })
  it('uses reading/surface fallback without losing kanji or introducing undefined text', () => {
    expect(romanizeJapaneseWords([{ surface_form: '会い', reading: 'アイ' }, { surface_form: '🌸' }, { surface_form: ' ' }], toRomaji)).toBe('ai 🌸')
  })
  it('works as a serialized worker function without its module scope', () => {
    const isolated = new Function(`return (${romanizeJapaneseWords.toString()})`)() as typeof romanizeJapaneseWords
    expect(isolated([word('行っ', 'イッ', '動詞'), word('た', 'タ', '助動詞')], toRomaji)).toBe('itta')
  })
})
