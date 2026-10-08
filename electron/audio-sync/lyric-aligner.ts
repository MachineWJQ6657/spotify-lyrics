import type { LyricLine } from '../../src/types'

export interface HeardToken { text: string; startMs: number; endMs: number; probability: number }
export interface LyricMatch {
  accepted: boolean
  reason: 'matched' | 'insufficient-words' | 'ambiguous' | 'inconsistent-timing'
  sourceEndMs: number
  rate: number
  score: number
  lineIndices: number[]
  residualMs: number
}
const normalize = (text: string) => text.normalize('NFKC').toLowerCase()
  .replace(/[\u30a1-\u30f6]/g, letter => String.fromCharCode(letter.charCodeAt(0) - 0x60))
  .replace(/[^\p{L}\p{N}]/gu, '')
const reject = (reason: LyricMatch['reason']): LyricMatch => ({ accepted: false, reason, sourceEndMs: 0, rate: 1, score: 0, lineIndices: [], residualMs: 0 })

/** Whisper token timestamps are estimates, not ground truth. Never spread a
 * segment uniformly into words, and never prompt ASR with the expected lyrics.
 * Bad/segment-only timing must abstain instead of fabricating an audio anchor. */
export function parseWhisperTokens(value: unknown, durationMs: number): HeardToken[] {
  const document = value as { transcription?: Array<{ tokens?: Array<{ text?: string; p?: number; offsets?: { from?: number; to?: number } }> }> }
  if (!Array.isArray(document?.transcription) || document.transcription.length > 200) return []
  const result: HeardToken[] = []
  let last = -1
  for (const segment of document.transcription) {
    if (!Array.isArray(segment.tokens)) continue
    for (const token of segment.tokens) {
      if (typeof token?.text !== 'string' || token.text.startsWith('[_') || !normalize(token.text)) continue
      const startMs = token.offsets?.from, endMs = token.offsets?.to, probability = token.p
      if (![startMs, endMs, probability].every(Number.isFinite) || startMs! < last || startMs! < 0
        || endMs! <= startMs! || endMs! > durationMs + 100 || probability! < 0 || probability! > 1) return []
      result.push({ text: token.text, startMs: startMs!, endMs: endMs!, probability: probability! })
      last = startMs!
      if (result.length > 600) return []
    }
  }
  return result
}

/** Semi-global edit distance: locate a complete lyric line in the heard text.
 * This only tolerates transcription spelling errors; it does not invent text. */
function locate(needle: string, haystack: string) {
  let distances = new Uint16Array(haystack.length + 1)
  let starts = Uint16Array.from({ length: haystack.length + 1 }, (_, index) => index)
  for (let row = 1; row <= needle.length; row++) {
    const next = new Uint16Array(haystack.length + 1), nextStarts = new Uint16Array(haystack.length + 1)
    next[0] = row
    for (let col = 1; col <= haystack.length; col++) {
      let distance = distances[col - 1] + Number(needle[row - 1] !== haystack[col - 1]), start = starts[col - 1]
      if (distances[col] + 1 < distance) { distance = distances[col] + 1; start = starts[col] }
      if (next[col - 1] + 1 < distance) { distance = next[col - 1] + 1; start = nextStarts[col - 1] }
      next[col] = distance; nextStarts[col] = start
    }
    distances = next; starts = nextStarts
  }
  let end = 0
  for (let col = 1; col < distances.length; col++) if (distances[col] < distances[end]) end = col
  return { start: starts[end], end, score: 1 - distances[end] / needle.length }
}

interface Point { index: number; heardMs: number; sourceMs: number; weight: number; score: number; start: number; end: number }

/** Search the WHOLE original lyric, never a window around Spotify's position.
 * Two or more complete lines must agree in text AND timing. Equal-strength
 * repeated choruses are explicitly ambiguous, regardless of Spotify's clock. */
export function alignHeardLyrics(tokens: HeardToken[], lines: LyricLine[], durationMs: number): LyricMatch {
  if (lines.length > 400 || lines.reduce((sum, line) => sum + line.text.length, 0) > 16000) return reject('insufficient-words')
  const characters: Array<{ token: HeardToken; offset: number }> = []
  let heard = ''
  for (const token of tokens) {
    const text = normalize(token.text)
    heard += text
    for (let offset = 0; offset < text.length; offset++) characters.push({ token, offset })
  }
  if (heard.length < 20 || heard.length > 800) return reject('insufficient-words')
  const points: Point[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], text = normalize(line.text)
    if (!Number.isFinite(line.startMs) || line.startMs < 0 || line.startMs > 600000 || text.length < 8 || text.length > 160) continue
    const hit = locate(text, heard), first = characters[hit.start]?.token, last = characters[hit.end - 1]?.token
    // A clipped first word or a long token cannot establish a reliable onset.
    if (hit.score < .88 || !first || !last || characters[hit.start].offset !== 0
      || heard.slice(hit.start, hit.start + 2) !== text.slice(0, 2)
      || first.startMs < 150 || last.endMs > durationMs - 150 || first.endMs - first.startMs > 1200) continue
    const matched = characters.slice(hit.start, hit.end)
    const confidence = matched.reduce((sum, item) => sum + item.token.probability, 0) / matched.length
    if (confidence < .65 || first.probability < .5) continue
    points.push({ index, heardMs: first.startMs, sourceMs: line.startMs, weight: text.length,
      score: hit.score, start: hit.start, end: hit.end })
  }
  const candidates: Array<LyricMatch & { weight: number }> = []
  for (const seed of points) {
    // Broad offset band permits modest tempo changes within one short block.
    const group = points.filter(point => Math.abs(point.sourceMs - point.heardMs - seed.sourceMs + seed.heardMs) < 1700)
      .sort((a, b) => a.heardMs - b.heardMs)
    if (group.length < 2 || group.at(-1)!.heardMs - group[0].heardMs < 3500) continue
    if (group.some((point, index) => index > 0 && (point.index <= group[index - 1].index
      || point.index > group[index - 1].index + 3 || point.start < group[index - 1].end))) continue
    const meanX = group.reduce((sum, point) => sum + point.heardMs, 0) / group.length
    const meanY = group.reduce((sum, point) => sum + point.sourceMs, 0) / group.length
    const rate = group.reduce((sum, point) => sum + (point.heardMs - meanX) * (point.sourceMs - meanY), 0)
      / group.reduce((sum, point) => sum + (point.heardMs - meanX) ** 2, 0)
    const intercept = meanY - rate * meanX
    const residualMs = Math.max(...group.map(point => Math.abs(point.sourceMs - intercept - point.heardMs * rate)))
    if (rate < .85 || rate > 1.15 || residualMs > 300 || durationMs - group.at(-1)!.heardMs > 7000) continue
    const weight = group.reduce((sum, point) => sum + point.weight * point.score, 0)
    if (weight < 24) continue
    candidates.push({ accepted: true, reason: 'matched', sourceEndMs: intercept + durationMs * rate, rate,
      score: Math.min(...group.map(point => point.score)), lineIndices: group.map(point => point.index), residualMs, weight })
  }
  candidates.sort((a, b) => b.weight - a.weight)
  const best = candidates[0]
  if (!best) return reject(points.length >= 2 ? 'inconsistent-timing' : 'insufficient-words')
  if (candidates.some(other => Math.abs(other.sourceEndMs - best.sourceEndMs) > 1800 && other.weight >= best.weight * .8)) return reject('ambiguous')
  return best
}
