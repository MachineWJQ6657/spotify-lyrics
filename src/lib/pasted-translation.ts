import type { LyricTrack } from '../types'
import { isLyricCredit } from './lyric-metadata'
import { makeTrack } from './lyrics'

/**
 * A translation copied from a web page, put on a song's timed lines.
 *
 * No source the app can ask carries English translations (measured
 * 2026-11-27: none of 283 library songs had one), and the sites that hold
 * them answer browsers, not programs. So the listener copies the translation
 * from the page and the app lines it up.
 *
 * A pasted translation has no times, and its lines are seldom broken where
 * the song's are. The two texts are aligned the way parallel texts are (Gale
 * and Church 1993, with a dictionary as in hunalign): the cheapest way to pair
 * rows with lines, letting one stand for two here and there, where a pair is
 * cheap when the line is about as long as the row would translate to and,
 * above all, when it uses words a dictionary gives for the row's words.
 * Lengths alone are not enough for lyrics, whose lines are all about as long
 * as each other: on 65 songs with a known line-for-line English translation,
 * re-broken at random, 81% of rows were placed right by length and 96% with
 * the dictionary.
 */

const TIMESTAMP = /^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/
const SECTION_WORDS = 'verse|chorus|pre-?chorus|post-?chorus|bridge|intro|outro|hook|refrain|interlude|instrumental'
/** "[Verse 1]", "(Chorus)", "Bridge:" on a line of their own. */
const SECTION = new RegExp(`^(?:\\[[^\\]]*\\]|\\((?:${SECTION_WORDS})[^)]*\\)|(?:${SECTION_WORDS})\\s*\\d*\\s*:?)$`, 'i')
/** What a lyrics page puts around the words. */
const PAGE_NOISE = /^(?:\d+\s+contributors?\b.*|you might also like|\d*\s*embed|translations?)$/i

const KANA = /[぀-ヿ]/g
const HAN = /[㐀-鿿]/g
const LATIN = /[a-z]/gi
const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0

/** The original's own script left in the paste (a page that shows both): not part of the translation. */
function inOriginalScript(line: string, language: string) {
  const kana = count(line, KANA), han = count(line, HAN), latin = count(line, LATIN)
  if (language === 'zh-Hans') return kana > 0
  return kana + han > latin
}

export interface PastedText {
  /** Most lines carry an LRC time: the paste is a timed lyric file. */
  timed: boolean
  /** The translation's lines, grouped as the paste grouped them (blank lines between verses). */
  stanzas: string[][]
}

export function readPastedText(text: string, language: string): PastedText {
  const raw = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim())
  const filled = raw.filter(Boolean)
  const timed = filled.length >= 3 && filled.filter(line => TIMESTAMP.test(line)).length >= filled.length * .6
  const stanzas: string[][] = []
  let open: string[] | null = null
  for (const line of raw) {
    const words = line.replace(TIMESTAMP, '').trim()
    if (!words) { open = null; continue }
    // A section label starts a verse as a blank line does.
    if (SECTION.test(words)) { open = null; continue }
    if (PAGE_NOISE.test(words) || inOriginalScript(words, language)) continue
    if (!open) { open = []; stanzas.push(open) }
    open.push(words)
  }
  return { timed, stanzas: stanzas.filter(stanza => stanza.length) }
}

// ---- Alignment

