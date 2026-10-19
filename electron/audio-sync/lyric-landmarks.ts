import type { LyricLine } from '../../src/types'
import type { HeardToken } from './lyric-aligner'

export interface LyricLandmark {
  lineIndex: number
  heardMs: number
  sourceMs: number
  score: number
}
export interface LyricLandmarks {
  reason: 'matched' | 'insufficient-words' | 'ambiguous'
  points: LyricLandmark[]
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase()
  .replace(/[\u30a1-\u30f6]/g, letter => String.fromCharCode(letter.charCodeAt(0) - 0x60))
  .replace(/[^\p{L}\p{N}]/gu, '')

/** Compare a prefix at an already identified start. Unlike a substring search,
 * this cannot quietly move a matching internal phrase to the line's start. */
function prefixHit(expected: string, text: string, minimumScore: number) {
  const allowance = Math.ceil(expected.length * (1 - minimumScore))
  const length = Math.min(text.length, expected.length + allowance)
  if (length < expected.length - allowance) return null
  let previous = Uint16Array.from({ length: length + 1 }, (_, index) => index)
  for (let row = 1; row <= expected.length; row++) {
    const next = new Uint16Array(length + 1)
    next[0] = row
    for (let col = 1; col <= length; col++) next[col] = Math.min(previous[col] + 1,
      next[col - 1] + 1, previous[col - 1] + Number(expected[row - 1] !== text[col - 1]))
    previous = next
  }
  let end = Math.max(2, expected.length - allowance)
  for (let col = end + 1; col <= length; col++) if (previous[col] < previous[end]) end = col
  const score = 1 - previous[end] / expected.length
  return score >= minimumScore ? { end, score } : null
}

/** Extract independent, unique ORIGINAL LINE STARTS from a short audio block.
 * A point has no local rate or guessed block-end position. Consumers must fit
 * several non-overlapping blocks before using these approximate DTW times.
 * Neither this function nor its ambiguity check takes a playback position. */
export function extractLyricLandmarks(tokens: HeardToken[], lines: LyricLine[], durationMs: number): LyricLandmarks {
  const empty = (): LyricLandmarks => ({ reason: 'insufficient-words', points: [] })
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 15000
    || !Array.isArray(tokens) || tokens.length > 600 || !Array.isArray(lines) || lines.length > 400
    || lines.some(line => !line || typeof line.text !== 'string' || line.text.length > 500)
    || lines.reduce((sum, line) => sum + line.text.length, 0) > 16000) return empty()
  const characters: Array<{ token: HeardToken; offset: number }> = []
  let heard = '', previous = -1
  for (const token of tokens) {
    if (!token || typeof token.text !== 'string' || !Number.isFinite(token.startMs)
      || !Number.isFinite(token.probability) || token.startMs < previous || token.startMs < 0
      || token.startMs >= durationMs || token.probability < 0 || token.probability > 1) return empty()
    previous = token.startMs
    const text = normalize(token.text)
    heard += text
    if (heard.length > 800) return empty()
    for (let offset = 0; offset < text.length; offset++) characters.push({ token, offset })
  }
  if (heard.length < 8) return empty()
  const source = lines.map(line => normalize(line.text))
  const occurrences = new Map<string, Array<{ lineIndex: number; offset: number }>>()
  for (const [lineIndex, text] of source.entries()) for (let offset = 0; offset < text.length - 1; offset++) {
    const first = text.slice(offset, offset + 2), positions = occurrences.get(first) ?? []
    positions.push({ lineIndex, offset }); occurrences.set(first, positions)
  }
  const points: LyricLandmark[] = []
  let ambiguous = false
  let comparisons = 0
  for (const [lineIndex, text] of source.entries()) {
    // Short Japanese/CJK lines supply evidence only when the ENTIRE original
    // line is heard exactly. These stricter gates never apply to an arbitrary
    // 8–11-character prefix of a longer line, or to short Latin phrases.
    const shortLine = text.length >= 8 && text.length <= 11
      && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]+$/u.test(text)
    if ((!shortLine && text.length < 12) || text.length > 160 || !Number.isFinite(lines[lineIndex].startMs)
      || lines[lineIndex].startMs < 0 || lines[lineIndex].startMs > 600000) continue
    const starts = characters.flatMap((item, index) => item.offset === 0
      && item.token.timing === 'dtw' && item.token.endIsUpperBound
      && item.token.probability >= (shortLine ? .85 : .65) && item.token.startMs >= 150
      && heard.slice(index, index + 2) === text.slice(0, 2) ? [index] : [])
    const matches: Array<LyricLandmark & { prefix: string; heardStart: number }> = []
    for (const start of starts) {
      // Try the longest reliable prefix first. A partially transcribed long
      // source line can supply a point without claiming its missing text.
      for (let length = Math.min(32, text.length); length >= (shortLine ? text.length : 12); length--) {
        // Pathological repeated text must abstain within a bounded amount of
        // work instead of blocking the desktop process during recognition.
        if (++comparisons > 12000) return empty()
        const prefix = text.slice(0, length), hit = prefixHit(prefix, heard.slice(start), shortLine ? 1 : .92)
        if (!hit) continue
        const matched = characters.slice(start, start + hit.end), first = matched[0].token, last = matched.at(-1)!.token
        if (first.startMs < 150 || last.startMs > durationMs - 350
          || matched.some(item => item.token.timing !== 'dtw' || !item.token.endIsUpperBound
            || item.token.probability < (shortLine ? .75 : .5))
          || first.probability < (shortLine ? .85 : .65) || last.probability < (shortLine ? .85 : .65)
          || matched.at(-1)!.offset !== normalize(last.text).length - 1
          || heard.slice(start, start + hit.end).slice(-2) !== prefix.slice(-2)
          || new Set(matched.map(item => item.token.startMs)).size < (shortLine ? 4 : 3)
          || last.startMs - first.startMs < (shortLine ? 700 : 500)
          || matched.reduce((sum, item) => sum + item.token.probability, 0) / matched.length < (shortLine ? .9 : .8)) continue
        matches.push({ lineIndex, sourceMs: lines[lineIndex].startMs, heardMs: first.startMs,
          score: hit.score, prefix, heardStart: start })
        break
      }
      if (matches.length > 1) break
    }
    if (!matches.length) continue
    // Repeated ASR occurrences cannot be resolved by picking the first one.
    if (matches.length > 1) { ambiguous = true; continue }
    const candidate = matches[0]
    // A one-character alternative must remain ambiguous even when short text
    // makes its normalized edit score fall just below the general margin.
    const competitorScore = Math.min(candidate.score - .08, 1 - 1 / candidate.prefix.length)
    const positions = [...source.map((_other, otherIndex) => ({ lineIndex: otherIndex, offset: 0 })),
      ...(shortLine
        ? source.flatMap((other, otherIndex) => Array.from({ length: Math.max(0, other.length - text.length) },
          (_, offset) => ({ lineIndex: otherIndex, offset: offset + 1 })))
        : (occurrences.get(candidate.prefix.slice(0, 2)) ?? []).filter(position => position.offset > 0))]
    // Different source line starts are always checked, including alternatives
    // whose first two characters differ. Short full lines additionally check
    // every internal position, including one-character lexical alternatives.
    const competing = positions.some(position => {
      if (position.lineIndex === lineIndex && position.offset === 0) return false
      if (++comparisons > 12000) return true
      return prefixHit(candidate.prefix, source[position.lineIndex].slice(position.offset), competitorScore) !== null
    })
    if (comparisons > 12000) return empty()
    if (competing) { ambiguous = true; continue }
    points.push({ lineIndex, sourceMs: candidate.sourceMs, heardMs: candidate.heardMs, score: candidate.score })
  }
  // Two different source starts cannot share one heard onset. Such an overlap
  // is conflicting lexical evidence even when both happen to look unique.
  if (points.some((point, index) => points.some((other, order) => order !== index
    && Math.abs(point.heardMs - other.heardMs) < 150))) return { reason: 'ambiguous', points: [] }
  return { reason: points.length ? 'matched' : ambiguous ? 'ambiguous' : 'insufficient-words', points }
}
