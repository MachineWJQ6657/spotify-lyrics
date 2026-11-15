/**
 * Find-in-lyrics for the main window (Ctrl+F). Matching ignores case, width
 * (full-width letters, half-width kana) and the hiragana/katakana distinction,
 * so "きみ" finds "キミ" and "love" finds "ＬＯＶＥ". Runs of spaces count as one.
 */
export function foldForFind(text: string): string {
  let folded = ''
  for (const char of text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()) {
    const code = char.codePointAt(0)!
    // Katakana ァ..ヶ to the hiragana 0x60 below it.
    folded += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char
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
