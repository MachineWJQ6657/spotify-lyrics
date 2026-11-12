import { describe, expect, it } from 'vitest'
import { englishReader, pronunciationPhones, readLinePronunciation, type PronunciationReaders } from './lyric-pronunciation'
import { VOCABULARY } from './romaji-vocabulary.fixture'

const PINYIN: Record<string, string> = { 我: 'wo', 爱: 'ai', 你: 'ni', 中: 'zhong' }
const DICTIONARY: Record<string, string> = { baby: 'B EY1 B IY0', loving: 'L AH1 V IH0 NG', cause: 'K AH0 Z', "don't": 'D OW1 N T' }
const readers: PronunciationReaders = {
  pinyin: text => [...text].map(ch => ({ origin: ch, pinyin: PINYIN[ch] ?? '', isZh: /\p{Script=Han}/u.test(ch) })),
  english: englishReader(DICTIONARY),
}

describe('readLinePronunciation', () => {
  it('splits a mixed line into Han syllables and Latin words in sung order', () => {
    expect(readLinePronunciation('我爱你 Baby，中', readers)).toEqual([
      { kind: 'han', reading: 'wo' }, { kind: 'han', reading: 'ai' }, { kind: 'han', reading: 'ni' },
      { kind: 'word', text: 'Baby', reading: 'B EY1 B IY0' }, { kind: 'han', reading: 'zhong' },
    ])
  })

  it('marks digits, kana and characters without a reading as unsupported', () => {
    expect(readLinePronunciation('我 2 你', readers)[1]).toEqual({ kind: 'unsupported', text: '2' })
    expect(readLinePronunciation('我の', readers)[1]).toEqual({ kind: 'unsupported', text: 'の' })
    expect(readLinePronunciation('罕', readers)[0]).toEqual({ kind: 'unsupported', text: '罕' })
  })
})

describe('englishReader', () => {
  it('finds the spellings lyrics use', () => {
    const read = englishReader(DICTIONARY)
    expect(read('Lovin\'')).toBe('L AH1 V IH0 NG')
    expect(read('\'cause')).toBe('K AH0 Z')
    expect(read('Don’t')).toBe('D OW1 N T')
    expect(read('babys')).toBeNull()
    expect(read('constructor')).toBeNull()
  })
})

describe('pronunciationPhones', () => {
  it('keeps only the pronounceable prefix of a line', () => {
    const tokens = readLinePronunciation('我爱 baby zzz 你', readers)
    expect(pronunciationPhones(tokens, VOCABULARY)).toEqual(['wo|u|o', '?o', 'a', '?i|e', 'be', '?i', 'bi'])
    expect(pronunciationPhones(readLinePronunciation('2 我爱你', readers), VOCABULARY)).toEqual([])
  })
})
