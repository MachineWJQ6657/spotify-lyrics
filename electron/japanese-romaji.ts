import type { JapaneseWord } from './romanizer'

/** Keep readings together until conjugations have been joined. Romanizing
 * 待っ and て separately loses the pending small tsu before they can combine.
 * This function is also serialized into the dictionary worker, so it must
 * have no runtime dependencies other than the explicitly supplied converter. */
export function romanizeJapaneseWords(tokens: JapaneseWord[], convert: (reading: string) => string): string {
  const words: string[] = []
  for (const token of tokens) {
    const reading = (token.pronunciation || token.reading || token.surface_form).trim()
    if (!reading) continue
    const joinsConjugation = token.pos === '助動詞'
      || (token.pos === '助詞' && token.pos_detail_1 === '接続助詞' && /^(て|で)$/.test(token.surface_form))
    const punctuation = token.pos === '記号'
    // A token-final closure belongs with the following kana even when the
    // analyzer labels that following token as something other than a suffix.
    const pendingClosure = /[っッ]$/.test(words.at(-1) ?? '') && /^[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reading)
    if ((joinsConjugation || punctuation || pendingClosure) && words.length) words[words.length - 1] += reading
    else words.push(reading)
  }
  return words.map(reading => convert(reading).trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
