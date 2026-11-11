import type { JapaneseWord } from './romanizer'

/** Lyrics sometimes print the sung reading of an unusual kanji in brackets:
 * 翅（はね）, 辛（つら）. That reading is authoritative for romanization, so the
 * kanji run plus its bracket is replaced by the kana before dictionary
 * analysis. Self-contained: serialized into the dictionary worker. */
export function applyFuriganaReadings(line: string): string {
  return line.replace(/[\p{Script=Han}々]+[（(]([\p{Script=Hiragana}\p{Script=Katakana}ー]+)[)）]/gu, '$1')
}

/** Keep readings together until conjugations have been joined. Romanizing
 * 待っ and て separately loses the pending small tsu before they can combine.
 * This function is also serialized into the dictionary worker, so it must
 * have no runtime dependencies other than the explicitly supplied converter
 * (every table below lives inside the function body for that reason). */
export function romanizeJapaneseWords(tokens: JapaneseWord[], convert: (reading: string) => string): string {
  // IPADIC splits number+counter words and a few lyric words into pieces whose
  // isolated readings are wrong (一人 → イチ+ニン, 精々 → キヨシ+々). Checked
  // against NetEase's human romaji across a real 84-song playlist.
  const compounds: Record<string, string> = {
    一人: 'ヒトリ', 二人: 'フタリ', 一回: 'イッカイ', 一度: 'イチド', 一つ: 'ヒトツ', 二つ: 'フタツ',
    精々: 'セイゼイ', 幽体: 'ユウタイ', 夜風: 'ヨカゼ'
  }
  // Single-kanji nouns that IPADIC reads with an on'yomi when they stand alone.
  const standalone: Record<string, string> = { 波: 'ナミ', 土: 'ツチ' }
  const demonstratives = new Set(['あんな', 'こんな', 'そんな', 'どんな'])
  const merged: JapaneseWord[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    let compound: JapaneseWord | undefined
    for (let width = 3; width >= 2 && !compound; width -= 1) {
      const slice = tokens.slice(index, index + width)
      const surface = slice.map(token => token.surface_form).join('')
      if (slice.length === width && compounds[surface]) {
        compound = { surface_form: surface, reading: compounds[surface], pos: '名詞' }
        index += width - 1
      }
    }
    merged.push(compound ?? tokens[index])
  }
  // Reading (not pronunciation) keeps kanji long vowels as written: 太陽 is
  // "taiyou", not "taiyoo". Particles still follow pronunciation (は→wa, へ→e).
  const readingOf = (token: JapaneseWord, previous: JapaneseWord | undefined, next: JapaneseWord | undefined) => {
    if (token.surface_form === '風' && previous && demonstratives.has(previous.surface_form)) return 'フウ'
    // 何だ/何で/何の are sung "nan da", "nan de", "nan no".
    if (token.surface_form === '何' && /^[ダデノド]/.test(next?.reading ?? next?.pronunciation ?? '')) return 'ナン'
    if (token.pos === '名詞' && standalone[token.surface_form]) return standalone[token.surface_form]
    if (token.pos === '助詞') return token.pronunciation || token.reading || token.surface_form
    return token.reading || token.pronunciation || token.surface_form
  }
  const words: string[] = []
  let previousReading = ''
  for (let index = 0; index < merged.length; index += 1) {
    const token = merged[index]
    if (token.surface_form === '々') {
      // The iteration mark repeats a preceding single kanji; never print it
      // raw. After a longer word its reading is unknown, so it is dropped.
      const previous = merged[index - 1]?.surface_form ?? ''
      if (words.length && previousReading && /^\p{Script=Han}$/u.test(previous)) words[words.length - 1] += previousReading
      continue
    }
    const reading = readingOf(token, merged[index - 1], merged[index + 1]).trim()
    if (!reading) continue
    previousReading = reading
    // Inflection stays in one word: 満たさ+れ+ない → mitasarenai, なれ+ば → nareba.
    // Contracted ている/ていく (広げ+て+た, 歌っ+てる, 忘れ+て+く) are one sung word.
    const contraction = token.pos === '動詞' && token.pos_detail_1 === '非自立'
      && (/^[てで]/.test(token.surface_form) || (/^[てで]$/.test(merged[index - 1]?.surface_form ?? '') && /^[くる]$/.test(token.surface_form)))
    const joinsConjugation = token.pos === '助動詞' || contraction
      || (token.pos === '動詞' && token.pos_detail_1 === '接尾')
      || (token.pos === '助詞' && token.pos_detail_1 === '接続助詞' && /^(て|で|ば)$/.test(token.surface_form))
    const punctuation = token.pos === '記号'
    // A token-final closure belongs with the following kana even when the
    // analyzer labels that following token as something other than a suffix;
    // a token that itself starts with a small tsu (っけ) closes the previous one.
    const pendingClosure = /[っッ]$/.test(words.at(-1) ?? '') && /^[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reading)
    const leadingClosure = /^[っッ]/.test(reading)
    if ((joinsConjugation || punctuation || pendingClosure || leadingClosure) && words.length) words[words.length - 1] += reading
    else words.push(reading)
  }
  return words.map(reading => convert(reading).trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
