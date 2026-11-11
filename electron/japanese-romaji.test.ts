import { describe, expect, it } from 'vitest'
import { toRomaji } from 'wanakana'
import { applyFuriganaReadings, romanizeJapaneseWords } from './japanese-romaji'
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
  const read = (surface_form: string, reading: string, pronunciation = reading, pos = '名詞'): JapaneseWord => ({ surface_form, reading, pronunciation, pos })
  it('writes kanji long vowels from the reading, like human lyric romaji', () => {
    expect(romanizeJapaneseWords([read('太陽', 'タイヨウ', 'タイヨー'), read('を', 'ヲ', 'ヲ', '助詞'), read('見', 'ミ', 'ミ', '動詞')], toRomaji)).toBe('taiyou wo mi')
    expect(romanizeJapaneseWords([read('蝶', 'チョウ', 'チョー'), read('は', 'ハ', 'ワ', '助詞')], toRomaji)).toBe('chou wa')
  })
  it('reads number+counter words and other split compounds as one word', () => {
    expect(romanizeJapaneseWords([read('一', 'イチ'), read('人', 'ニン'), read('歩い', 'アルイ', 'アルイ', '動詞')], toRomaji)).toBe('hitori arui')
    expect(romanizeJapaneseWords([read('たった', 'タッタ', 'タッタ', '副詞'), read('二', 'ニ'), read('人', 'ニン')], toRomaji)).toBe('tatta futari')
    expect(romanizeJapaneseWords([read('もう', 'モウ', 'モー', '副詞'), read('一', 'イチ'), read('回', 'カイ')], toRomaji)).toBe('mou ikkai')
    expect(romanizeJapaneseWords([read('幽', 'カソケ'), read('体', 'タイ'), read('離脱', 'リダツ')], toRomaji)).toBe('yuutai ridatsu')
  })
  it('never prints the 々 iteration mark', () => {
    expect(romanizeJapaneseWords([read('精', 'キヨシ'), { surface_form: '々', pos: '記号' }, read('歌っ', 'ウタッ', 'ウタッ', '動詞'),
      { surface_form: 'て', reading: 'テ', pronunciation: 'テ', pos: '助詞', pos_detail_1: '接続助詞' }], toRomaji)).toBe('seizei utatte')
    expect(romanizeJapaneseWords([read('時', 'トキ'), { surface_form: '々', pos: '記号' }], toRomaji)).toBe('tokitoki')
    expect(romanizeJapaneseWords([read('日曜', 'ニチヨウ'), { surface_form: '々', pos: '記号' }], toRomaji)).not.toContain('々')
  })
  it('fixes standalone kanji and 風 after a demonstrative', () => {
    expect(romanizeJapaneseWords([read('波', 'ハ'), read('を', 'ヲ', 'ヲ', '助詞')], toRomaji)).toBe('nami wo')
    expect(romanizeJapaneseWords([read('土', 'ド'), read('を', 'ヲ', 'ヲ', '助詞')], toRomaji)).toBe('tsuchi wo')
    expect(romanizeJapaneseWords([read('あんな', 'アンナ', 'アンナ', '連体詞'), read('風', 'カゼ'), read('に', 'ニ', 'ニ', '助詞')], toRomaji)).toBe('anna fuu ni')
    expect(romanizeJapaneseWords([read('風', 'カゼ'), read('に', 'ニ', 'ニ', '助詞')], toRomaji)).toBe('kaze ni')
  })
  it('keeps inflections in one word and reads 何 before a copula as nan', () => {
    const suffix = (surface_form: string, reading: string): JapaneseWord => ({ surface_form, reading, pronunciation: reading, pos: '動詞', pos_detail_1: '接尾' })
    const aux = (surface_form: string, reading: string): JapaneseWord => ({ surface_form, reading, pronunciation: reading, pos: '助動詞' })
    expect(romanizeJapaneseWords([read('満たさ', 'ミタサ', 'ミタサ', '動詞'), suffix('れ', 'レ'), aux('ない', 'ナイ')], toRomaji)).toBe('mitasarenai')
    expect(romanizeJapaneseWords([read('なれ', 'ナレ', 'ナレ', '動詞'),
      { surface_form: 'ば', reading: 'バ', pronunciation: 'バ', pos: '助詞', pos_detail_1: '接続助詞' }], toRomaji)).toBe('nareba')
    expect(romanizeJapaneseWords([read('何', 'ナニ'), aux('だっ', 'ダッ'),
      { surface_form: 'け', reading: 'ケ', pronunciation: 'ケ', pos: '助詞', pos_detail_1: '終助詞' }], toRomaji)).toBe('nandakke')
    expect(romanizeJapaneseWords([read('何', 'ナニ'), aux('だ', 'ダ'),
      { surface_form: 'っけ', reading: 'ッケ', pronunciation: 'ッケ', pos: '助詞', pos_detail_1: '終助詞' }], toRomaji)).toBe('nandakke')
    expect(romanizeJapaneseWords([read('何', 'ナニ'), read('を', 'ヲ', 'ヲ', '助詞')], toRomaji)).toBe('nani wo')
  })
  it('joins contracted te-iru / te-iku forms into one word', () => {
    const v = (surface_form: string, reading: string, pos_detail_1 = '自立'): JapaneseWord => ({ surface_form, reading, pronunciation: reading, pos: '動詞', pos_detail_1 })
    const aux = (surface_form: string, reading: string): JapaneseWord => ({ surface_form, reading, pronunciation: reading, pos: '助動詞' })
    expect(romanizeJapaneseWords([v('広げ', 'ヒロゲ'), v('て', 'テ', '非自立'), aux('た', 'タ')], toRomaji)).toBe('hirogeteta')
    expect(romanizeJapaneseWords([v('歌っ', 'ウタッ'), v('てる', 'テル', '非自立')], toRomaji)).toBe('utatteru')
    expect(romanizeJapaneseWords([v('忘れ', 'ワスレ'), { surface_form: 'て', reading: 'テ', pronunciation: 'テ', pos: '助詞', pos_detail_1: '接続助詞' }, v('く', 'ク', '非自立')], toRomaji)).toBe('wasureteku')
    // An independent auxiliary verb such as いる stays a separate word.
    expect(romanizeJapaneseWords([v('見', 'ミ'), { surface_form: 'て', reading: 'テ', pronunciation: 'テ', pos: '助詞', pos_detail_1: '接続助詞' }, v('い', 'イ', '非自立'), aux('た', 'タ')], toRomaji)).toBe('mite ita')
  })
  it('uses printed furigana as the reading of the preceding kanji', () => {
    expect(applyFuriganaReadings('翅（はね）を広げてた')).toBe('はねを広げてた')
    expect(applyFuriganaReadings('明日は辛(つら)くはないか')).toBe('明日はつらくはないか')
    // Lyric ateji: 本気（マジ） is sung "maji".
    expect(applyFuriganaReadings('本気（マジ）で好き')).toBe('マジで好き')
    expect(applyFuriganaReadings('ラララ (la la la)')).toBe('ラララ (la la la)')
    const isolated = new Function(`return (${applyFuriganaReadings.toString()})`)() as typeof applyFuriganaReadings
    expect(isolated('海月（くらげ）')).toBe('くらげ')
  })
  it('works as a serialized worker function without its module scope', () => {
    const isolated = new Function(`return (${romanizeJapaneseWords.toString()})`)() as typeof romanizeJapaneseWords
    expect(isolated([word('行っ', 'イッ', '動詞'), word('た', 'タ', '助動詞')], toRomaji)).toBe('itta')
  })
})
