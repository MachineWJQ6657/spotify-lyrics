import type { LyricLine } from '../../src/types'
import type { HeardToken } from './lyric-aligner'
import type { LyricLandmark, LyricLandmarks } from './lyric-landmarks'

/** Structural subset of a Kuromoji result. Positions supplied by an analyzer
 * are deliberately ignored: surfaces must account for the original string. */
export interface JapaneseWord {
  surface_form: string
  reading?: string
  pronunciation?: string
  pos?: string
  pos_detail_1?: string
}

interface Chunk {
  text: string
  start: number
  end: number
  tokenIds: number[]
  onset: boolean
  completeEnd: boolean
  unknownHan: boolean
}
interface Mapping { text: string; chunks: Chunk[]; characterWords: number[] }
const letter = /[\p{L}\p{N}]/u
const han = /\p{Script=Han}/u
const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u
const smallKana = /[ぁぃぅぇぉゃゅょゎ]/u
const latin = /[\p{Script=Latin}\p{N}]+/gu
const empty = (): LyricLandmarks => ({ reason: 'insufficient-words', points: [] })

function vowel(character: string) {
  if ('あかがさざただなはばぱまやらわぁゃゎ'.includes(character)) return 'あ'
  if ('いきぎしじちぢにひびぴみりゐぃ'.includes(character)) return 'い'
  if ('うくぐすずつづぬふぶぷむゆるぅゅゔ'.includes(character)) return 'う'
  if ('えけげせぜてでねへべぺめれゑぇ'.includes(character)) return 'え'
  if ('おこごそぞとどのほぼぽもよろをぉょ'.includes(character)) return 'お'
  return ''
}

/** Orthographic readings share one conservative search alphabet. Every
 * collision introduced here is also considered by the whole-song ambiguity
 * search; none of these folds can make a repeated phrase unique. */
function phonetic(text: string, preceding = '') {
  const normalized = text.normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, value => String.fromCharCode(value.charCodeAt(0) - 0x60))
    .replace(/ぢ/g, 'じ').replace(/づ/g, 'ず').replace(/ゐ/g, 'い').replace(/ゑ/g, 'え')
    .replace(/[^\p{L}\p{N}ー]/gu, '')
  let result = ''
  for (const character of normalized) {
    const previousVowel = vowel(result.at(-1) ?? preceding.at(-1) ?? '')
    if (character === 'ー') result += previousVowel || 'ー'
    else if (character === 'う' && previousVowel === 'お') result += 'お'
    else if (character === 'い' && previousVowel === 'え') result += 'え'
    else result += character
  }
  return result
}

function morae(text: string) {
  return [...text].reduce((sum, character) => sum + Number(kana.test(character) && !smallKana.test(character)), 0)
}

function ignored(text: string) { return !letter.test(text) }

function mapWords(raw: string, words: JapaneseWord[], tokens?: HeardToken[]): Mapping | null {
  if (!Array.isArray(words) || words.length > 1200) return null
  let cursor = 0, tokenCursor = 0
  const spans = (tokens ?? []).map((token, tokenId) => {
    const start = tokenCursor
    tokenCursor += token.text.length
    const leading = token.text.search(/[\p{L}\p{N}]/u)
    const trailing = token.text.match(/[\p{L}\p{N}][^\p{L}\p{N}]*$/u)
    return { tokenId, start, end: tokenCursor, significantStart: leading < 0 ? -1 : start + leading,
      significantEnd: trailing ? tokenCursor - trailing[0].length + trailing[0].match(/[\p{L}\p{N}]/u)![0].length : -1 }
  })
  const chunks: Chunk[] = []
  const characterWords: number[] = []
  let text = ''
  for (const word of words) {
    if (!word || typeof word.surface_form !== 'string' || !word.surface_form.length) return null
    const surface = word.surface_form
    const start = raw.indexOf(surface, cursor), end = start + surface.length
    if (start < cursor || !ignored(raw.slice(cursor, start))) return null
    cursor = end
    if (ignored(surface)) continue
    const knownReading = (han.test(surface) || kana.test(surface))
      ? [word.pronunciation, word.reading].find(value => typeof value === 'string' && kana.test(value)) : undefined
    const unknownHan = han.test(surface) && !knownReading
    const value = phonetic(knownReading ?? surface, text)
    if (!value) return null
    const references = spans.filter(span => span.start < end && span.end > start && span.significantStart !== -1)
    const first = references[0], last = references.at(-1)
    chunks.push({ text: value, start, end, tokenIds: references.map(span => span.tokenId), unknownHan,
      onset: !!first && first.significantStart === start,
      completeEnd: !!last && last.significantEnd === end })
    for (let index = 0; index < value.length; index++) characterWords.push(chunks.length - 1)
    text += value
    if (text.length > (tokens ? 2400 : 1800)) return null
  }
  if (!ignored(raw.slice(cursor))) return null
  return { text, chunks, characterWords }
}

