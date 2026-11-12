import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pinyinPhones, splitPinyin } from './mandarin-phones'
import { VOCABULARY } from './romaji-vocabulary.fixture'


describe('splitPinyin', () => {
  it('restores the canonical finals hidden by pinyin spelling', () => {
    expect(splitPinyin('ju')).toEqual({ initial: 'j', final: 'v' })
    expect(splitPinyin('xue')).toEqual({ initial: 'x', final: 've' })
    expect(splitPinyin('liu')).toEqual({ initial: 'l', final: 'iou' })
    expect(splitPinyin('gui')).toEqual({ initial: 'g', final: 'uei' })
    expect(splitPinyin('lun')).toEqual({ initial: 'l', final: 'uen' })
    expect(splitPinyin('yuan')).toEqual({ initial: '', final: 'van' })
    expect(splitPinyin('yi')).toEqual({ initial: '', final: 'i' })
    expect(splitPinyin('wo')).toEqual({ initial: '', final: 'uo' })
    expect(splitPinyin('zhong')).toEqual({ initial: 'zh', final: 'ong' })
    expect(splitPinyin('lü')).toEqual({ initial: 'l', final: 'v' })
    expect(splitPinyin('nv3')).toEqual({ initial: 'n', final: 'v' })
  })

  it('rejects strings that are not pinyin', () => {
    expect(splitPinyin('')).toBeNull()
    expect(splitPinyin('xyz')).toBeNull()
    expect(splitPinyin('hello')).toBeNull()
  })
})

describe('pinyinPhones', () => {
  it('maps syllables to CV morae with optional tails and nasal codas', () => {
    expect(pinyinPhones('ni', VOCABULARY)).toEqual(['ni'])
    expect(pinyinPhones('ai', VOCABULARY)).toEqual(['a', '?i|e'])
    expect(pinyinPhones('xiang', VOCABULARY)).toEqual(['sha|shi', '?a', '?N'])
    expect(pinyinPhones('wo', VOCABULARY)).toEqual(['wo|u|o', '?o'])
    expect(pinyinPhones('yun', VOCABULARY)).toEqual(['yu', '?N'])
    expect(pinyinPhones('yo', VOCABULARY)![0].split('|')).toContain('yo')
    // 嗯 / 呣 are a hum.
    expect(pinyinPhones('ng', VOCABULARY)).toEqual(['N'])
  })

  it('accepts the apical vowel of zi/ci/si and zhi/chi/shi as u or i', () => {
    expect(pinyinPhones('si', VOCABULARY)![0].split('|')).toEqual(expect.arrayContaining(['su', 'si', 'shi']))
    expect(pinyinPhones('shi', VOCABULARY)![0].split('|')).toEqual(expect.arrayContaining(['shi', 'shu']))
  })

  it('only emits labels the model has, and never starts with an optional phone', () => {
    const syllables = ['ba', 'pai', 'mei', 'fou', 'dang', 'teng', 'nong', 'lie', 'gua', 'kuai', 'huang', 'jiong', 'qiu', 'xuan', 'zhui', 'chuan', 'shun', 'ruo', 'zeng', 'cuo', 'song', 'er', 'yao', 'wei', 'wen', 'yue', 'nüe', 'miao', 'diu', 'tian']
    for (const syllable of syllables) {
      const phones = pinyinPhones(syllable, VOCABULARY)
      expect(phones, syllable).not.toBeNull()
      expect(phones![0].startsWith('?'), syllable).toBe(false)
      for (const phone of phones!) for (const label of phone.replace(/^\?/, '').split('|')) expect(VOCABULARY.has(label), `${syllable}: ${label}`).toBe(true)
    }
  })

  it('agrees with the bundled model vocabulary file when it is present', () => {
    let vocabulary: Set<string>
    try { vocabulary = new Set(Object.keys(JSON.parse(readFileSync('.tools/audio-sync/romajiasr-v1.0.0/unpacked/phoneme_vocab.json', 'utf8')))) } catch { return }
    for (const label of VOCABULARY) expect(vocabulary.has(label), label).toBe(true)
  })
})
