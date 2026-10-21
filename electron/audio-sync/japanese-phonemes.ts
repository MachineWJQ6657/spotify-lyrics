import type { JapaneseWord } from '../romanizer'

/** Labels from the verified RomajiASR v1.0.0 mora vocabulary. The model also
 * has isolated consonant labels; a dictionary reading does not tell us when
 * those are emitted, so this frontend does not invent consonant fragments. */
const basic = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo', ん: 'N', っ: 'cl', ゔ: 'vu',
} as const
const paired = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che',
  ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo', ぢぇ: 'je',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', びぇ: 'bye',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo', ぴぇ: 'pye',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  いぇ: 'ye', うぁ: 'wa', うぃ: 'wi', うぇ: 'we', うぉ: 'wo', うぅ: 'wu',
  すぃ: 'si', ずぃ: 'zi', てぃ: 'ti', てゃ: 'tya', とぅ: 'tu', つぉ: 'tso',
  でぃ: 'di', どぅ: 'du', でゅ: 'dyu',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
} as const

export type JapanesePhoneLabel = typeof basic[keyof typeof basic] | typeof paired[keyof typeof paired]
export interface JapanesePhone {
  phone: JapanesePhoneLabel
  wordIndex: number
  /** UTF-16 offsets in the ORIGINAL lyric. A reading cannot assign individual
   * kanji to phones, so every phone refers to its complete original word. */
  sourceStart: number
  sourceEnd: number
  /** UTF-16 offsets in this variant's normalizedReading, not in the lyric. */
  readingStart: number
  readingEnd: number
}
export interface JapanesePhoneVariant {
  source: 'pronunciation' | 'reading' | 'surface'
  reading: string
  normalizedReading: string
  phones: JapanesePhone[]
}
export type UnsupportedJapaneseReason = 'number' | 'latin' | 'unknown-reading' | 'unsupported-reading' | 'symbol'
export interface UnsupportedJapaneseSpan {
  wordIndex: number
  sourceStart: number
  sourceEnd: number
  surface: string
  reason: UnsupportedJapaneseReason
}
export interface JapanesePhoneWord {
  wordIndex: number
  surface: string
  sourceStart: number
  sourceEnd: number
  /** Half-open indices in the primary phones array. An unsupported word has
   * an empty span: callers MUST check status before traversing a boundary. */
  phoneStart: number
  phoneEnd: number
  status: 'supported' | 'punctuation' | 'unsupported'
  /** Ordered dictionary alternatives, not an exponential full-line product.
   * ヲ/オ and シ/スィ remain different labels, not equivalence classes. */
  variants: JapanesePhoneVariant[]
}
export interface JapanesePhoneMapping {
  reason: 'mapped' | 'unsupported' | 'invalid-input' | 'surface-mismatch'
  /** True only if every lexical word is supported. Unsupported spans must
   * remain whole-song unknown competitors, never deleted from a search. */
  complete: boolean
  phones: JapanesePhone[]
  words: JapanesePhoneWord[]
  gaps: Array<{ sourceStart: number; sourceEnd: number; text: string }>
  unsupported: UnsupportedJapaneseSpan[]
}

const small = /^[ぁぃぅぇぉゃゅょゎ]$/u
const isKana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u
const isPunctuation = /^[\p{P}\s]+$/u
const hasNumber = /\p{Nd}/u
const hasLatin = /\p{Script=Latin}/u
const isJapaneseSurface = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{M}ー々〆]+$/u

function normalizeReading(value: string) {
  return value.normalize('NFKC').replace(/[\u30a1-\u30f6]/g,
    character => String.fromCharCode(character.charCodeAt(0) - 0x60))
}

/** All-or-nothing per word. Dropping a bad kana inside a word would shift its
 * apparent onset. In particular, orphan small kana and leading ー are unknown. */
function convertReading(reading: string, wordIndex: number, sourceStart: number, sourceEnd: number,
  source: JapanesePhoneVariant['source']): JapanesePhoneVariant | null {
  const normalizedReading = normalizeReading(reading)
  if (!normalizedReading || normalizedReading.length > 1000 || !isKana.test(normalizedReading)) return null
  const phones: JapanesePhone[] = []
  for (let position = 0; position < normalizedReading.length;) {
    const first = normalizedReading[position]
    const second = normalizedReading[position + 1]
    let phone: JapanesePhoneLabel | undefined, length = 1
    if (first === 'ー') {
      // A prolonged mark repeats the explicitly preceding vowel. N and cl
      // do not contain a vowel and cannot supply one. Never shorten the word.
      const previous = phones.at(-1)?.phone
      const last = previous?.at(-1)
      if (last && /^[aiueo]$/.test(last)) phone = last as 'a' | 'i' | 'u' | 'e' | 'o'
    } else if (second && small.test(second)) {
      phone = paired[`${first}${second}` as keyof typeof paired]
      length = 2
    } else {
      phone = basic[first as keyof typeof basic]
    }
    if (!phone) return null
    phones.push({ phone, wordIndex, sourceStart, sourceEnd, readingStart: position, readingEnd: position + length })
    position += length
  }
  return { source, reading, normalizedReading, phones }
}