/** How much a line says: letters, a Han character counting double (it is about two kana, or a short word). */
function weight(text: string) {
  let total = 0
  for (const character of text.normalize('NFKC')) {
    if (/[㐀-鿿]/.test(character)) total += 2
    else if (/[\p{L}\p{N}]/u.test(character)) total += 1
  }
  return total
}
const latinOf = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '')
const wordsOf = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Upper tail of the standard normal distribution (Abramowitz and Stegun 26.2.17). */
function upperTail(z: number) {
  const t = 1 / (1 + .2316419 * z)
  const density = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
  return density * t * (.31938153 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
}

/** The weights of the pairing, set on the 65 songs named above. */
export interface PastedTuning {
  /** The spread of a translation's length around the expected one, per unit of length. */
  lengthVariance: number
  /** One line standing for two is rarer than line for line; a line with no partner rarer still. */
  twoForOne: number
  unpaired: number
  /** A repeated line facing one seen for the first time. */
  repeatMismatch: number
  /** Words the song has in Latin letters found in the translation line. */
  latinAnchor: number
  sameLatinLine: number
  /** A repeated row paired with the line its earlier occurrence got. */
  sameAsBefore: number
  /** Per word of the translation line that a dictionary gives for a word of the row (rare words count for more), up to a cap. */
  lexical: number
  lexicalCap: number
}
export const PASTED_TUNING: PastedTuning = {
  lengthVariance: 2.6, twoForOne: 2.3, unpaired: 4.6, repeatMismatch: .7, latinAnchor: 3, sameLatinLine: 5, sameAsBefore: 1.5, lexical: 3, lexicalCap: 3
}

/** What the words of a row and of a translation line are about, as comparable sets (see ja-en-lexicon.ts). */
export interface LexicalReader { ofRow(text: string): Set<string>; ofLine(text: string): Set<string> }

function lengthCost(original: number, translated: number, ratio: number, variance: number) {
  if (!original && !translated) return 0
  const expected = translated / ratio
  const z = Math.abs(expected - original) / Math.sqrt(Math.max(original, expected, 1) * variance)
  return -Math.log(Math.max(2 * upperTail(z), 1e-9))
}

export interface PastedAlignment {
  /** The translation of each row, '' where it has none. */
  texts: string[]
  /** Every row got exactly one line of its own. */
  lineForLine: boolean
}

/**
 * `rows`: the sung lines in order. `stanzas`: the translation as pasted.
 * `lexical`: the dictionary, when there is one for the two languages.
 */
export function alignPastedLines(rows: string[], stanzas: string[][], lexical?: LexicalReader, tuning: PastedTuning = PASTED_TUNING): PastedAlignment {
  const lines = stanzas.flat()
  const n = rows.length, m = lines.length
  // As many lines as rows is line for line, unless the meaning can be checked: one line merged
  // and another split leave the count as it was and every line between them one row off.
  if (m === n && !lexical) return { texts: [...lines], lineForLine: true }
  if (!n || !m) return { texts: rows.map(() => ''), lineForLine: false }

  const rowWeight = rows.map(weight), lineWeight = lines.map(weight)
  const ratio = Math.max(.05, Math.max(1, lineWeight.reduce((sum, value) => sum + value, 0)) / Math.max(1, rowWeight.reduce((sum, value) => sum + value, 0)))
  const rowLatin = rows.map(latinOf), lineLatin = lines.map(latinOf)
  const rowKey = rows.map(wordsOf), lineKey = lines.map(wordsOf)
  const rowAllLatin = rows.map((_, index) => rowLatin[index].length >= 4 && rowLatin[index].length >= rowKey[index].length * .9)
  const repeats = (values: string[]) => { const seen = new Set<string>(); return values.map(value => { const again = seen.has(value); seen.add(value); return again }) }
  const rowRepeat = repeats(rowKey), lineRepeat = repeats(lineKey)
  const verseStart = new Set<number>()
  let at = 0
  for (const stanza of stanzas) { verseStart.add(at); at += stanza.length }

  // Shared meaning: a word of the line that the dictionary gives for a word of the row. A word found in
  // many lines of the translation says little about which line this is.
  const rowWords = lexical ? rows.map(row => lexical.ofRow(row)) : null
  const lineWords = lexical ? lines.map(line => lexical.ofLine(line)) : null
  const found = new Map<string, number>()
  for (const words of lineWords ?? []) for (const word of words) found.set(word, (found.get(word) ?? 0) + 1)
  const rarity = (word: string) => Math.log(1 + m / (found.get(word) ?? 1)) / Math.log(1 + m)
  const shared = (rowsOf: number[], linesOf: number[]) => {
    if (!rowWords || !lineWords) return 0
    let total = 0
    const counted = new Set<string>()
    for (const line of linesOf) for (const word of lineWords[line]) {
      if (counted.has(word) || !rowsOf.some(row => rowWords[row].has(word))) continue
      counted.add(word); total += rarity(word)
    }
    return Math.min(tuning.lexicalCap, total)
  }

  type Solution = { texts: string[]; pairs: Array<[number, number]> }
  /** `before`: the lines each row text was paired with in an earlier pass. */
  const solve = (before?: Map<string, Set<string>>): Solution => {
    const pair = (row: number, line: number, joined?: string) => {
      let cost = 0
      const latin = joined === undefined ? lineLatin[line] : latinOf(joined)
      if (rowLatin[row].length >= 4 && latin.includes(rowLatin[row])) cost -= rowAllLatin[row] && latin === rowLatin[row] ? tuning.sameLatinLine : tuning.latinAnchor
      if (rowRepeat[row] !== lineRepeat[line]) cost += tuning.repeatMismatch
      if (before && joined === undefined && before.get(rowKey[row])?.has(lineKey[line])) cost -= tuning.sameAsBefore
      return cost
    }
    const fit = (original: number, translated: number) => lengthCost(original, translated, ratio, tuning.lengthVariance)
    // best[i][j]: the cheapest pairing of the first i rows with the first j lines.
    const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity))
    const step = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
    best[0][0] = 0
    const offer = (i: number, j: number, cost: number, move: number) => { if (cost < best[i][j]) { best[i][j] = cost; step[i][j] = move } }
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        const here = best[i][j]
        if (here === Infinity) continue
        if (i < n && j < m) offer(i + 1, j + 1, here + fit(rowWeight[i], lineWeight[j]) + pair(i, j) - tuning.lexical * shared([i], [j]), 1)
        // One row, two lines of one verse.
        if (i < n && j + 1 < m && !verseStart.has(j + 1)) offer(i + 1, j + 2, here + tuning.twoForOne + fit(rowWeight[i], lineWeight[j] + lineWeight[j + 1]) + pair(i, j, `${lines[j]} ${lines[j + 1]}`) - tuning.lexical * shared([i], [j, j + 1]), 2)
        // Two rows, one line.
        if (i + 1 < n && j < m) offer(i + 2, j + 1, here + tuning.twoForOne + fit(rowWeight[i] + rowWeight[i + 1], lineWeight[j]) + pair(i, j) - tuning.lexical * shared([i, i + 1], [j]), 3)
        if (i < n) offer(i + 1, j, here + tuning.unpaired + fit(rowWeight[i], 0), 4)
        if (j < m) offer(i, j + 1, here + tuning.unpaired + fit(0, lineWeight[j]), 5)
      }
    }
    const texts = rows.map(() => '')
    const pairs: Array<[number, number]> = []
    const orphans: Array<{ row: number; text: string; first: boolean }> = []
    for (let i = n, j = m; i > 0 || j > 0;) {
      const move = step[i][j]
      if (move === 1) { texts[i - 1] = lines[j - 1]; pairs.push([i - 1, j - 1]); i--; j-- }
      else if (move === 2) { texts[i - 1] = `${lines[j - 2]} ${lines[j - 1]}`; i--; j -= 2 }
      else if (move === 3) { texts[i - 2] = lines[j - 1]; i -= 2; j-- }
      else if (move === 4) i--
      else { orphans.push({ row: Math.max(0, i - 1), text: lines[j - 1], first: i === 0 }); j-- }
    }
    // A line no row took still belongs to the song: it joins the row before it (before the first row, the first).
    for (const orphan of orphans.filter(item => !item.first).reverse()) texts[orphan.row] = texts[orphan.row] ? `${texts[orphan.row]} ${orphan.text}` : orphan.text
    for (const orphan of orphans.filter(item => item.first)) texts[0] = texts[0] ? `${orphan.text} ${texts[0]}` : orphan.text
    return { texts, pairs }
  }

  let solution = solve()
  // A chorus comes back with the same words in both texts. What the first pass paired
  // twice or more is taken as known in a second one, which pulls the other repeats into place.
  if (tuning.sameAsBefore > 0 && rowRepeat.some(Boolean) && lineRepeat.some(Boolean)) {
    const counts = new Map<string, number>()
    for (const [row, line] of solution.pairs) { const key = `${rowKey[row]}\u0000${lineKey[line]}`; counts.set(key, (counts.get(key) ?? 0) + 1) }
    const before = new Map<string, Set<string>>()
    for (const [row, line] of solution.pairs) {
      if ((counts.get(`${rowKey[row]}\u0000${lineKey[line]}`) ?? 0) < 2) continue
      if (!before.has(rowKey[row])) before.set(rowKey[row], new Set())
      before.get(rowKey[row])!.add(lineKey[line])
    }
    if (before.size) solution = solve(before)
  }
  return { texts: solution.texts, lineForLine: m === n && solution.pairs.length === n }
}

