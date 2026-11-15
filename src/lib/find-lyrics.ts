/**
 * Find-in-lyrics for the main window (Ctrl+F). Matching ignores case, width
 * (full-width letters, half-width kana), the hiragana/katakana distinction,
 * Latin accents and the shape of apostrophes and quotes, so "きみ" finds "キミ",
 * "love" finds "ＬＯＶＥ", "cafe" finds "café" and a typed don't finds the
 * typographic "don’t" that lyric files use. Runs of spaces count as one.
 */
export function foldForFind(text: string): string {
  // Decompose and drop the combining accents U+0300..U+036F. The kana voicing
  // marks (U+3099, U+309A) are outside that range and recompose below, so が
  // still does not match か.
  let plain = ''
  for (const char of text.normalize('NFKD')) {
    const code = char.codePointAt(0)!
    if (code < 0x300 || code > 0x36f) plain += char
  }
  let folded = ''
  for (const char of plain.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()) {
    const code = char.codePointAt(0)!
    // ‘ ’ ʼ ` to the apostrophe, “ ” „ to the quotation mark a keyboard types.
    if (code === 0x2018 || code === 0x2019 || code === 0x2bc || code === 0x60) folded += "'"
    else if (code === 0x201c || code === 0x201d || code === 0x201e) folded += '"'
    // Katakana ァ..ヶ to the hiragana 0x60 below it.
    else folded += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char
  }
  return folded
}

/** Basic Latin through Latin Extended-B: romaji and English, no kana or kanji. */
const latinOnly = (text: string) => [...text].every(char => char.codePointAt(0)! < 0x250)
const withoutSpaces = (text: string) => text.replace(/ /g, '')

/**
 * Indexes of the rows where any of the row's texts (original, romaji,
 * translation) contains the query. Spaces separate words in romaji and
 * English, so there they must match ("ana" does not find "ga nan"); a query
 * with kana or kanji ignores them ("繕って繕って" finds "繕って 繕って").
 */
export function findLineMatches(rows: string[][], query: string): number[] {
  const needle = foldForFind(query)
  if (!needle) return []
  const spaceless = latinOnly(needle) ? '' : withoutSpaces(needle)
  const matches: number[] = []
  rows.forEach((texts, index) => {
    if (texts.some(text => {
      const folded = foldForFind(text)
      return folded.includes(needle) || Boolean(spaceless) && withoutSpaces(folded).includes(spaceless)
    })) matches.push(index)
  })
  return matches
}

/** The match to show after stepping forward or back; wraps around both ends. */
export function stepMatch(cursor: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0
  return ((Math.min(cursor, count - 1) + direction) % count + count) % count
}

/** First match at or after the line being sung, so a search starts near where the song is. */
export function nearestMatch(matches: number[], activeIndex: number): number {
  const at = matches.findIndex(index => index >= activeIndex)
  return at < 0 ? 0 : at
}
