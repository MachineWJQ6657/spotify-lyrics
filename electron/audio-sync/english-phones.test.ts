import { describe, expect, it } from 'vitest'
import { arpabetPhones } from './english-phones'
import { VOCABULARY } from './romaji-vocabulary.fixture'

describe('arpabetPhones', () => {
  it('maps CMUdict pronunciations to morae the way katakana hears them', () => {
    expect(arpabetPhones('L AH1 V', VOCABULARY)).toEqual(['ra|ro|ru', '?v|vu|bu'])
    expect(arpabetPhones('Y UW1', VOCABULARY)).toEqual(['yu|u'])
    expect(arpabetPhones('B EY1 B IY0', VOCABULARY)).toEqual(['be', '?i', 'bi'])
    expect(arpabetPhones('N AY1 T', VOCABULARY)).toEqual(['na', '?i|e', '?t|to'])
  })

  it('drops post-vocalic R and keeps clusters as optional consonants', () => {
    expect(arpabetPhones('HH AA1 R T', VOCABULARY)).toEqual(['ha|ho', '?t|to'])
    expect(arpabetPhones('S T R IY1 T', VOCABULARY)).toEqual(['?s|su', '?t|to', 'ri', '?t|to'])
  })

  it('rejects unknown symbols and words with no sounded mora', () => {
    expect(arpabetPhones('', VOCABULARY)).toBeNull()
    expect(arpabetPhones('XX AH1', VOCABULARY)).toBeNull()
    expect(arpabetPhones('S T', VOCABULARY)).toBeNull()
  })

  it('only emits labels the model has', () => {
    for (const pronunciation of ['DH AH0', 'W ER1 L D', 'TH IH1 NG K', 'CH EY1 N JH', 'ZH AA1 N R AH0', 'OY1 L', 'AW1 T', 'G UH1 D', 'F AO1 L IH0 NG']) {
      for (const phone of arpabetPhones(pronunciation, VOCABULARY)!) for (const label of phone.replace(/^\?/, '').split('|')) expect(VOCABULARY.has(label), `${pronunciation}: ${label}`).toBe(true)
    }
  })
})
