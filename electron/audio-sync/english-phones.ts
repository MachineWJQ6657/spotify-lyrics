/**
 * English pronunciations (CMUdict ARPAbet) approximated with RomajiASR
 * (Japanese mora) labels, for listening calibration only, the way a Japanese
 * ear hears a sung English word: CV morae, codas and cluster consonants as
 * consonant-only labels or an epenthetic mora. Each phone is a set of
 * acceptable labels joined with "|"; a leading "?" marks a phone the singer
 * may not articulate as its own mora (codas, diphthong tails).
 */

const VOWELS: Record<string, { head: string[]; tail?: string[] }> = {
  AA: { head: ['a', 'o'] }, AE: { head: ['a', 'e'] }, AH: { head: ['a', 'o', 'u'] }, AO: { head: ['o', 'a'] },
  AW: { head: ['a'], tail: ['u', 'o'] }, AY: { head: ['a'], tail: ['i', 'e'] }, EH: { head: ['e', 'a'] },
  ER: { head: ['a', 'o', 'u'] }, EY: { head: ['e'], tail: ['i'] }, IH: { head: ['i', 'e'] }, IY: { head: ['i'] },
  OW: { head: ['o'], tail: ['u', 'o'] }, OY: { head: ['o'], tail: ['i'] }, UH: { head: ['u', 'o'] }, UW: { head: ['u'] },
}
/** Romaji consonants for each ARPAbet consonant. */
const CONSONANTS: Record<string, string[]> = {
  B: ['b'], CH: ['ch'], D: ['d'], DH: ['d', 'z'], F: ['f', 'h'], G: ['g'], HH: ['h'], JH: ['j'], K: ['k'], L: ['r'],
  M: ['m'], N: ['n'], NG: [], P: ['p'], R: ['r'], S: ['s'], SH: ['sh'], T: ['t'], TH: ['s', 't'], V: ['v', 'b'],
  W: ['w'], Y: ['y'], Z: ['z'], ZH: ['j'],
}
/** A consonant with no vowel after it: its own label, or the epenthetic mora katakana adds. */
const CODA: Record<string, string[]> = {
  B: ['b', 'bu'], CH: ['ch', 'chi'], D: ['d', 'do'], DH: ['z', 'zu', 'd'], F: ['f', 'fu'], G: ['g', 'gu'], HH: ['h'],
  JH: ['j', 'ji'], K: ['k', 'ku'], L: ['r', 'ru'], M: ['m', 'mu', 'N'], N: ['N'], NG: ['N', 'gu'], P: ['p', 'pu'],
  R: ['r', 'ru'], S: ['s', 'su'], SH: ['sh', 'shu'], T: ['t', 'to'], TH: ['s', 'su'], V: ['v', 'vu', 'bu'],
  W: ['w', 'u'], Y: ['y', 'i'], Z: ['z', 'zu'], ZH: ['j', 'ji'],
}

function join(labels: Iterable<string>, vocabulary: ReadonlySet<string>) {
  const kept = [...new Set(labels)].filter(label => vocabulary.has(label))
  return kept.length ? kept.join('|') : null
}

/**
 * Phones for one ARPAbet pronunciation ("L AH1 V"), or null when it cannot be
 * mapped. Post-vocalic R is dropped (non-rhotic singing lengthens the vowel).
 */
export function arpabetPhones(pronunciation: string, vocabulary: ReadonlySet<string>): string[] | null {
  const symbols = pronunciation.trim().split(/\s+/).map(item => item.replace(/[0-2]$/, '').toUpperCase())
  if (!symbols.length || symbols.some(item => !(item in VOWELS) && !(item in CONSONANTS))) return null
  const phones: string[] = []
  for (let i = 0; i < symbols.length; i += 1) {
    const symbol = symbols[i]
    const vowel = VOWELS[symbol]
    if (vowel) {
      const head = join(vowel.head, vocabulary)
      if (!head) return null
      phones.push(head)
      if (vowel.tail) { const tail = join(vowel.tail, vocabulary); if (tail) phones.push(`?${tail}`) }
      continue
    }
    const next = VOWELS[symbols[i + 1]]
    if (next && CONSONANTS[symbol].length) {
      const options: string[] = []
      for (const c of CONSONANTS[symbol]) for (const v of next.head) options.push(`${c}${v}`)
      // Y/W glides before i/u: the vowel alone.
      if (symbol === 'Y' || symbol === 'W') options.push(...next.head)
      const head = join(options, vocabulary)
      if (head) {
        phones.push(head)
        if (next.tail) { const tail = join(next.tail, vocabulary); if (tail) phones.push(`?${tail}`) }
        i += 1
        continue
      }
    }
    const previous = symbols[i - 1]
    if (symbol === 'R' && previous && VOWELS[previous]) continue
    const coda = join(CODA[symbol], vocabulary)
    if (coda) phones.push(`?${coda}`)
  }
  // A word must contain a sounded mora (not only optional consonants).
  if (!phones.some(phone => !phone.startsWith('?'))) return null
  return phones
}