export interface PastedTranslation {
  track: LyricTrack
  /** Lines of the translation as pasted, and sung lines of the song. */
  lines: number
  rows: number
  /** How it was placed: by its own times, line for line, or by alignment. */
  placed: 'timed' | 'line-for-line' | 'aligned'
}

/** Stored labels of the languages a translation can be pasted for. */
const LABELS: Record<string, string> = { en: 'English', 'zh-Hans': '中文' } // i18n-ignore: stored track labels, localized where shown
export const PASTED_SOURCE = '粘贴的翻译' // i18n-ignore: stored source label, localized where shown
export const pastedTrackId = (language: string) => `pasted-${language}`

/**
 * The track a pasted translation becomes for a song, or null when the paste
 * holds too little to be one (fewer than three lines, or under a third of the song).
 */
export function pastedTranslationTrack(original: LyricTrack, text: string, language: string, lexical?: LexicalReader): PastedTranslation | null {
  const id = pastedTrackId(language)
  const label = LABELS[language] ?? language
  const read = readPastedText(text, language)
  const sung = original.lines.map((line, index) => ({ line, index })).filter(item => item.line.text.trim() && !isLyricCredit(item.line.text))
  const lines = read.stanzas.reduce((sum, stanza) => sum + stanza.length, 0)
  if (lines < 3 || lines < sung.length / 3) return null
  if (read.timed) {
    const lrc = text.replace(/\r\n?/g, '\n').split('\n').filter(line => !inOriginalScript(line.replace(TIMESTAMP, ''), language)).join('\n')
    const track = makeTrack(id, language, label, 'translation', lrc, PASTED_SOURCE)
    if (track.lines.length >= 3) return { track, lines: track.lines.length, rows: sung.length, placed: 'timed' }
  }
  const aligned = alignPastedLines(sung.map(item => item.line.text), read.stanzas, lexical)
  const texts = new Map(sung.map((item, position) => [item.index, aligned.texts[position]]))
  const track: LyricTrack = { id, language, label, kind: 'translation', source: PASTED_SOURCE,
    lines: original.lines.map((line, index) => ({ startMs: line.startMs, endMs: line.endMs, text: texts.get(index) ?? '' })) }
  return { track, lines, rows: sung.length, placed: aligned.lineForLine ? 'line-for-line' : 'aligned' }
}
