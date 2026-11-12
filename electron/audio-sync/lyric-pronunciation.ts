import { arpabetPhones } from './english-phones'
import { pinyinPhones } from './mandarin-phones'

/**
 * Pronunciations of Chinese and English lyric lines for listening calibration.
 * Readings are produced in a disposable worker (pinyin dictionary, CMUdict);
 * this module turns them into RomajiASR phone sequences.
 */

export type PronunciationToken =
  | { kind: 'han'; reading: string }
  | { kind: 'word'; text: string; reading: string | null }
  | { kind: 'unsupported'; text: string }

export interface PronunciationReaders {
  /** Per-character readings of a line, as pinyin-pro `type: 'all'` returns them. */
  pinyin(text: string): Array<{ origin: string; pinyin: string; isZh: boolean }>
  /** ARPAbet for one lower-case word, or null. */
  english(word: string): string | null
}

const LATIN = /[A-Za-z'’]/
const UNSUPPORTED = /[0-9\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** Tokens of one line in sung order: Han characters, Latin words, and anything that cannot be pronounced. */
export function readLinePronunciation(text: string, readers: PronunciationReaders): PronunciationToken[] {
  const tokens: PronunciationToken[] = []
  let word = ''
  const flush = () => {
    if (!word) return
    tokens.push({ kind: 'word', text: word, reading: readers.english(word) })
    word = ''
  }
  for (const item of readers.pinyin(text.normalize('NFKC'))) {
    const ch = item.origin
    if (item.isZh) {
      flush()
      tokens.push(item.pinyin ? { kind: 'han', reading: item.pinyin } : { kind: 'unsupported', text: ch })
      continue
    }
    if (LATIN.test(ch)) { word += ch; continue }
    flush()
    if (UNSUPPORTED.test(ch)) tokens.push({ kind: 'unsupported', text: ch })
  }
  flush()
  return tokens
}

/** CMUdict lookup with the spellings lyrics use (lovin', 'cause, rock'n). */
export function englishReader(dictionary: Record<string, string>) {
  return (raw: string) => {
    const word = raw.toLowerCase().replace(/’/g, "'")
    for (const candidate of [word, word.replace(/in'$/, 'ing'), word.replace(/^'+|'+$/g, ''), word.replace(/'s$/, '')]) {
      const reading = Object.prototype.hasOwnProperty.call(dictionary, candidate) ? dictionary[candidate] : undefined
      if (typeof reading === 'string') return reading
    }
    return null
  }
}

/**
 * Phones of a line's leading pronounceable tokens. An unknown word or an
 * unsupported character ends the usable prefix: what follows cannot be
 * placed without it.
 */
export function pronunciationPhones(tokens: PronunciationToken[], vocabulary: ReadonlySet<string>): string[] {
  const phones: string[] = []
  for (const token of tokens) {
    if (token.kind === 'unsupported') break
    const mapped = token.kind === 'han' ? pinyinPhones(token.reading, vocabulary) : token.reading ? arpabetPhones(token.reading, vocabulary) : null
    if (!mapped) break
    phones.push(...mapped)
  }
  return phones
}

/** Share of a song's words and characters that have a reading. Low for lyrics
 * that are not English or Chinese (Spanish, romaji, ...): those are skipped. */
export function pronunciationCoverage(lines: PronunciationToken[][]) {
  let known = 0, total = 0
  for (const token of lines.flat()) {
    total += 1
    if (token.kind === 'han' || (token.kind === 'word' && token.reading)) known += 1
  }
  return total ? known / total : 0
}
export const MIN_PRONUNCIATION_COVERAGE = 0.75