interface Work { cells: number; exhausted: boolean }
/** Anchored, banded edit distance. It may adjust the END of a phrase, never
 * move its beginning. The global work budget also covers ambiguity checks. */
function hit(expected: string, text: string, score: number, work: Work) {
  const edits = Math.floor(expected.length * (1 - score) + 1e-8)
  if (text.length < expected.length - edits) return null
  const width = Math.min(text.length, expected.length + edits)
  let previous = new Uint16Array(width + 1).fill(1000)
  for (let col = 0; col <= Math.min(width, edits); col++) previous[col] = col
  for (let row = 1; row <= expected.length; row++) {
    const next = new Uint16Array(width + 1).fill(1000)
    if (row <= edits) next[0] = row
    let minimum = 1000
    for (let col = Math.max(1, row - edits); col <= Math.min(width, row + edits); col++) {
      if (++work.cells > 4_000_000) { work.exhausted = true; return null }
      next[col] = Math.min(previous[col] + 1, next[col - 1] + 1,
        previous[col - 1] + Number(expected[row - 1] !== text[col - 1]))
      minimum = Math.min(minimum, next[col])
    }
    if (minimum > edits) return null
    previous = next
  }
  let end = Math.max(1, expected.length - edits)
  for (let col = end + 1; col <= width; col++) if (previous[col] < previous[end]) end = col
  return previous[end] <= edits ? { end, score: 1 - previous[end] / expected.length } : null
}

/** Japanese reading fallback, with original token probabilities and approximate
 * DTW points intact. A word spanning several ASR tokens refers to ALL of them;
 * reading characters never receive subdivided or interpolated timestamps. */
