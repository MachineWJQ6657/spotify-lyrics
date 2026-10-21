import { describe, expect, it } from 'vitest'
import { mapJapanesePhones } from './japanese-phonemes'
import type { JapaneseWord } from '../romanizer'

const word = (surface_form: string, reading?: string, pronunciation?: string): JapaneseWord => ({ surface_form, reading, pronunciation })
const labels = (value: ReturnType<typeof mapJapanesePhones>) => value.phones.map(phone => phone.phone)

describe('Japanese dictionary mora frontend', () => {
  it('retains small tsu, N and contracted kana as distinct vocabulary labels', () => {
    const result = mapJapanesePhones('喜んで待って今日', [word('喜ん', 'ヨロコン'), word('で', 'デ'), word('待っ', 'マッ'),
      word('て', 'テ'), word('今日', 'キョウ', 'キョー')])
    expect(result.reason).toBe('mapped')
    expect(labels(result)).toEqual(['yo', 'ro', 'ko', 'N', 'de', 'ma', 'cl', 'te', 'kyo', 'o'])
    expect(result.words.map(item => [item.phoneStart, item.phoneEnd])).toEqual([[0, 4], [4, 5], [5, 7], [7, 8], [8, 10]])
    expect(result.words[4].variants.map(item => item.phones.map(phone => phone.phone))).toEqual([['kyo', 'o'], ['kyo', 'u']])
  })

  it('maps a dictionary reading to its entire original word, never invented kanji subdivisions', () => {
    const result = mapJapanesePhones('  想い出 を、君に。 ', [word('想い出', 'オモイデ'), word('を', 'ヲ', 'オ'),
      word('、'), word('君', 'キミ'), word('に', 'ニ'), word('。')])
    expect(result.complete).toBe(true)
    expect(result.phones.slice(0, 4).map(item => [item.sourceStart, item.sourceEnd])).toEqual([[2, 5], [2, 5], [2, 5], [2, 5]])
    expect(result.phones.slice(0, 4).map(item => [item.readingStart, item.readingEnd])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]])
    expect(result.gaps).toEqual([{ sourceStart: 0, sourceEnd: 2, text: '  ' },
      { sourceStart: 5, sourceEnd: 6, text: ' ' }, { sourceStart: 11, sourceEnd: 12, text: ' ' }])
    expect(result.words.filter(item => item.status === 'punctuation').map(item => item.surface)).toEqual(['、', '。'])
    expect(result.words[1].variants.map(item => item.phones[0].phone)).toEqual(['o', 'wo'])
    expect(result.phones.every(item => !('startMs' in item))).toBe(true)
  })

  it('preserves explicit vowel length without quietly folding adjacent vowel spelling', () => {
    expect(labels(mapJapanesePhones('セーラー', [word('セーラー')]))).toEqual(['se', 'e', 'ra', 'a'])
    expect(labels(mapJapanesePhones('えいおう', [word('えいおう')]))).toEqual(['e', 'i', 'o', 'u'])
    const result = mapJapanesePhones('せい', [word('せい', 'セイ', 'セー')])
    expect(result.words[0].variants.map(item => item.phones.map(phone => phone.phone))).toEqual([['se', 'e'], ['se', 'i']])
  })

  it('normalizes half-width/combining kana only inside readings, retaining original source offsets', () => {
    const result = mapJapanesePhones('ｷﾞｬｯプ', [word('ｷﾞｬｯ', 'ｷﾞｬｯ'), word('プ', 'プ')])
    expect(result.complete).toBe(true)
    expect(labels(result)).toEqual(['gya', 'cl', 'pu'])
    expect(result.phones.slice(0, 2).map(item => [item.sourceStart, item.sourceEnd])).toEqual([[0, 4], [0, 4]])
    expect(result.phones[0]).toMatchObject({ readingStart: 0, readingEnd: 2 })
  })

  it('does not romanize English through an invented katakana reading, even if supplied by an analyzer', () => {
    const result = mapJapanesePhones('君Addictを', [word('君', 'キミ'), word('Addict', 'アディクト'), word('を', 'ヲ', 'オ')])
    expect(result.reason).toBe('unsupported')
    expect(result.complete).toBe(false)
    expect(result.unsupported).toEqual([{ wordIndex: 1, sourceStart: 1, sourceEnd: 7, surface: 'Addict', reason: 'latin' }])
    expect(result.words[1]).toMatchObject({ status: 'unsupported', phoneStart: 2, phoneEnd: 2, variants: [] })
    expect(labels(result)).toEqual(['ki', 'mi', 'o'])
  })

  it('keeps Arabic/full-width numbers unknown, without guessing many plausible spoken forms', () => {
    const result = mapJapanesePhones('3時と２０２６年', [word('3', 'サン'), word('時', 'ジ'), word('と', 'ト'),
      word('２０２６', 'ニセンニジュウロク'), word('年', 'ネン')])
    expect(result.unsupported.map(item => [item.surface, item.reason, item.sourceStart, item.sourceEnd]))
      .toEqual([['3', 'number', 0, 1], ['２０２６', 'number', 3, 7]])
    expect(result.words).toHaveLength(5)
    expect(labels(result)).toEqual(['ji', 'to', 'ne', 'N'])
  })

  it('does not drop an unrecognized Han word or synthesize its kana from a neighbor', () => {
    const result = mapJapanesePhones('愛𠮷に', [word('愛', 'アイ'), word('𠮷'), word('に', 'ニ')])
    expect(result.complete).toBe(false)
    expect(result.unsupported).toEqual([{ wordIndex: 1, sourceStart: 1, sourceEnd: 3, surface: '𠮷', reason: 'unknown-reading' }])
    expect(result.words[2]).toMatchObject({ sourceStart: 3, sourceEnd: 4, phoneStart: 2, phoneEnd: 3 })
  })

  it('keeps unsupported loan kana and orphan small kana atomic rather than dropping one sound', () => {
    for (const reading of ['キャァ', 'ヴュ', 'クァ', 'ァ', 'ャ', 'ーア', 'ンー', 'ッー', 'アイ?']) {
      const result = mapJapanesePhones('未知', [word('未知', reading)])
      expect(result.reason, reading).toBe('unsupported')
      expect(result.phones, reading).toEqual([])
      expect(result.unsupported[0]?.reason, reading).toBe('unsupported-reading')
    }
  })

  it('does not silently discard an unsupported explicit pronunciation or reading alternative', () => {
    for (const alternatives of [word('今日', 'キョウ', 'クァ'), word('今日', 'クァ', 'キョー'),
      word('今日', 'キョウ', 'アイ?'), word('今日', 'キョウ', '㌀'.repeat(251))]) {
      const result = mapJapanesePhones('君今日を', [word('君', 'キミ'), alternatives, word('を', 'ヲ', 'オ')])
      expect(result.reason).toBe('unsupported')
      expect(result.complete).toBe(false)
      expect(result.words[1]).toMatchObject({ status: 'unsupported', phoneStart: 2, phoneEnd: 2, variants: [] })
      expect(result.unsupported).toEqual([{ wordIndex: 1, sourceStart: 1, sourceEnd: 3,
        surface: '今日', reason: 'unsupported-reading' }])
      expect(labels(result)).toEqual(['ki', 'mi', 'o'])
    }
  })

  it('treats the analyzer missing-reading sentinel as absent, not as an unrepresentable explicit path', () => {
    const readingOnly = mapJapanesePhones('今日', [word('今日', 'キョウ', '*')])
    expect(readingOnly.complete).toBe(true)
    expect(readingOnly.words[0].variants.map(variant => variant.source)).toEqual(['reading'])
    expect(mapJapanesePhones('あ', [word('あ', '*', '*')])).toMatchObject({ reason: 'mapped', complete: true })
    expect(mapJapanesePhones('今日', [word('今日', '*', '*')])).toMatchObject({ reason: 'unsupported', complete: false })
  })

  it('maps explicit supported foreign kana while keeping model vocabulary alternatives distinct', () => {
    expect(labels(mapJapanesePhones('ふぁディずぃしすぃ', [word('ふぁ'), word('ディ'), word('ずぃ'), word('し'), word('すぃ')])))
      .toEqual(['fa', 'di', 'zi', 'shi', 'si'])
    const result = mapJapanesePhones('は', [word('は', 'ハ', 'ワ')])
    expect(result.words[0].variants.map(item => item.phones[0].phone)).toEqual(['wa', 'ha'])
  })

  it('does not multiply whole-line alternatives or retain duplicate equivalent dictionary paths', () => {
    const result = mapJapanesePhones('今日今日', [word('今日', 'キョウ', 'キョー'), word('今日', 'キョウ', 'キョー')])
    expect(result.words.map(item => item.variants.length)).toEqual([2, 2])
    expect(result.phones).toHaveLength(4)
    expect(mapJapanesePhones('君', [word('君', 'キミ', 'キミ')]).words[0].variants).toHaveLength(1)
  })

  it('requires exact monotonic surface coverage, including punctuation and missing words', () => {
    for (const words of [[word('君', 'キミ'), word('僕', 'ボク')], [word('僕', 'ボク'), word('君', 'キミ')],
      [word('君', 'キミ')], [word('君', 'キミ'), word('君', 'キミ'), word('僕', 'ボク')]]) {
      expect(mapJapanesePhones('君と僕', words)).toMatchObject({ reason: 'surface-mismatch', phones: [], words: [] })
    }
    expect(mapJapanesePhones('君、僕', [word('君', 'キミ'), word('僕', 'ボク')]).reason).toBe('surface-mismatch')
    expect(mapJapanesePhones('君', [word('君', 'キミ'), word('余分', 'ヨブン')]).reason).toBe('surface-mismatch')
  })

  it('preserves symbols as unsupported source spans, while accepting explicit silence-only text', () => {
    const result = mapJapanesePhones('君🎵', [word('君', 'キミ'), word('🎵')])
    expect(result.unsupported[0]).toMatchObject({ sourceStart: 1, sourceEnd: 3, surface: '🎵', reason: 'symbol' })
    expect(mapJapanesePhones('君🎵', [word('君🎵', 'キミ')]).words[0].status).toBe('unsupported')
    expect(mapJapanesePhones('안녕', [word('안녕', 'アンニョン')]).words[0].status).toBe('unsupported')
    expect(mapJapanesePhones('  ', [])).toMatchObject({ reason: 'mapped', phones: [], complete: true })
    expect(mapJapanesePhones('（…）', [word('（'), word('…'), word('）')]).complete).toBe(true)
  })

  it('accounts for every original UTF-16 unit, including unsupported words and analyzer whitespace gaps', () => {
    const raw = ' 𠮷は3時、Addict 🎵'
    const result = mapJapanesePhones(raw, [word('𠮷', 'ヨシ'), word('は', 'ハ', 'ワ'), word('3', 'サン'),
      word('時', 'ジ'), word('、'), word('Addict', 'アディクト'), word('🎵')])
    const spans = [...result.words, ...result.gaps].sort((a, b) => a.sourceStart - b.sourceStart)
    expect(spans.map(span => raw.slice(span.sourceStart, span.sourceEnd)).join('')).toBe(raw)
    expect(spans.every((span, index) => span.sourceStart === (index ? spans[index - 1].sourceEnd : 0))).toBe(true)
    expect(result.phones.filter(phone => phone.wordIndex === 0).map(phone => [phone.sourceStart, phone.sourceEnd]))
      .toEqual([[1, 3], [1, 3]])
  })

  it('rejects malformed or oversized input without leaving plausible partial evidence', () => {
    for (const [raw, words] of [[null, []], ['君', null], ['君', [word('')]], ['君', [{ surface_form: '君', reading: 4 }]],
      ['あ'.repeat(4001), []], ['君', [word('君', 'ア'.repeat(1001))]], ['君', new Array(1)]]) {
      expect(mapJapanesePhones(raw as string, words as JapaneseWord[])).toMatchObject({ reason: 'invalid-input', complete: false, phones: [] })
    }
    expect(mapJapanesePhones('今日', [word('今日', 'キョウ', 'ア'.repeat(1001))]))
      .toMatchObject({ reason: 'invalid-input', complete: false, phones: [] })
    const oversizedReadings = Array.from({ length: 9 }, () => word('君', 'ア'.repeat(1000), 'イ'.repeat(1000)))
    expect(mapJapanesePhones('君'.repeat(9), oversizedReadings)).toMatchObject({ reason: 'invalid-input', complete: false, phones: [] })
  })
})