/** Pure dictionary-reading frontend for experimental Japanese singing CTC.
 * It does not emit timestamps, infer Latin/number readings, fold vowel length,
 * or claim acoustic alignment. Raw text is required: analyzer word_position
 * can use code points rather than UTF-16 and cannot prove source coverage. */
export function mapJapanesePhones(rawText: string, input: JapaneseWord[]): JapanesePhoneMapping {
  const reject = (reason: 'invalid-input' | 'surface-mismatch'): JapanesePhoneMapping => ({
    reason, complete: false, phones: [], words: [], gaps: [], unsupported: [],
  })
  if (typeof rawText !== 'string' || rawText.length > 4000 || !Array.isArray(input) || input.length > 1200
    || Array.from(input).some(word => !word || typeof word.surface_form !== 'string' || !word.surface_form
      || word.surface_form.length > 1000 || [word.reading, word.pronunciation].some(value =>
        value !== undefined && (typeof value !== 'string' || value.length > 1000)))
    || input.reduce((length, word) => length + (word.reading?.length ?? 0) + (word.pronunciation?.length ?? 0), 0) > 16000) {
    return reject('invalid-input')
  }
  const result: JapanesePhoneMapping = { reason: 'mapped', complete: true, phones: [], words: [], gaps: [], unsupported: [] }
  let cursor = 0
  for (const [wordIndex, word] of input.entries()) {
    const surface = word.surface_form
    const sourceStart = rawText.indexOf(surface, cursor)
    const gap = sourceStart < 0 ? '' : rawText.slice(cursor, sourceStart)
    // Only omitted whitespace is an analyzer gap. Even punctuation must be
    // present as a word rather than silently hiding mapping mistakes.
    if (sourceStart < cursor || /\S/u.test(gap)) return reject('surface-mismatch')
    if (gap) result.gaps.push({ sourceStart: cursor, sourceEnd: sourceStart, text: gap })
    const sourceEnd = sourceStart + surface.length
    cursor = sourceEnd
    const phoneStart = result.phones.length
    const mapped: JapanesePhoneWord = { wordIndex, surface, sourceStart, sourceEnd,
      phoneStart, phoneEnd: phoneStart, status: 'supported', variants: [] }
    result.words.push(mapped)
    if (isPunctuation.test(surface)) { mapped.status = 'punctuation'; continue }

    let unsupported: UnsupportedJapaneseReason | undefined
    if (hasNumber.test(surface)) unsupported = 'number'
    else if (hasLatin.test(surface)) unsupported = 'latin'
    else if (!isJapaneseSurface.test(surface.normalize('NFKC'))) unsupported = 'symbol'
    else {
      const candidates: Array<{ source: JapanesePhoneVariant['source']; reading: string }> = []
      if (word.pronunciation && word.pronunciation !== '*') candidates.push({ source: 'pronunciation', reading: word.pronunciation })
      if (word.reading && word.reading !== '*') candidates.push({ source: 'reading', reading: word.reading })
      // Surface kana is a fallback only. Dictionary pronunciation can express
      // a particle's reading (ハ→ワ) and must not gain an invented spelling path.
      if (!candidates.length && isKana.test(normalizeReading(surface))) candidates.push({ source: 'surface', reading: surface })
      for (const candidate of candidates) {
        const variant = convertReading(candidate.reading, wordIndex, sourceStart, sourceEnd, candidate.source)
        // A supported alternative cannot prove that the explicit hypothesis
        // set is complete when another supplied reading is unrepresentable.
        // Do not silently drop that competitor and declare a unique path.
        if (!variant) { unsupported = 'unsupported-reading'; break }
        if (!mapped.variants.some(existing => existing.phones.map(phone => phone.phone).join('|')
          === variant.phones.map(phone => phone.phone).join('|'))) mapped.variants.push(variant)
      }
      if (!mapped.variants.length && !unsupported) unsupported = candidates.length ? 'unsupported-reading' : 'unknown-reading'
    }
    if (unsupported) {
      mapped.status = 'unsupported'
      mapped.variants = []
      result.unsupported.push({ wordIndex, sourceStart, sourceEnd, surface, reason: unsupported })
      result.complete = false
      result.reason = 'unsupported'
    } else {
      result.phones.push(...mapped.variants[0].phones)
      mapped.phoneEnd = result.phones.length
    }
  }
  const trailing = rawText.slice(cursor)
  if (/\S/u.test(trailing)) return reject('surface-mismatch')
  if (trailing) result.gaps.push({ sourceStart: cursor, sourceEnd: rawText.length, text: trailing })
  return result
}