export function extractPhoneticLandmarks(
  tokens: HeardToken[], lines: LyricLine[], durationMs: number,
  heardWords: JapaneseWord[], sourceWords: JapaneseWord[][],
): LyricLandmarks {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 15000
    || !Array.isArray(tokens) || !tokens.length || tokens.length > 600
    || !Array.isArray(lines) || lines.length > 400 || !Array.isArray(sourceWords) || sourceWords.length !== lines.length
    || lines.some(line => !line || typeof line.text !== 'string' || line.text.length > 500)
    || lines.reduce((sum, line) => sum + line.text.length, 0) > 16000) return empty()
  let previous = -1, rawLength = 0
  for (const token of tokens) {
    if (!token || typeof token.text !== 'string' || token.timing !== 'dtw' || !token.endIsUpperBound
      || !Number.isFinite(token.startMs) || token.startMs < previous || token.startMs < 0 || token.startMs >= durationMs
      || !Number.isFinite(token.endMs) || token.endMs <= token.startMs || token.endMs > durationMs + 100
      || !Number.isFinite(token.probability) || token.probability < 0 || token.probability > 1) return empty()
    previous = token.startMs
    rawLength += token.text.length
    if (rawLength > 4000) return empty()
  }
  const heard = mapWords(tokens.map(token => token.text).join(''), heardWords, tokens)
  if (!heard || heard.text.length < 8) return empty()
  const sources = lines.map((line, index) => mapWords(line.text, sourceWords[index]))
  if (sources.some((source, index) => !source && letter.test(lines[index].text))) return empty()
  // An unreadable source line could be a homophonic competitor. It must not
  // silently disappear from a search claiming uniqueness over the whole song.
  if (sources.some(source => source?.chunks.some(chunk => chunk.unknownHan))) return empty()
  if (sources.reduce((sum, source) => sum + (source?.text.length ?? 0), 0) > 32000) return empty()
  const work: Work = { cells: 0, exhausted: false }
  const points: LyricLandmark[] = []
  let ambiguous = false
  for (const [lineIndex, source] of sources.entries()) {
    if (!source || source.chunks.some(chunk => chunk.unknownHan) || source.chunks.length < 2
      || !Number.isFinite(lines[lineIndex].startMs) || lines[lineIndex].startMs < 0 || lines[lineIndex].startMs > 600000) continue
    const count = morae(source.text)
    const short = count >= 8 && count <= 15 && kana.test(source.text)
    if (!short && count < 16) continue
    const boundaries: number[] = []
    let prefixLength = 0
    for (const [index, chunk] of source.chunks.entries()) {
      prefixLength += chunk.text.length
      const prefixMorae = morae(source.text.slice(0, prefixLength))
      if (index > 0 && (short ? prefixLength === source.text.length : prefixMorae >= 16 && prefixMorae <= 40)
        && prefixLength <= 80) boundaries.push(prefixLength)
    }
    const candidates: Array<LyricLandmark & { prefix: string }> = []
    let heardStart = 0
    for (const chunk of heard.chunks) {
      const start = heardStart
      heardStart += chunk.text.length
      if (!chunk.onset || chunk.unknownHan || heard.text.slice(start, start + 3) !== source.text.slice(0, 3)) continue
      for (const length of boundaries.slice().reverse()) {
        const prefix = source.text.slice(0, length)
        const match = hit(prefix, heard.text.slice(start), short ? 1 : .94, work)
        if (work.exhausted) return empty()
        if (!match) continue
        const finalCharacter = start + match.end - 1
        const lastWordIndex = heard.characterWords[finalCharacter]
        const firstWordIndex = heard.characterWords[start]
        if (lastWordIndex === undefined || lastWordIndex <= firstWordIndex
          || heard.characterWords[finalCharacter + 1] === lastWordIndex) continue
        const selectedWords = heard.chunks.slice(firstWordIndex, lastWordIndex + 1)
        if (selectedWords.some(word => word.unknownHan) || !selectedWords.at(-1)!.completeEnd
          || heard.text.slice(start, start + match.end).slice(-2) !== prefix.slice(-2)
          || (prefix.match(latin) ?? []).join('|') !== (heard.text.slice(start, start + match.end).match(latin) ?? []).join('|')) continue
        const ids = [...new Set(selectedWords.flatMap(word => word.tokenIds))].sort((a, b) => a - b)
        if (!ids.length) continue
        const original = ids.map(index => tokens[index]), first = original[0], last = original.at(-1)!
        if (first.startMs < 150 || last.startMs > durationMs - 350
          || first.probability < (short ? .85 : .65) || last.probability < (short ? .85 : .65)
          || original.some(token => token.probability < (short ? .75 : .5))
          || original.reduce((sum, token) => sum + token.probability, 0) / original.length < (short ? .9 : .8)
          || new Set(original.map(token => token.startMs)).size < (short ? 4 : 3)
          || last.startMs - first.startMs < (short ? 700 : 500)) continue
        candidates.push({ lineIndex, sourceMs: lines[lineIndex].startMs, heardMs: first.startMs, score: match.score, prefix })
        break
      }
      if (candidates.length > 1) break
    }
    if (!candidates.length) continue
    if (candidates.length > 1) { ambiguous = true; continue }
    const candidate = candidates[0]
    const competitorScore = Math.min(candidate.score - .08, 1 - 1 / candidate.prefix.length)
    let competing = false
    for (const [otherIndex, other] of sources.entries()) {
      if (!other) continue
      // Every other line start is checked, even with different initial sounds.
      // Internal alternatives must start a real source word: a position inside
      // one dictionary word's reading has no independently observed onset.
      const starts = [0]
      let position = 0
      for (const chunk of other.chunks.slice(0, -1)) { position += chunk.text.length; starts.push(position) }
      for (const offset of starts) {
        if (otherIndex === lineIndex && offset === 0) continue
        // Do not let the matching line's own overlapping tail compete merely
        // because dropping its first short word fits the edit allowance. A
        // different line (or a later, disjoint phrase in this line) may really
        // omit one sound, however, and must be checked by the same distance
        // rule as an equal-length alternative.
        const remaining = other.text.length - offset
        if (otherIndex === lineIndex && offset > 0 && offset < candidate.prefix.length
          && remaining < candidate.prefix.length) continue
        if (hit(candidate.prefix, other.text.slice(offset), competitorScore, work)) { competing = true; break }
        if (work.exhausted) return empty()
      }
      if (competing) break
    }
    if (competing) { ambiguous = true; continue }
    points.push({ lineIndex, sourceMs: candidate.sourceMs, heardMs: candidate.heardMs, score: candidate.score })
  }
  if (points.some((point, index) => points.some((other, otherIndex) => index !== otherIndex && Math.abs(point.heardMs - other.heardMs) < 150))) {
    return { reason: 'ambiguous', points: [] }
  }
  return { reason: points.length ? 'matched' : ambiguous ? 'ambiguous' : 'insufficient-words', points }
}
